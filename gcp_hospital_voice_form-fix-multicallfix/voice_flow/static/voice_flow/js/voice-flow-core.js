import { getCSRFToken, isValidUserResponse } from './common.js';
import { voiceFlowPrompt } from './prompt.js';
import {
    showThinkingIndicator,
    hideThinkingIndicator,
    updateButtonStates,
    updateConnectionButton,
    clearCurrentAssistantMessage,
    renderChecklist,
    setTranscriptPlaceholder,
    clearTranscript,
    clearGeneratedOrOptionContentDisplayPanel,
    updateAssistantMessage,
    updateUserDataPanel,
    popupMessage,
    ensureTranscriptScroll,
    openReviewModal
} from './voice-flow-ui.js';

// Core state
let conversationMessages = [];
let pc = null; // deprecated (WebRTC)
let dc = null; // deprecated (WebRTC)
let stream = null; // mic stream
let track = null; // mic track
let remoteAudio = null;
let ws = null; // WebSocket to backend proxy
let captureAudioContext = null;
let captureProcessor = null;
let captureSource = null;
let playbackAudioContext = null;
let playbackTimeCursor = 0;
let isRecording = false;
let isAssistantOrUserSpeaking = false;
let userData = {
    // Initialize with empty object to ensure it exists
    _initialized: true
};
let checklist = [];
let conversationTimeout = null;
let reconnectIntervalId = null;
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
let isRecoveryMode = false;
let conversationStartTime = null;
let isDisconnecting = false;
let isPageRefreshing = false;
let hasStartedReading = false;
let lastUpdatedField = null;
let isManualDisconnect = false;
let lastProcessedUserResponse = null;
let connectionStartTime = null;
let connectionTimeoutId = null;
let lastProcessedUserResponseTimestamp = 0;
let recentToolCalls = new Map();

// Live transcription state
let speechRecognition = null;
let isLiveTranscribing = false;
let currentLiveTranscript = '';
let liveTranscriptElement = null;
let speechRecognitionSupported = false;

const USER_RESPONSE_DEDUP_THRESHOLD_MS = 2000;
const CONVERSATION_TIMEOUT_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 100;
const RECONNECT_BASE_DELAY_MS = 3500;
const RECOVERY_STORAGE_KEY = 'voice_flow_recovery_session';
const CONNECTION_TIMEOUT_MS = 10000;

const getNextRequiredField = (currentField) => {
    const fieldOrder = [
        'full_name', 'dob', 'gender', 'contact_number', 'email', 'address', 
        'preferred_language', 'emergency_contact_name', 'emergency_contact_phone', 
        'relationship_to_patient', 'caller_type', 'reason_for_visit', 'visit_type',
        'primary_physician', 'referral_source', 'symptoms', 'symptom_duration',
        'pain_level', 'current_medications', 'allergies', 'medical_history',
        'family_history', 'interpreter_need', 'interpreter_language',
        'accessibility_needs', 'dietary_needs', 'consent_share_records',
        'preferred_communication_method', 'appointment_availability', 'confirmation'
    ];
    
    console.log('getNextRequiredField called with:', currentField);
    console.log('Current userData:', userData);
    
    const currentIndex = fieldOrder.indexOf(currentField);
    if (currentIndex !== -1 && currentIndex < fieldOrder.length - 1) {
        // Find the next field that's not already filled
        for (let i = currentIndex + 1; i < fieldOrder.length; i++) {
            const nextField = fieldOrder[i];
            const fieldValue = userData[nextField];
            console.log(`Checking field ${nextField}:`, fieldValue);
            
            if (!fieldValue || fieldValue === '' || fieldValue === null || fieldValue === undefined) {
                console.log(`Next required field found: ${nextField}`);
                return nextField.replace(/_/g, ' ');
            }
        }
    }
    
    // If we get here, check if we need to start from the beginning
    for (let i = 0; i < fieldOrder.length; i++) {
        const field = fieldOrder[i];
        const fieldValue = userData[field];
        if (!fieldValue || fieldValue === '' || fieldValue === null || fieldValue === undefined) {
            console.log(`Found unfilled field from start: ${field}`);
            return field.replace(/_/g, ' ');
        }
    }
    
    console.log('All fields completed, returning confirmation');
    return 'confirmation';
};

// Live transcription functions
const initializeSpeechRecognition = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.warn('Speech recognition not supported in this browser');
        speechRecognitionSupported = false;
        return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    
    // Configure for optimal live transcription
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';
    speechRecognition.maxAlternatives = 1;
    
    speechRecognition.onstart = () => {
        console.log('Live transcription started');
        isLiveTranscribing = true;
        updateLiveTranscriptIndicator(true);
    };
    
    speechRecognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Update live transcript display
        currentLiveTranscript = finalTranscript + interimTranscript;
        updateLiveTranscriptDisplay(currentLiveTranscript, interimTranscript.length > 0);
    };
    
    speechRecognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            console.warn('Microphone access denied for speech recognition');
        }
    };
    
    speechRecognition.onend = () => {
        console.log('Live transcription ended');
        isLiveTranscribing = false;
        updateLiveTranscriptIndicator(false);
        // Restart if we're still recording
        if (isRecording && !isManualDisconnect) {
            setTimeout(() => {
                if (isRecording && speechRecognition) {
                    try {
                        speechRecognition.start();
                    } catch (e) {
                        console.warn('Failed to restart speech recognition:', e);
                    }
                }
            }, 100);
        }
    };
    
    speechRecognitionSupported = true;
    return true;
};

const startLiveTranscription = () => {
    if (!speechRecognitionSupported || !speechRecognition) {
        return false;
    }
    
    try {
        speechRecognition.start();
        return true;
    } catch (e) {
        console.warn('Failed to start live transcription:', e);
        return false;
    }
};

const stopLiveTranscription = () => {
    if (speechRecognition && isLiveTranscribing) {
        try {
            speechRecognition.stop();
        } catch (e) {
            console.warn('Error stopping live transcription:', e);
        }
    }
    isLiveTranscribing = false;
    updateLiveTranscriptIndicator(false);
};

const updateLiveTranscriptDisplay = (text, isInterim = false) => {
    if (!liveTranscriptElement) {
        // Create live transcript element if it doesn't exist
        const transcriptDiv = document.getElementById('transcript');
        if (transcriptDiv) {
            liveTranscriptElement = document.createElement('div');
            liveTranscriptElement.id = 'live-transcript';
            liveTranscriptElement.className = 'p-4 my-3 rounded-lg shadow-sm border bg-blue-50 border-blue-200 text-left break-words overflow-hidden';
            liveTranscriptElement.innerHTML = '<div class="text-xs text-blue-600 font-medium mb-1">🎤 Live Transcription:</div><div id="live-transcript-text" class="text-sm text-gray-800"></div>';
            transcriptDiv.appendChild(liveTranscriptElement);
        }
    }
    
    if (liveTranscriptElement && text.trim()) {
        const textElement = document.getElementById('live-transcript-text');
        if (textElement) {
            textElement.textContent = text;
            if (isInterim) {
                textElement.style.fontStyle = 'italic';
                textElement.style.opacity = '0.7';
            } else {
                textElement.style.fontStyle = 'normal';
                textElement.style.opacity = '1';
            }
        }
        ensureTranscriptScroll();
    } else if (liveTranscriptElement && !text.trim()) {
        // Hide the element when there's no text
        liveTranscriptElement.style.display = 'none';
    }
};

const updateLiveTranscriptIndicator = (isActive) => {
    const indicator = document.getElementById('live-transcript-indicator');
    if (indicator) {
        if (isActive) {
            indicator.textContent = '🎤 Live';
            indicator.className = 'text-green-600 text-xs font-medium';
        } else {
            indicator.textContent = '🎤 Off';
            indicator.className = 'text-gray-500 text-xs font-medium';
        }
    }
};

const clearLiveTranscript = () => {
    if (liveTranscriptElement) {
        liveTranscriptElement.remove();
        liveTranscriptElement = null;
    }
    currentLiveTranscript = '';
};

const saveSessionToLocalStorage = () => {
    const sessionData = {
        userData,
        conversationMessages,
        conversationStartTime,
        checklist,
        lastUpdatedField,
        timestamp: new Date().toISOString()
    };
    try { localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(sessionData)); }
    catch (e) { console.error('Failed to save session to localStorage:', e); }
};

const clearRecoverySession = () => {
    try { localStorage.removeItem(RECOVERY_STORAGE_KEY); }
    catch (e) { console.error('Failed to clear recovery session:', e); }
};

const addMessageToConversation = (role, content, timestamp = new Date().toISOString()) => {
    conversationMessages.push({ role, content, timestamp });
    if (role === 'user') resetConversationTimeout();
    try { saveSessionToLocalStorage(); } catch {}
};

const clearConversationTimeout = () => {
    if (conversationTimeout) {
        clearTimeout(conversationTimeout);
        conversationTimeout = null;
    }
};

const resetConversationTimeout = () => {
    clearConversationTimeout();
    conversationTimeout = setTimeout(() => {
        if (isRecording && !isAssistantOrUserSpeaking) {
            console.log('Conversation timeout - AI may be stuck');
            const timeoutMessage = `(System: The conversation seems to have paused. Please ask the user for clarification in English, then continue following the given instructions.)`;
            formatAndSendSystemMessageText(timeoutMessage);
        }
    }, CONVERSATION_TIMEOUT_MS);
};

const cancelScheduledReconnection = () => {
    if (reconnectTimeoutId) { clearTimeout(reconnectTimeoutId); reconnectTimeoutId = null; }
    if (reconnectIntervalId) { clearInterval(reconnectIntervalId); reconnectIntervalId = null; }
};

const cleanupConnection = () => {
    try { if (dc) dc.close(); } catch {}
    try { if (pc) pc.close(); } catch {}
    try { if (ws) ws.close(); } catch {}
    if (stream) { stream.getTracks().forEach(t => t.stop()); }
    dc = null; pc = null; ws = null; stream = null;
    if (remoteAudio) { remoteAudio.remove(); remoteAudio = null; }
    isRecording = false;
    updateButtonStates(isRecording);
    
    // Stop live transcription
    stopLiveTranscription();
    clearLiveTranscript();
};

const forceCleanupConnection = async () => {
    console.log('Force cleaning up stuck connection...');
    if (connectionTimeoutId) { clearTimeout(connectionTimeoutId); connectionTimeoutId = null; }
    cleanupConnection();
    connectionStartTime = null;
    console.log('Forced cleanup completed');
};

const attemptReconnection = async () => {
    if (!isRecoveryMode) return;
    console.log(`Attempting to reconnect... (attempt ${reconnectAttempts})`);
    updateConnectionButton('reconnecting');
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            updateConnectionButton('connected');
            hideThinkingIndicator();
            return;
        }
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            const timeSinceStart = connectionStartTime ? Date.now() - connectionStartTime : 0;
            if (timeSinceStart > CONNECTION_TIMEOUT_MS) {
                console.log('Connection stuck in progress for too long, forcing cleanup');
                await forceCleanupConnection();
            } else {
                console.log('Connection already in progress, skipping reconnection');
                return;
            }
        }
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            console.log('Cleaning up existing connection before reconnection');
            await cleanupConnection();
        }
        const connectResponse = await startWebSocketVoice();
        if (connectResponse.error) throw new Error(connectResponse.error);
            console.log('Reconnection successful!');
            updateConnectionButton('connected');
            hideThinkingIndicator();
            if (reconnectIntervalId) { clearInterval(reconnectIntervalId); reconnectIntervalId = null; }
    } catch (error) {
        console.error('Reconnection failed:', error);
        updateConnectionButton('failed');
    }
};

const scheduleReconnection = () => {
    if (!isRecoveryMode || reconnectTimeoutId) return;
    if (reconnectIntervalId) { clearInterval(reconnectIntervalId); reconnectIntervalId = null; }
    const attempt = async () => {
        if (!isRecoveryMode) { cancelScheduledReconnection(); return; }
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log('Max reconnection attempts reached.');
            isManualDisconnect = true;
            disconnect();
            popupMessage('Connection failed. Please try again.', 'error', 5000);
            return;
        }
        reconnectAttempts++;
        await attemptReconnection();
        if ((ws?.readyState !== WebSocket.OPEN) && isRecoveryMode) {
            const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(1.5, reconnectAttempts), 30000);
            const jitter = delay * 0.2 * (Math.random() - 0.5);
            const nextAttemptDelay = Math.max(0, delay + jitter);
            console.log(`Reconnection attempt ${reconnectAttempts} failed. Retrying in ${nextAttemptDelay.toFixed(0)}ms.`);
            reconnectTimeoutId = setTimeout(attempt, nextAttemptDelay);
        }
    };
    attempt();
};

const handleConnectionFailure = () => {
    console.log('Connection failed - saving session for recovery');
    saveSessionToLocalStorage();
    cleanupConnection();
    updateConnectionButton('failed');
    isRecoveryMode = true;
    scheduleReconnection();
};

const setupWebSocketAudio = async () => {
    try {
        // Enhanced audio constraints for native audio dialog with minimal latency
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                sampleRate: { ideal: 16000, min: 8000, max: 48000 },
                channelCount: 1, 
                echoCancellation: true, 
                noiseSuppression: true,
                autoGainControl: true,
                latency: { ideal: 0.005, max: 0.01 }, // Ultra-low latency for real-time
                sampleSize: 16,
                googEchoCancellation: true,
                googAutoGainControl: true,
                googNoiseSuppression: true,
                googHighpassFilter: true,
                googTypingNoiseDetection: true
            } 
        });
    } catch (e) {
        console.warn('Falling back to basic audio constraints:', e);
        // Fallback with basic constraints
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
        } catch (fallbackError) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    }
    
    [track] = stream.getAudioTracks();
    
    // Optimize audio context for native audio dialog with ultra-low latency
    captureAudioContext = new (window.AudioContext || window.webkitAudioContext)({ 
        sampleRate: 48000,
        latencyHint: 'interactive' // Low latency for real-time processing
    });
    captureSource = captureAudioContext.createMediaStreamSource(stream);
    
    // Use smaller buffer size for lower latency
    // Note: ScriptProcessorNode is deprecated, but AudioWorkletNode requires HTTPS in production
    // and complex setup. For now, we use ScriptProcessorNode with plans to migrate to AudioWorklet
    // when the application is deployed with HTTPS. This warning can be safely ignored in development.
    captureProcessor = captureAudioContext.createScriptProcessor(2048, 1, 1);
    captureProcessor.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !isRecording) return;
        const input = event.inputBuffer.getChannelData(0);
        const pcm16k = downsampleAndEncodePcm16(input, captureAudioContext.sampleRate, 16000);
        if (!pcm16k) return;
        const base64 = arrayBufferToBase64(pcm16k.buffer);
        ws.send(JSON.stringify({ type: 'audio', data: base64, mime_type: 'audio/pcm;rate=16000' }));
    };
    captureSource.connect(captureProcessor);
    captureProcessor.connect(captureAudioContext.destination);
    
    // Initialize and start live transcription
    if (initializeSpeechRecognition()) {
        console.log('Live transcription initialized successfully');
        startLiveTranscription();
    } else {
        console.warn('Live transcription not available - continuing without it');
    }
};

const setupWebSocket = async () => {
    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${wsScheme}://${window.location.host}/ws/voice/`;
    return new Promise((resolve, reject) => {
        ws = new WebSocket(url);
        ws.onopen = async () => {
            try {
                await setupWebSocketAudio();
                playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                playbackTimeCursor = playbackAudioContext.currentTime;
                isRecording = true;
                reconnectAttempts = 0;
                cancelScheduledReconnection();
                updateButtonStates(isRecording);
                updateConnectionButton('connected');
                
                const initialStateElement = document.getElementById('voice-flow-initial-state');
                const initialState = JSON.parse(initialStateElement.textContent);
                const instructions = voiceFlowPrompt;
                
                // Send setup message
                const setupMessage = {
                    type: 'setup',
                    model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
                    voice: 'Aoede',
                    instructions: instructions
                };
                
                ws.send(JSON.stringify(setupMessage));

                if (isRecoveryMode) {
                    showThinkingIndicator('re-collecting-data');
                    hideThinkingIndicator();
                }
                resolve({ ok: true });
            } catch (err) { 
                reject(err); 
            }
        };
        
        // ... existing code ...
        ws.onmessage = async (evt) => {
            try {
                const message = JSON.parse(evt.data);
                console.log('=== WEBSOCKET MESSAGE RECEIVED ===');
                console.log('Message type:', message.type);
                console.log('Full message:', message);
                
                // Log unexpected message types for debugging
                if (message.type && !['audio', 'text', 'turn_complete', 'error', 'response.function_call.start', 'response.function_call_arguments.done', 'response.function_call.done', 'system.message'].includes(message.type)) {
                    console.log('Unexpected message type:', message.type);
                }

                // Handle quota exceeded error specially
                if (message.type === 'error' && message.error_type === 'quota_exceeded') {
                    console.log('API quota exceeded, showing user-friendly message');
                    popupMessage(message.message, 'warning', 10000);
                    isManualDisconnect = true;  // Prevent auto-reconnect
                    await disconnect();
                    return;
                }

                if (message.type === 'audio' && message.data) {
                    // Enhanced audio playback for native audio dialog
                    const quality = message.quality || 'standard';
                    const sampleRate = message.sample_rate || 16000;
                    const channels = message.channels || 1;
                    const mimeType = message.mime_type || `audio/pcm;rate=${sampleRate}`;
                    
                    console.log(`Playing ${quality} quality audio at ${sampleRate}Hz, ${channels} channel(s)`);
                    playPcm16Chunk(message.data, mimeType);
                    
                    // Visual indicator for high-quality native audio
                    if (quality === 'high') {
                        console.log('High-quality native audio dialog active');
                    }
                
                } else if (message.type === 'text' && message.text) {
                    // Display text message without TTS fallback
                    const finalText = updateAssistantMessage(message.text, true);
                    addMessageToConversation('assistant', message.text);
                    resetConversationTimeout();
                } else if (message.type === 'turn_complete') {
                    // Handle turn complete
                    hideThinkingIndicator();
                    // Clear recent tool calls to allow new legitimate calls
                    recentToolCalls.clear();
                    console.log('Turn complete - cleared recent tool calls cache');
                } else if (message.type === 'error') {
                    console.error('Server error:', message.message);
                } else if (message.type === 'response.function_call.start') {
                    // Handle function call start
                    showThinkingIndicator('processing');
                } else if (message.type === 'response.function_call_arguments.done') {
                    console.log('=== FUNCTION CALL RECEIVED FROM BACKEND ===');
                    console.log('Message type:', message.type);
                    console.log('Full message:', message);
                    console.log('Arguments:', message.arguments);
                    
                    // Simple deduplication for identical function calls
                    try {
                        const args = JSON.parse(message.arguments || '{}');
                        console.log('Parsed function call args:', args);
                        
                        if (args && args.field_name) {
                            const key = `${args.field_name.toLowerCase().trim()}::${String(args.value || '').trim()}`;
                            const now = Date.now();
                            const lastTs = recentToolCalls.get(key) || 0;
                            
                            // Block identical calls within 200ms (reduced for faster processing)
                            if (now - lastTs < 200) {
                                console.log('Blocking duplicate function call:', key);
                                return;
                            }
                            recentToolCalls.set(key, now);
                        }
                    } catch (e) {
                        console.error('Error in deduplication logic:', e);
                    }
                    
                    // Process function call
                    console.log('=== PROCESSING FUNCTION CALL ===');
                    console.log('Raw message:', message);
                    console.log('Current userData state:', userData);
                    
                    let args;
                    try { 
                        // Parse function call arguments
                        args = typeof message.arguments === 'string' 
                            ? JSON.parse(message.arguments) 
                            : message.arguments;
                        console.log('Parsed args:', args);
                    }
                    catch (jsonError) {
                        console.error('JSON parsing error:', jsonError);
                        const errorMessage = `ERROR: Invalid function call format. Please retry with proper arguments.`;
                        formatAndSendSystemMessageText(errorMessage);
                        hideThinkingIndicator();
                        return;
                    }
                    
                    if (args && args.field_name) {
                        clearGeneratedOrOptionContentDisplayPanel();
                        
                        try {
                            console.log('Processing field:', args.field_name, '=', args.value);
                            
                            const [validatedValue, isError, lastUpdatedValidatedField] = formatAndValidateFieldValues(args.field_name, args.value);
                            lastUpdatedField = lastUpdatedValidatedField;
                            
                            if (isError){
                                // Send error to AI but don't display to user
                                const systemMessage = `ERROR: The validation for field "${args.field_name}" failed. You MUST ask the user for new information and retry saving it with a corrected function call. Do not proceed until this is successfully saved.`;
                                ws.send(JSON.stringify({
                                    type: 'system.message',
                                    content: systemMessage
                                }));
                                return;
                            }
                            
                            // Always save the field (even if unchanged) to ensure UI updates
                            const currentValue = userData[args.field_name];
                            if (currentValue === validatedValue) {
                                console.log('Field unchanged, but updating UI:', args.field_name);
                            } else {
                                console.log('Field changed, saving:', args.field_name);
                            }
                            
                            // Save field and update UI
                            userData[args.field_name] = validatedValue;
                            lastUpdatedField = args.field_name;
                            console.log('Saved field:', args.field_name, '=', validatedValue);
                            
                            // Update UI immediately
                            console.log('=== UPDATING UI ===');
                            console.log('Calling updateUserDataPanel with:', userData, lastUpdatedField);
                            updateUserDataPanel(userData, lastUpdatedField);
                            console.log('Calling updateChecklistStatuses');
                            updateChecklistStatuses();
                            console.log('Calling saveSessionToLocalStorage');
                            saveSessionToLocalStorage();
                            
                            // Scroll to updated field
                            const fieldContainer = document.getElementById(`field-container-${args.field_name}`);
                            if (fieldContainer) {
                                console.log('Scrolling to field container:', `field-container-${args.field_name}`);
                                fieldContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            } else {
                                console.log('Field container not found:', `field-container-${args.field_name}`);
                            }
                            console.log('=== UI UPDATE COMPLETE ===');
                            
                            if (args.field_name === 'confirmation'){
                                console.log('=== CONFIRMATION FIELD DETECTED ===');
                                console.log('Confirmation value:', args.value);
                                console.log('Current userData before confirmation:', userData);
                                console.log('Starting final process...');
                                isManualDisconnect = true;
                                disconnect();
                                handleConfirmationFunctionCall();
                                return;
                            }
                            
                            // Don't send individual success messages - let AI continue naturally
                            // The AI will continue to the next field based on the prompt instructions
                            
                        } catch (error) {
                            console.error('Error saving field:', error);
                            popupMessage(`Failed to save ${args.field_name}. Please try again.`, 'error', 5000);
                            const errorMessage = `ERROR: Failed to save "${args.field_name}". Please retry.`;
                            formatAndSendSystemMessageText(errorMessage);
                        } finally {
                            hideThinkingIndicator();
                        }
                    } else {
                        console.error('Invalid function call - missing field_name:', args);
                        const errorMessage = `ERROR: Function call missing field_name. Please retry with proper format.`;
                        formatAndSendSystemMessageText(errorMessage);
                        hideThinkingIndicator();
                    }
                } else if (message.type === 'response.function_call.done') {
                    // Handle function call completion
                    hideThinkingIndicator();
                    console.log('Function call completed');
                } else if (message.type === 'system.message') {
                    // Handle system messages from backend (success/error messages)
                    console.log('=== SYSTEM MESSAGE FROM BACKEND ===');
                    console.log('System message:', message.content);
                    
                    // Only forward error messages to AI, not success messages
                    // Success messages should not interrupt the natural flow
                    if (message.content && message.content.startsWith('ERROR:')) {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'text',
                                text: message.content
                            }));
                        }
                    } else {
                        // For success messages, just log and continue naturally
                        console.log('Success message received, continuing natural flow');
                    }
                    
                    hideThinkingIndicator();
                } else {
                    // Try to handle as existing server event
                    await handleServerEvent(message);
                }
            } catch (e) {
                console.error('WS message parse error', e);
            }
        };
        
        ws.onerror = (e) => {
            console.error('WebSocket error:', e);
            reject(new Error('WebSocket error: ' + e.message));
        };
        
        ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            if (!isManualDisconnect) {
                showThinkingIndicator('reconnecting');
                handleConnectionFailure();
            }
        };
    });
};

const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
};

const downsampleAndEncodePcm16 = (float32Array, inputRate, targetRate) => {
    if (inputRate === targetRate) {
        const pcm = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            // Enhanced audio processing with noise reduction for native audio dialog
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            // Apply slight noise gate to improve audio quality
            if (Math.abs(s) < 0.001) s = 0;
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return pcm;
    }
    
    // Enhanced resampling with better anti-aliasing
    const ratio = inputRate / targetRate;
    const newLength = Math.floor(float32Array.length / ratio);
    const pcm = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < newLength) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i++) {
            accum += float32Array[i];
            count++;
        }
        
        const sample = count > 0 ? accum / count : 0;
        const s = Math.max(-1, Math.min(1, sample));
        // Apply noise gate
        const finalSample = Math.abs(s) < 0.001 ? 0 : s;
        pcm[offsetResult] = finalSample < 0 ? finalSample * 0x8000 : finalSample * 0x7FFF;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return pcm;
};

const playPcm16Chunk = (base64Data, mimeType) => {
    try {
        const rateMatch = /rate=(\d+)/.exec(mimeType || '');
        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 16000; // Default to 16kHz for native audio dialog
        const raw = atob(base64Data);
        const buf = new ArrayBuffer(raw.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
        
        const pcm16 = new Int16Array(buf);
        const float32 = new Float32Array(pcm16.length);
        
        // Enhanced audio conversion with dynamic range compression for better quality
        for (let i = 0; i < pcm16.length; i++) {
            let sample = pcm16[i] / 0x8000;
            // Apply gentle compression to improve clarity
            if (Math.abs(sample) > 0.8) {
                sample = sample > 0 ? 0.8 + (sample - 0.8) * 0.2 : -0.8 + (sample + 0.8) * 0.2;
            }
            float32[i] = sample;
        }
        
        if (!playbackAudioContext) {
            playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({ 
                sampleRate,
                latencyHint: 'interactive' // Optimize for real-time audio
            });
        }
        
        // Resume context if suspended (required for some browsers)
        if (playbackAudioContext.state === 'suspended') {
            playbackAudioContext.resume();
        }
        
        const audioBuffer = playbackAudioContext.createBuffer(1, float32.length, sampleRate);
        audioBuffer.copyToChannel(float32, 0);
        
        const source = playbackAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Add a gentle low-pass filter to reduce artifacts
        const filter = playbackAudioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(7000, playbackAudioContext.currentTime); // Remove high-freq artifacts
        filter.Q.setValueAtTime(0.7, playbackAudioContext.currentTime);
        
        source.connect(filter);
        filter.connect(playbackAudioContext.destination);
        
        const now = playbackAudioContext.currentTime;
        const startAt = Math.max(now, playbackTimeCursor);
        source.start(startAt);
        playbackTimeCursor = startAt + audioBuffer.duration;
        
        // Set assistant speaking state
        isAssistantOrUserSpeaking = true;
        source.onended = () => {
            isAssistantOrUserSpeaking = false;
        };
        
    } catch (e) {
        console.error('Failed to play PCM chunk', e);
        isAssistantOrUserSpeaking = false;
    }
};

const sendData = (data) => {
    if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(data));
    }
};

const startWebSocketVoice = async () => {
    try {
        return await setupWebSocket();
    } catch (error) {
        console.error('Error setting up WebSocket voice:', error);
        return { error: error.message };
    }
};

const isDuplicateUserResponse = (userText) => {
    const currentTime = Date.now();
    const normalizedText = userText.toLowerCase().trim();
    if (lastProcessedUserResponse === normalizedText) {
        if (currentTime - lastProcessedUserResponseTimestamp < USER_RESPONSE_DEDUP_THRESHOLD_MS) return true;
    }
    lastProcessedUserResponse = normalizedText;
    lastProcessedUserResponseTimestamp = currentTime;
    return false;
};

const configureAIWithRecovery = () => {
    const recoveryContext = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [{
                type: 'input_text',
                text: `RECOVERY MODE: This is a resumed patient intake session. 
                    The conversation is already in progress. You have previously asked the following questions and received these answers: ${JSON.stringify(conversationMessages)}. 
                    The saved patient information is: ${JSON.stringify(userData)}.
                    Continue the patient intake conversation from where you left off, ensuring that all actions strictly adhere to the rules and instructions in the session instructions. 
                    Do not bypass or modify any session instructions.
                    IMPORTANT: Continue speaking ONLY in English. Don't wait for the user to reply, just start the conversation from where you left off in English.
                    If the session was interrupted while a question was being asked, you must re-ask that question upon reconnection before moving forward.
                    `
            }]
        }
    };
    sendData(recoveryContext);
    sendData({ type: 'response.create' });
    console.log('AI configured with recovery data');
};

const formatAndSendSystemMessageText = (systemMessageText) => {
    console.log('formatAndSendSystemMessageText>>>>>>>>>>>>>>>>>.', systemMessageText);
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Send as system.message type instead of text to prevent text-to-speech
            ws.send(JSON.stringify({ 
                type: 'system.message',
                content: systemMessageText
            }));
        }
    } catch (e) { console.warn('Failed to send system text to Gemini WS', e); }
};

const formatAndValidateFieldValues = (fieldName, value) => {
    // TODO: Optimization of validation for the field options
    let finalUpdatedField = fieldName;
    let isError = false;
    if (fieldName === 'full_name' || fieldName === 'dob' || fieldName === 'gender' || fieldName === 'contact_number' || fieldName === 'reason_for_visit' || fieldName === 'symptoms') {
        if (value === 'not-needed') {
            const systemMessage = `ERROR: Field "${fieldName}" is a mandatory field and cannot be "not-needed." Prompt the user to provide this information.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    // Remove blocking validation - allow all fields to be collected naturally
    
    if (fieldName === 'interpreter_need' || fieldName === 'interpreter_language') {
        if (fieldName === 'interpreter_need' && (value === 'no' || value === 'No')) {
            userData['interpreter_language'] = 'not-needed';
        }
    }
    
    if (fieldName === 'relationship_to_patient' && value === 'not-needed' && (userData['emergency_contact_name'] === 'not-needed')) {
        userData['emergency_contact_phone'] = 'not-needed';
    }

    if (fieldName === 'emergency_contact_name' && value === 'not-needed' && (userData['relationship_to_patient'] === 'not-needed')) {
        userData['emergency_contact_phone'] = 'not-needed';
    }

    if (fieldName === 'caller_type' && ( userData['emergency_contact_name'] === 'not-needed' )) {
        if (!('relationship_to_patient' in userData)) userData['relationship_to_patient'] = 'not-needed';
        if (!('emergency_contact_phone' in userData)) userData['emergency_contact_phone'] = 'not-needed';
    }

    if (fieldName === 'dob') {
        console.log('=== VALIDATING DOB ===');
        console.log('Input value:', value);
        
        // First try to parse the date in MM/DD/YYYY format
        let dateRegex = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(\d{4})$/;
        let match = value.match(dateRegex);
        if (match) {
            console.log('Matched MM/DD/YYYY format:', match);
            // Convert to standardized format with leading zeros
            const [_, month, day, year] = match;
            const formattedDate = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
            console.log('Formatted date:', formattedDate);
            
            // Convert to ISO format for storage
            const mm = month.padStart(2, '0');
            const dd = day.padStart(2, '0');
            const yyyy = year;
            const isoDate = `${yyyy}-${mm}-${dd}`;
            console.log('ISO date for storage:', isoDate);
            
            return [isoDate, isError, finalUpdatedField];
        }
        
        // Try to parse ISO format (YYYY-MM-DD)
        dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
        match = value.match(dateRegex);
        if (match) {
            console.log('Already in ISO format:', value);
            return [value, isError, finalUpdatedField];
        }
        
        console.log('Failed to parse date:', value);

            const systemMessage = `ERROR: Invalid date format: "${value}." Remind the user of the correct format (e.g., MM/DD/YYYY) or correct it internally if it's a model formatting error.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    // All fields can be collected - no blocking validation
    if (fieldName === 'email') {
        if (value === 'not-needed') return [value, isError, finalUpdatedField];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            const systemMessage = `ERROR: Invalid email format: "${value}." Re-prompt for the correct format.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'contact_number' || fieldName === 'emergency_contact_phone') {
        if (value === 'not-needed') return [value, isError, finalUpdatedField];
        
        // Normalize phone number - remove all non-digits
        const digitsOnly = value.replace(/\D/g, '');
        
        // Check if it's a valid 10-digit US number (or 11 digits starting with 1)
        if (digitsOnly.length === 10) {
            // Format as XXX-XXX-XXXX
            const formatted = `${digitsOnly.slice(0,3)}-${digitsOnly.slice(3,6)}-${digitsOnly.slice(6)}`;
            return [formatted, isError, finalUpdatedField];
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
            // Remove leading 1 and format as XXX-XXX-XXXX
            const formatted = `${digitsOnly.slice(1,4)}-${digitsOnly.slice(4,7)}-${digitsOnly.slice(7)}`;
            return [formatted, isError, finalUpdatedField];
        } else {
            const systemMessage = `ERROR: Invalid phone number format: "${value}." Please provide a valid 10-digit US phone number (e.g., 123-456-7890 or 1234567890).`;       
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'pain_level') {
        const painLevel = parseInt(value);
        if (isNaN(painLevel) || painLevel < 0 || painLevel > 10) {
            const systemMessage = `ERROR: Invalid pain level: "${value}." Re-prompt for a number between 0 and 10.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
        value = painLevel.toString();
    }
    if (fieldName === 'gender') {
        const validGenders = ['Male', 'Female', 'Other', 'Prefer not to say'];
        const match = validGenders.find(gender => gender.toLowerCase() === value.toLowerCase());
        if (match) value = match;
        else {
            const systemMessage = `ERROR: Invalid gender value. Remind the user that accepted options are Male, Female, Other, or Prefer not to say.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'caller_type') {
        const validCallerTypes = ['Patient', 'Parent', 'Guardian', 'Caregiver'];
        const match = validCallerTypes.find(type => type.toLowerCase() === value.toLowerCase());
        if (match) value = match;
        else {
            const systemMessage = `ERROR: Invalid caller type. Remind the user that accepted options are Patient, Parent, Guardian, or Caregiver.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'visit_type') {
        const validVisitTypes = ['First-time', 'Returning'];
        const match = validVisitTypes.find(type => type.toLowerCase() === value.toLowerCase());
        if (match) value = match;
        else {
            const systemMessage = `ERROR: Invalid visit type. Remind the user that accepted options are First-time or Returning.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'interpreter_need' || fieldName === 'consent_share_records') {
        const validValues = ['Yes', 'No'];
        const match = validValues.find(val => val.toLowerCase() === value.toLowerCase());
        if (match) value = match;
        else {
            const systemMessage = `ERROR: Invalid value for "${fieldName}." Remind the user that accepted options are Yes or No.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'confirmation' && value.toLowerCase() === 'no') {
        const systemMessage = `CONFIRMATION DENIED: User declined confirmation. Re-engage the user to determine which fields need to be corrected.`;
        formatAndSendSystemMessageText(systemMessage);
        isError = true;
        return [value, isError];
    }
    if (fieldName === 'confirmation') {
        console.log('=== CONFIRMATION VALIDATION ===');
        console.log('Current userData:', userData);
        console.log('Confirmation value:', value);
        
        const requiredFields = ['full_name', 'dob', 'contact_number', 'reason_for_visit', 'symptoms'];
        const missingFields = requiredFields.filter(field => !(field in userData) || !userData[field]);
        console.log('Required fields:', requiredFields);
        console.log('Missing fields:', missingFields);
        
        if (missingFields.length > 0) {
            const fieldList = missingFields.join(', ');
            const systemMessage = `CRITICAL: The following required fields are missing before final confirmation: ${fieldList}. Do not proceed with the confirmation step. Pause and ask for these fields first.`;
            console.log('Confirmation validation FAILED:', systemMessage);
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
        
        console.log('Confirmation validation PASSED - proceeding with confirmation');
    }
    return [value, isError, finalUpdatedField];
};

const handleConfirmationFunctionCall = () => {
    openReviewModal(userData, {
        onSavePatient: async (edited) => {
            // Deep copy the edited data to userData
            Object.keys(edited).forEach(key => {
                userData[key] = edited[key];
            });
            updateUserDataPanel(userData, lastUpdatedField);
            // Save to database and return result
            const result = await savePatientToDatabase();
            if (result.success) {
                // Update the UI to reflect the changes
                updateChecklistStatuses();
            }
            return result;
        },
        onUploadAttachment: async (appointmentId, file) => {
            return await uploadInsuranceAttachment(appointmentId, file);
        },
        onSaveConversation: async () => {
            return await saveConversationToDatabase();
        },
        onRedirectToAppointment: (appointmentId) => {
            redirectToAppointment(appointmentId);
        },
        onCancel: () => {
            redirectToVoiceFlow();
        }
    });
};

const handleServerEvent = async (event) => {
    if (event.type === 'response.created') {
        isAssistantOrUserSpeaking = true;
        showThinkingIndicator('thinking');
        clearCurrentAssistantMessage();
        return;
    } else if (event.type === 'input_audio_buffer.speech_started') {
        isAssistantOrUserSpeaking = true;
        showThinkingIndicator('listening');
        clearCurrentAssistantMessage();
        return;
    } else if (event.type === 'conversation.item.input_audio_transcription.started') {
        showThinkingIndicator('processing');
        return;
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
        showThinkingIndicator('processing');
        const userText = event.transcript.trim();
        hideThinkingIndicator();
        if (isDuplicateUserResponse(userText)) { console.log('Duplicate user response detected, skipping:', userText); return; }
        addMessageToConversation('user', userText);
        return;
    } else if (event.type === 'audio_transcription.done' && event.transcription?.text) {
        showThinkingIndicator('processing');
        const userText = event.transcription.text.trim();
        hideThinkingIndicator();
        if (isDuplicateUserResponse(userText)) { return; }
        if (isValidUserResponse(userText)) {
            addMessageToConversation('user', userText);
        } else {
            const clarificationMessage = `The user's response "${userText}" was unclear or may have been background noise.  
            You must politely ask the user to repeat their response more clearly before proceeding.  
            Do not assume or generate values on their behalf.`;
            formatAndSendSystemMessageText(clarificationMessage);
        }
        return;
    } else if (event.type === 'response.audio_transcript.delta' && event.delta) {
        isAssistantOrUserSpeaking = true;
        if (!hasStartedReading) { showThinkingIndicator('reading'); hasStartedReading = true; }
        updateAssistantMessage(event.delta, false);
        return;
    } else if (event.type === 'response.audio_transcript.done' && event.transcript) {
        hasStartedReading = false;
        hideThinkingIndicator();
        const finalText = updateAssistantMessage(event.transcript, true);
        addMessageToConversation('assistant', event.transcript);
        resetConversationTimeout();
        return;
    } else if (event.type === 'response.function_call_arguments.delta') {
        showThinkingIndicator('processing');
        return;
    } else if (event.type === 'response.function_call_arguments.done') {
        // REMOVED: This entire block is handled in the WebSocket onmessage handler
        // to prevent duplicate processing that causes the AI to repeat function calls
        console.log('Function call already processed in WebSocket handler, skipping duplicate');
        return;
    } else if (event.type === 'response.function_call.start') {
        showThinkingIndicator('processing');
        return;
    } else if (event.type === 'response.function_call.done') {
        // This is handled in the main WebSocket message handler
        console.log('Function call done event received in handleServerEvent (already handled)');
        return;
    } else if (event.type === 'response.text.delta' && event.delta) {
        isAssistantOrUserSpeaking = true;
        if (!hasStartedReading) { showThinkingIndicator('reading'); hasStartedReading = true; }
        updateAssistantMessage(event.delta, false);
        return;
    } else if (event.type === 'response.output_item.added') {
        isAssistantOrUserSpeaking = true;
        return;
    } else if (event.type === 'response.content_part.added') {
        isAssistantOrUserSpeaking = true;
        return;
    } else if (event.type === 'response.text.done' && event.text) {
        console.log('response.text.done');
        isAssistantOrUserSpeaking = false;
        hasStartedReading = false;
        hideThinkingIndicator();
        const finalText = updateAssistantMessage(event.text, true);
        addMessageToConversation('assistant', event.text);
        resetConversationTimeout();
        return;
    } else if (event.type === 'output_audio_buffer.started') {
        isAssistantOrUserSpeaking = true;
        return;
    } else if (event.type === 'output_audio_buffer.done') {
        console.log('output_audio_buffer.done');
        isAssistantOrUserSpeaking = false;
        resetConversationTimeout();
        return;
    } else if (event.type === 'output_audio_buffer.stopped') {
        isAssistantOrUserSpeaking = false;
        resetConversationTimeout();
        console.log('output_audio_buffer.stopped');
        return;
    } else if (event.type === 'response.done') {
        hideThinkingIndicator();
        return;
    } else {
        return;
    }
};

const clearSessionData = async () => {
    try {
        console.log('Clearing session data...');
        // Reset all state variables
        userData = {
            _initialized: true
        };
        conversationMessages = [];
        lastUpdatedField = null;
        isAssistantOrUserSpeaking = false;
        hasStartedReading = false;
        isRecoveryMode = false;
        recentToolCalls.clear();
        
        console.log('Resetting WebSocket state...');
        if (ws) {
            console.log('WebSocket state before cleanup:', ws.readyState);
            try { ws.close(); } catch(e) { console.error('Error closing WebSocket:', e); }
            ws = null;
        }
        
        const response = await fetch('/clear-voice-flow-session/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }
        });
        const result = await response.json();
        
        if (result.success) {
            console.log('Backend session cleared successfully');
            checklist = result.checklist;
            renderChecklist(checklist, userData, lastUpdatedField);
            updateUserDataPanel(userData, lastUpdatedField);
            console.log('UI updated with cleared state');
        }
        
        // Ensure audio contexts are properly closed
        if (captureAudioContext) {
            console.log('Closing capture audio context...');
            try { await captureAudioContext.close(); } catch(e) { console.error('Error closing capture context:', e); }
            captureAudioContext = null;
        }
        if (playbackAudioContext) {
            console.log('Closing playback audio context...');
            try { await playbackAudioContext.close(); } catch(e) { console.error('Error closing playback context:', e); }
            playbackAudioContext = null;
        }
        
        console.log('Session data cleanup completed');
    } catch (error) {
        console.error('Error during session cleanup:', error);
    }
};

const handlePageUnload = (event) => {
    if (!isPageRefreshing) {
        isPageRefreshing = true;
        if (window.transcriptObserver) window.transcriptObserver.disconnect();
        if (window.scrollToBottomBtn) window.scrollToBottomBtn.remove();
        clearSessionData();
        if (isRecording) { disconnect(); }
    }
};

const handlePageLoad = () => {
    const navigationEntries = performance.getEntriesByType('navigation');
    if (navigationEntries.length > 0 && navigationEntries[0].type === 'reload') {
        clearSessionData();
        checklist = [];
        renderChecklist(checklist, userData, lastUpdatedField);
        updateButtonStates(isRecording);
        updateConnectionButton('not-connected');
        setTranscriptPlaceholder();
    } else {
        const initialStateElement = document.getElementById('voice-flow-initial-state');
        const initialState = JSON.parse(initialStateElement.textContent);
        checklist = initialState.checklist || [];
        renderChecklist(checklist, userData, lastUpdatedField);
        updateButtonStates(isRecording);
        setTranscriptPlaceholder();
    }
};

const resetConversation = () => {
    clearTranscript();
    conversationMessages.length = 0;
    clearCurrentAssistantMessage();
    ensureTranscriptScroll();
};

const startInterview = async () => {
    console.log('Starting interview process...');
    
    if (isRecording) {
        console.log('Interview already in progress, skipping start');
        return;
    }
    
    // First ensure we're starting with a clean slate
    console.log('Performing initial cleanup...');
    await disconnect();
    await clearSessionData();
    
    console.log('Initializing new interview...');
    if (!isRecoveryMode) {
        console.log('Fresh start - resetting conversation');
        resetConversation();
        clearRecoverySession();
    } else {
        console.log('Recovery mode - restoring previous session');
        showThinkingIndicator('re-collecting-data');
    }
    
    // Initialize conversation state
    console.log('Setting up conversation state...');
    conversationStartTime = new Date().toISOString();
    isManualDisconnect = false;
    isDisconnecting = false;
    
    // Update UI and add initial message
    console.log('Updating UI state...');
    updateConnectionButton('connecting');
    addMessageToConversation('system', 'Patient intake conversation started in English');
    resetConversationTimeout();
    
    // Attempt WebSocket connection
    console.log('Establishing WebSocket connection...');
    try {
        const wsResponse = await startWebSocketVoice();
        if (wsResponse.error) {
            throw new Error(wsResponse.error);
        }
        console.log('WebSocket connection established successfully');
        
        // Additional verification of connection state
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket connection not properly established');
        }
        
    } catch (error) {
        console.error('Error during interview start:', error);
        await disconnect();
        updateConnectionButton('failed');
        popupMessage('Failed to start conversation. Please try again.', 'error', 5000);
    }
};

const disconnect = async () => {
    console.log('Starting disconnect process...');
    if (isDisconnecting) {
        console.log('Already disconnecting, skipping...');
        return;
    }
    
    isDisconnecting = true;
    console.log('Cleaning up timeouts and intervals...');
    if (conversationTimeout) { 
        clearTimeout(conversationTimeout); 
        conversationTimeout = null; 
        console.log('Conversation timeout cleared');
    }
    
    // Close WebSocket connection
    if (ws) {
        console.log('Closing WebSocket connection, current state:', ws.readyState);
        try { 
            ws.close(); 
            console.log('WebSocket closed successfully');
        } catch (e) { 
            console.error('Error closing WebSocket:', e); 
        }
        ws = null;
    }
    
    // Clean up WebRTC connections
    console.log('Cleaning up WebRTC connections...');
    if (dc) { try { dc.close(); } catch (e) { console.error('Error closing data channel:', e); } dc = null; }
    if (pc) { try { pc.close(); } catch (e) { console.error('Error closing peer connection:', e); } pc = null; }
    
    // Stop media streams
    console.log('Stopping media streams...');
    if (stream) {
        try {
            stream.getTracks().forEach(t => {
                t.stop();
                console.log('Track stopped:', t.kind);
            });
        } catch (e) {
            console.error('Error stopping media tracks:', e);
        }
        stream = null;
    }
    
    // Remove audio elements
    if (remoteAudio) {
        console.log('Removing remote audio element...');
        try { remoteAudio.remove(); } catch (e) { console.error('Error removing audio element:', e); }
        remoteAudio = null;
    }
    
    // Clean up audio processing
    console.log('Cleaning up audio processing...');
    try { 
        if (captureProcessor) {
            captureProcessor.disconnect(); 
            console.log('Capture processor disconnected');
        }
    } catch (e) { console.error('Error disconnecting capture processor:', e); }
    
    try { 
        if (captureSource) {
            captureSource.disconnect(); 
            console.log('Capture source disconnected');
        }
    } catch (e) { console.error('Error disconnecting capture source:', e); }
    
    // Close audio contexts
    console.log('Closing audio contexts...');
    try { 
        if (captureAudioContext) {
            await captureAudioContext.close(); 
            console.log('Capture audio context closed');
        }
    } catch (e) { console.error('Error closing capture audio context:', e); }
    
    try { 
        if (playbackAudioContext) {
            await playbackAudioContext.close(); 
            console.log('Playback audio context closed');
        }
    } catch (e) { console.error('Error closing playback audio context:', e); }
    
    // Reset audio processing variables
    captureProcessor = null;
    captureSource = null;
    captureAudioContext = null;
    playbackAudioContext = null;
    playbackTimeCursor = 0;
    
    // Reset state flags
    console.log('Resetting state flags...');
    isRecording = false;
    isAssistantOrUserSpeaking = false;
    hasStartedReading = false;
    
    // Update UI
    console.log('Updating UI elements...');
    updateButtonStates(isRecording);
    updateConnectionButton('not-connected');
    hideThinkingIndicator();
    setTranscriptPlaceholder();
    
    // Clean up reconnection state
    console.log('Cleaning up reconnection state...');
    cancelScheduledReconnection();
    isRecoveryMode = false;
    reconnectAttempts = 0;
    
    // Reset tool calls cache
    console.log('Clearing tool calls cache...');
    recentToolCalls.clear();
    
    // Stop live transcription
    console.log('Stopping live transcription...');
    stopLiveTranscription();
    clearLiveTranscript();
    
    isDisconnecting = false;
    console.log('Disconnect process completed');
};

const stopInterview = () => {
    isManualDisconnect = true;
    clearGeneratedOrOptionContentDisplayPanel();
    clearSessionData();
    resetConversationTimeout();
    disconnect();
    resetConversation();
    setTranscriptPlaceholder();
    clearCurrentAssistantMessage();
    cancelScheduledReconnection();
    hideThinkingIndicator();
    isRecoveryMode = false;
    reconnectAttempts = 0;
};

const prevalidateData = () => {
    Object.keys(userData).forEach(key => {
        if (key === 'dob' && typeof userData[key] === 'string') {
            const raw = userData[key].trim();
            const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (slashMatch) {
                const mm = slashMatch[1].padStart(2, '0');
                const dd = slashMatch[2].padStart(2, '0');
                const yyyy = slashMatch[3];
                userData[key] = `${yyyy}-${mm}-${dd}`;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                userData[key] = raw;
            } else {
                userData[key] = raw;
            }
        }
        if (typeof userData[key] === 'undefined') {
            userData[key] = null;
        } else if (typeof userData[key] === 'string') {
            const value = userData[key].toLowerCase();
            if (value === 'yes') userData[key] = true;
            else if (value === 'no') userData[key] = false;
            else if (value === 'not-needed') userData[key] = null;
        }
    });
};

const savePatientToDatabase = async () => {
    prevalidateData();
    try {
        const transcriptData = { ...userData };
        const response = await fetch('/api/appointments/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() },
            body: JSON.stringify(transcriptData)
        });
        const result = await response.json();
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
};

const uploadInsuranceAttachment = async (appointmentId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch(`/api/appointments/${appointmentId}/attachments/`, { method: 'POST', headers: { 'X-CSRFToken': getCSRFToken() }, body: fd });
    return resp.json();
};

const saveConversationToDatabase = async () => {
    try {
        const conversationData = {
            action: 'save_conversation_to_database',
            title: `Patient Intake Conversation - ${conversationStartTime}`,
            messages: conversationMessages,
            conversation_start_time: conversationStartTime,
            conversation_end_time: new Date().toISOString(),
            total_messages: conversationMessages.length
        };
        const response = await fetch('/save/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }, body: JSON.stringify(conversationData) });
        const result = await response.json();
        if (result.success) { console.log('Conversation saved successfully'); return true; }
        else { console.error('Failed to save conversation:', result.error); return false; }
    } catch (error) { console.error('Error saving conversation:', error); }
};

const updateChecklistStatuses = () => {
    checklist.forEach((item, index) => {
        const references = item.references || [];
        const filledCount = references.filter(ref => userData[ref] !== undefined && userData[ref] !== null && userData[ref] !== '').length;
        if (filledCount === 0) checklist[index].status = 'pending';
        else if (filledCount === references.length) checklist[index].status = 'completed';
        else checklist[index].status = 'partially_completed';
    });
    renderChecklist(checklist, userData, lastUpdatedField);
    updateUserDataPanel(userData, lastUpdatedField);
};

const redirectToAppointment = (appointmentId) => {
    document.body.classList.add('fade-out');
    setTimeout(() => {
        window.location.href = `/appointments/?appointment_id=${appointmentId}`;
        clearSessionData();
        localStorage.removeItem(RECOVERY_STORAGE_KEY);
    }, 2000);
};

const redirectToVoiceFlow = () => {
    setTimeout(() => {
        clearSessionData();
        localStorage.removeItem(RECOVERY_STORAGE_KEY);
        window.location.replace('/conversation/');
    }, 1000);
};

export const initVoiceFlow = () => {
    const startButton = document.getElementById('start-btn');
    const stopButton = document.getElementById('stop-btn');
    if (startButton) startButton.addEventListener('click', startInterview);
    if (stopButton) stopButton.addEventListener('click', stopInterview);
    const initialStateElement = document.getElementById('voice-flow-initial-state');
    const initialState = JSON.parse(initialStateElement.textContent);
    checklist = initialState.checklist || [];
    renderChecklist(checklist, userData, lastUpdatedField);
    updateButtonStates(isRecording);
    updateUserDataPanel(userData, lastUpdatedField);
    window.addEventListener('beforeunload', handlePageUnload);
    window.addEventListener('pagehide', handlePageUnload);
    window.addEventListener('online', () => { if (isRecoveryMode && !isRecording) { cancelScheduledReconnection(); scheduleReconnection(); } });
    window.addEventListener('offline', () => { if (isRecording) handleConnectionFailure(); });
    handlePageLoad();
};


