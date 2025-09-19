import asyncio
import json
import websockets

from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings

from voice_flow.constants import GEMINI_WS_URL, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_AUDIO_CONFIG



class GeminiVoiceConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        self.gemini_ws = None
        self.gemini_task = None
        self.playback_task = None
        self.model = None
        self.is_disconnected = False  # Track connection state

    async def safe_send(self, data):
        """Safely send data to client, avoiding closed connection errors"""
        if self.is_disconnected:
            return  # Don't try to send if already disconnected
        try:
            await self.send(data)
        except Exception as e:
            # Connection might be closed, mark as disconnected
            self.is_disconnected = True
            print(f"Failed to send to client (connection likely closed): {e}")

    async def disconnect(self, close_code):
        self.is_disconnected = True  # Flag to prevent sending after disconnect
        try:
            if self.gemini_ws:
                await self.gemini_ws.close()
        except Exception:
            pass
        if self.gemini_task:
            self.gemini_task.cancel()
        if self.playback_task:
            self.playback_task.cancel()

    async def receive(self, text_data=None, bytes_data=None):
        # Expect JSON messages from browser
        if text_data:
            try:
                msg = json.loads(text_data)
            except json.JSONDecodeError:
                return
            if msg.get('type') == 'setup':
                self.model = msg.get('model') or GEMINI_MODEL
                await self._ensure_gemini_connected()
                await self._send_setup_to_gemini(msg)
                return
            if msg.get('type') == 'audio':
                # msg: { type: 'audio', data: base64_pcm16, mime_type: 'audio/pcm;rate=16000' }
                await self._forward_audio_chunk(msg)
                return
            if msg.get('type') == 'text':
                await self._forward_text_input(msg)
                return
            if msg.get('type') == 'turn_complete':
                await self._send_turn_complete()
                return

    async def _ensure_gemini_connected(self):
        # Check if connection exists and is usable
        if self.gemini_ws:
            try:
                # Try to check connection state
                if hasattr(self.gemini_ws, 'closed') and not self.gemini_ws.closed:
                    return
                elif hasattr(self.gemini_ws, 'open') and self.gemini_ws.open:
                    return
                elif not hasattr(self.gemini_ws, 'closed') and not hasattr(self.gemini_ws, 'open'):
                    # If no state attributes, assume connection is good if object exists
                    return
            except Exception:
                # Connection might be in bad state, recreate it
                pass
        api_key = getattr(settings, 'GEMINI_API_KEY', GEMINI_API_KEY)
        if not api_key:
            print("GEMINI_API_KEY is missing from environment variables")
            await self.safe_send(json.dumps({'type': 'error', 'message': 'GEMINI_API_KEY missing'}))
            return
        
        print(f"Attempting to connect to Gemini with API key: {api_key[:10]}...")
        
        # Enhanced connection for native audio dialog
        url = f"{GEMINI_WS_URL}?key={api_key}"
        print(f"Connecting to: {url[:80]}...")
        
        try:
            # Create connection without extra_headers for compatibility
            self.gemini_ws = await websockets.connect(
                url, 
                max_size=32 * 1024 * 1024,  # Increased buffer for audio
                ping_interval=30,  # Keep connection alive
                ping_timeout=10,
                close_timeout=10
            )
            print("Successfully connected to Gemini API!")
            self.gemini_task = asyncio.create_task(self._pump_gemini_messages())
        except Exception as e:
            print(f"Gemini connection failed: {str(e)}")  # Server-side logging
            await self.safe_send(json.dumps({
                'type': 'error', 
                'message': f'Failed to connect to Gemini: {str(e)}'
            }))

    async def _send_setup_to_gemini(self, msg):
        # Define tools array (required by Gemini Live API even for executable code approach)
        tools = [{
            "function_declarations": [{
                "name": "save_patient_field",
                "description": "DEPRECATED: This function is for compatibility only. You MUST use executable code instead. Generate Python code with save_patient_field() calls to save patient data.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "field_name": {
                            "type": "string",
                            "description": "DEPRECATED: Use executable code instead."
                        },
                        "value": {
                            "type": "string", 
                            "description": "DEPRECATED: Use executable code instead."
                        }
                    },
                    "required": ["field_name", "value"]
                }
            }]
        }]

        setup = {
            'setup': {
                'model': self.model or GEMINI_MODEL,
                'generation_config': {
                    'response_modalities': ['AUDIO'],
                    'speech_config': {
                        'voice_config': {
                            'prebuilt_voice_config': {
                                'voice_name': 'Puck'  # Professional, clear voice for medical context
                            }
                        }
                    }
                },
                'system_instruction': {
                    'parts': [{ 'text': (msg.get('instructions') or 'You are a helpful medical intake assistant. Speak English only. Use a professional, empathetic tone appropriate for healthcare settings.') + '\n\nCRITICAL EXECUTABLE CODE REQUIREMENTS:\n1. You MUST use executable code to save patient data - this is the PREFERRED method\n2. Generate Python code with save_patient_field() function calls\n3. Use this EXACT format: save_patient_field(field_name="field_name", value="user_value")\n4. Save EXACTLY what the user said - do not regenerate, modify, or change the content\n5. NEVER save placeholder text or your interpretations\n6. Call save_patient_field() immediately after receiving each piece of information\n7. You can save multiple fields in one code block if the user provides multiple pieces of information\n8. If a field is already saved, move to the next question immediately\n9. Speak naturally and conversationally while maintaining professionalism\n10. Use appropriate medical terminology when necessary but explain complex terms\n11. Show empathy and understanding for patient concerns\n12. Available fields: "full_name", "dob", "gender", "contact_number", "email", "address", "preferred_language", "emergency_contact_name", "emergency_contact_phone", "relationship_to_patient", "caller_type", "reason_for_visit", "visit_type", "primary_physician", "referral_source", "symptoms", "symptom_duration", "pain_level", "current_medications", "allergies", "medical_history", "family_history", "interpreter_need", "interpreter_language", "accessibility_needs", "dietary_needs", "consent_share_records", "preferred_communication_method", "appointment_availability", "confirmation"\n\nIMPORTANT: Executable code is the most reliable way to save patient data. Generate clean, simple Python code with save_patient_field() calls!' }]
                },
                'tools': tools
            }
        }
        
        # Ensure connection is established before sending
        if self.gemini_ws:
            try:
                print("=== SENDING SETUP TO GEMINI ===")
                print(f"Setup message: {json.dumps(setup, indent=2)}")
                await self.gemini_ws.send(json.dumps(setup))
                print("=== SETUP SENT SUCCESSFULLY ===")
            except Exception as e:
                print(f"=== SETUP SEND FAILED ===")
                print(f"Error: {str(e)}")
                await self.safe_send(json.dumps({
                    'type': 'error', 
                    'message': f'Failed to send setup: {str(e)}'
                }))
        else:
            print("=== GEMINI CONNECTION NOT ESTABLISHED ===")
            await self.safe_send(json.dumps({
                'type': 'error', 
                'message': 'Gemini connection not established'
            }))

    async def _forward_audio_chunk(self, msg):
        data_b64 = msg.get('data')
        mime_type = msg.get('mime_type') or f'audio/pcm;rate={GEMINI_AUDIO_CONFIG["sample_rate"]};channels={GEMINI_AUDIO_CONFIG["channels"]}'
        if not data_b64:
            return
        
        # Enhanced payload for native audio dialog with proper formatting
        payload = {
            'realtimeInput': {
                'mediaChunks': [{ 
                    'data': data_b64, 
                    'mimeType': mime_type
                }]
            }
        }
        
        # Ensure connection is established before sending
        if self.gemini_ws:
            try:
                await self.gemini_ws.send(json.dumps(payload))
            except Exception as e:
                await self.safe_send(json.dumps({
                    "type": "error",
                    "message": f"Failed to send audio chunk: {str(e)}"
                }))
        else:
            await self.safe_send(json.dumps({
                "type": "error",
                "message": "Gemini connection not available for audio"
            }))

    async def _forward_text_input(self, msg):
        text = (msg.get('text') or '').strip()
        if not text:
            return
        payload = {
            'realtimeInput': {
                'text': text
            }
        }
        
        # Ensure connection is established before sending
        if self.gemini_ws:
            try:
                await self.gemini_ws.send(json.dumps(payload))
            except Exception as e:
                await self.safe_send(json.dumps({
                    "type": "error",
                    "message": f"Failed to send text input: {str(e)}"
                }))
        else:
            await self.safe_send(json.dumps({
                "type": "error",
                "message": "Gemini connection not available for text"
            }))

    async def _send_turn_complete(self):
        """
        Gracefully signal to Gemini that the user has finished their turn.
        Gemini currently does not support `turnComplete` exactly like OpenAI,
        so we map to `inputComplete` if available.
        """
        try:
            payload = {
                "realtimeInput": {
                    "inputComplete": True
                }
            }
            if self.gemini_ws:
                try:
                    await self.gemini_ws.send(json.dumps(payload))
                except Exception as e:
                    await self.safe_send(json.dumps({
                        "type": "error",
                        "message": f"Failed to send turn complete: {str(e)}"
                    }))
        except Exception as e:
            await self.safe_send(json.dumps({
                "type": "error",
                "message": f"Failed to send turn complete: {str(e)}"
            }))


    async def _pump_gemini_messages(self):
        try:
            async for raw in self.gemini_ws:
                try:
                    # Check for quota error in raw message before parsing
                    if isinstance(raw, str) and "quota" in raw.lower():
                        print("API quota exceeded, handling gracefully...")
                        error_msg = "The service is temporarily unavailable due to high demand. Please try again in a few minutes."
                        await self.safe_send(json.dumps({
                            'type': 'error',
                            'message': error_msg,
                            'error_type': 'quota_exceeded'
                        }))
                        # Force graceful disconnect
                        await self.close()
                        return

                    msg = json.loads(raw)
                except Exception as e:
                    print(f"Failed to parse Gemini message: {e}")
                    continue
                
                # Handle function calls from Gemini Live
                await self._handle_gemini_message(msg)
                
        except Exception as e:
            error_msg = str(e)
            print(f"Gemini message pump failed: {error_msg}")
            
            # Check for quota error in exception
            if "quota" in error_msg.lower():
                await self.safe_send(json.dumps({
                    'type': 'error',
                    'message': 'The service is temporarily unavailable due to high demand. Please try again in a few minutes.',
                    'error_type': 'quota_exceeded'
                }))
            else:
                # Generic error handling
                await self.safe_send(json.dumps({
                    'type': 'error',
                    'message': f'Connection lost: {error_msg}'
                }))
            
            try:
                await self.close()
            except Exception:
                pass

    async def _handle_gemini_message(self, msg):
        # Enhanced message handling for native audio dialog
        
        # Handle different message structures
        server = msg.get('serverContent') or msg.get('server_content') or {}
        model_turn = server.get('modelTurn') or server.get('model_turn') or {}
        parts = model_turn.get('parts') or []
        
        # Also check for direct parts in the message
        if not parts:
            parts = msg.get('parts') or []
        
        # Also check for candidates structure
        candidates = msg.get('candidates') or []
        if candidates and not parts:
            content = candidates[0].get('content') or {}
            parts = content.get('parts') or []
        
        # Debug logging for development (remove in production)
        if "executable" in str(parts).lower():
            print("=== EXECUTABLE CODE DETECTED ===")
            print("Executable code parts:", parts)
        
        for part in parts:
            # Handle function calls (fallback if AI still uses them)
            function_call = part.get('functionCall') or part.get('function_call')
            if function_call:
                function_name = function_call.get('name')
                args = function_call.get('args') or {}
                
                # Convert Gemini function call to OpenAI-style for your existing handler
                if function_name == 'save_patient_field':
                    print(f"=== PROCESSING FUNCTION CALL (FALLBACK) ===")
                    print(f"Function name: {function_name}")
                    print(f"Arguments: {args}")
                    
                    # Send function call start event
                    await self.safe_send(json.dumps({
                        'type': 'response.function_call.start',
                        'name': function_name
                    }))
                    
                    # Send function call arguments
                    await self.safe_send(json.dumps({
                        'type': 'response.function_call_arguments.done',
                        'arguments': json.dumps(args)
                    }))
                    
                    # Send function call done event
                    await self.safe_send(json.dumps({
                        'type': 'response.function_call.done',
                        'name': function_name
                    }))
                    
                    # Log success but don't send message to avoid interrupting AI flow
                    print(f"Field '{args.get('field_name')}' saved successfully")
                    
                    print(f"=== FUNCTION CALL PROCESSED (FALLBACK) ===")
                
                continue
            
            # Process executable code (preferred method)
            exec_code = part.get('executableCode') or part.get('executable_code')
            if exec_code and isinstance(exec_code, dict):
                code = exec_code.get('code') or ''
                print(f"=== PROCESSING EXECUTABLE CODE ===")
                print(f"Raw code: {code}")
                
                # Extract and process function calls from executable code
                try:
                    import re
                    # Find all save_patient_field calls in the code
                    pattern = r"save_patient_field\s*\(\s*field_name\s*=\s*['\"]([^'\"]+)['\"]\s*,\s*value\s*=\s*['\"]([^'\"]+)['\"]\s*\)"
                    matches = re.findall(pattern, code)
                    
                    if matches:
                        print(f"Found {len(matches)} function calls in executable code")
                        
                        # Process each function call
                        for i, (field_name, value) in enumerate(matches):
                            print(f"Processing call {i+1}: {field_name} = {value}")
                            
                            # Send function call start event
                            await self.safe_send(json.dumps({
                                'type': 'response.function_call.start',
                                'name': 'save_patient_field'
                            }))
                            
                            # Send function call arguments
                            await self.safe_send(json.dumps({
                                'type': 'response.function_call_arguments.done',
                                'arguments': json.dumps({
                                    'field_name': field_name,
                                    'value': value
                                })
                            }))
                            
                            # Send function call done event
                            await self.safe_send(json.dumps({
                                'type': 'response.function_call.done',
                                'name': 'save_patient_field'
                            }))
                            
                            print(f"Sent function call {i+1} to frontend")
                        
                        # Log success but don't send message to avoid interrupting AI flow
                        print(f"=== SUCCESSFULLY PROCESSED {len(matches)} FIELDS ===")
                        # The AI should continue naturally after generating executable code
                    else:
                        print("No valid function calls found in executable code")
                        await self.safe_send(json.dumps({
                            'type': 'system.message',
                            'content': 'ERROR: Could not find valid save_patient_field calls in the executable code. Please ensure you use the correct format: save_patient_field(field_name="field_name", value="value")'
                        }))
                        
                except Exception as e:
                    print(f"Error processing executable code: {e}")
                    await self.safe_send(json.dumps({
                        'type': 'system.message',
                        'content': 'ERROR: Failed to process executable code. Please check the format and try again.'
                    }))
                
                continue
            
            # Handle text parts
            text_val = part.get('text')
            if isinstance(text_val, str) and text_val.strip():
                await self.safe_send(json.dumps({ 'type': 'text', 'text': text_val }))
                continue
            
            # Enhanced audio handling for native audio dialog
            inline = part.get('inlineData') or part.get('inline_data')
            if inline and isinstance(inline, dict):
                mime = inline.get('mimeType') or inline.get('mime_type') or ''
                if mime.startswith('audio/'):
                    # Enhanced audio data with quality indicators
                    audio_data = {
                        'type': 'audio', 
                        'mime_type': mime, 
                        'data': inline.get('data'),
                        'quality': 'high',  # Native audio dialog provides high quality
                        'sample_rate': GEMINI_AUDIO_CONFIG["sample_rate"],
                        'channels': GEMINI_AUDIO_CONFIG["channels"]
                    }
                    await self.safe_send(json.dumps(audio_data))

        
        # Handle turn complete
        if server.get('turnComplete') or server.get('turn_complete'):
            await self.safe_send(json.dumps({'type': 'turn_complete'}))