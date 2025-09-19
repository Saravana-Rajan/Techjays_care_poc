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
let userData = {};
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

const USER_RESPONSE_DEDUP_THRESHOLD_MS = 2000;
const CONVERSATION_TIMEOUT_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 100;
const RECONNECT_BASE_DELAY_MS = 3500;
const RECOVERY_STORAGE_KEY = 'voice_flow_recovery_session';
const CONNECTION_TIMEOUT_MS = 10000;

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
    // conversationTimeout = setTimeout(() => {
    //     if (isRecording && !isAssistantOrUserSpeaking) {
    //         console.log('Conversation timeout - AI may be stuck');
    //         const timeoutMessage = `(System: The conversation seems to have paused. Please ask the user for clarification in English, then continue following the given instructions.)`;
    //         formatAndSendSystemMessageText(timeoutMessage);
    //     }
    // }, CONVERSATION_TIMEOUT_MS);
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
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    [track] = stream.getAudioTracks();
    captureAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    captureSource = captureAudioContext.createMediaStreamSource(stream);
    captureProcessor = captureAudioContext.createScriptProcessor(4096, 1, 1);
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
                ws.send(JSON.stringify({
                    type: 'setup',
                    model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
                    voice: 'Aoede',
                    instructions: instructions
                }));

                if (isRecoveryMode) {
                    showThinkingIndicator('re-collecting-data');
                    hideThinkingIndicator();
                }
                resolve({ ok: true });
            } catch (err) { 
                reject(err); 
            }
        };
        
        ws.onmessage = async (evt) => {
            try {
                const message = JSON.parse(evt.data);

                console.log('message>>>>>>>>>>>>>>>>>>', message.type);
                if (message.type === 'audio' && message.data) {
                    playPcm16Chunk(message.data, (message.mime_type || 'audio/pcm;rate=24000'));
                    // Also update transcript using our existing handler for consistency
                    // Removed fake transcript dispatch to avoid noise
                } else if (message.type === 'text' && message.text) {
                    // Speak via Web Speech API as a fallback when model returns TEXT
                    try {
                        const utter = new SpeechSynthesisUtterance(message.text);
                        utter.rate = 0.95; // slightly slower for clarity
                        utter.pitch = 1.0;
                        utter.lang = 'en-US';
                        window.speechSynthesis.cancel();
                        window.speechSynthesis.speak(utter);
                    } catch (e) {
                        console.warn('TTS failed', e);
                    }
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
                    // Deduplicate identical saves for 3s window to avoid loops
                    try {
                        const args = JSON.parse(message.arguments || '{}');
                        if (args && args.field_name) {
                            const key = `${(args.field_name || '').toLowerCase().trim()}::${String(args.value || '').trim()}`;
                            const now = Date.now();
                            const lastTs = recentToolCalls.get(key) || 0;
                            
                            // Only block if it's the exact same field and value within 3 seconds
                            // Allow different values for the same field (user corrections)
                            if (now - lastTs < 3000) {
                                console.log('Blocking duplicate function call:', key);
                                // Send response to Gemini that the call was already processed
                                const duplicateResponse = `Function call already processed: Field "${args.field_name}" with value "${args.value}" was already handled. Please proceed to the next step.`;
                                formatAndSendSystemMessageText(duplicateResponse);
                                return;
                            }
                            recentToolCalls.set(key, now);
                        }
                    } catch (e) {
                        console.error('Error in deduplication logic:', e);
                    }
                    await handleServerEvent(message);
                } else if (message.type === 'response.function_call.done') {
                    // Handle function call completion
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
            reject(new Error('WebSocket error'));
        };
        
        ws.onclose = () => {
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
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return pcm;
    }
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
        const sample = accum / (count || 1);
        const s = Math.max(-1, Math.min(1, sample));
        pcm[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return pcm;
};

const playPcm16Chunk = (base64Data, mimeType) => {
    try {
        const rateMatch = /rate=(\d+)/.exec(mimeType || '');
        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
        const raw = atob(base64Data);
        const buf = new ArrayBuffer(raw.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
        const pcm16 = new Int16Array(buf);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;
        if (!playbackAudioContext) playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
        const audioBuffer = playbackAudioContext.createBuffer(1, float32.length, sampleRate);
        audioBuffer.copyToChannel(float32, 0);
        const source = playbackAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackAudioContext.destination);
        const now = playbackAudioContext.currentTime;
        const startAt = Math.max(now, playbackTimeCursor);
        source.start(startAt);
        playbackTimeCursor = startAt + audioBuffer.duration;
    } catch (e) {
        console.error('Failed to play PCM chunk', e);
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
            ws.send(JSON.stringify({ type: 'text', text: systemMessageText }));
        }
    } catch (e) { console.warn('Failed to send system text to Gemini WS', e); }
};

const formatAndValidateFieldValues = (fieldName, value) => {
    // TODO: Optimization of validation for the field options
    let finalUpdatedField = fieldName;
    let isError = false;
    if (fieldName === 'full_name' || fieldName === 'dob' || fieldName === 'gender' || fieldName === 'contact_number' || fieldName === 'reason_for_visit' || fieldName === 'symptoms') {
        if (value === 'not-needed') {
            const systemMessage = `Field "${fieldName}" is required. Ask the user to provide it.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'dob' || fieldName === 'gender' || fieldName === 'contact_number') {
        if (!('full_name' in userData)) {
            const systemMessage = `Missing dependency: full_name. Confirm with user and save before collecting "${fieldName}".`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    
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
        const dateRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/\d{4}$/;
        if (!dateRegex.test(value)) {
            const systemMessage = `Invalid date format: "${value}". Expected MM/DD/YYYY. 
            If the error is from AI formatting, fix internally. 
            If from user input, ask again clearly with an example (e.g., "Could you tell me your date of birth again? For example, you can say 12th August 2000.")`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'caller_type' || fieldName === 'reason_for_visit' || fieldName === 'visit_type' || fieldName === 'primary_physician' || fieldName === 'referral_source') {
        if (!('full_name' in userData) || !('dob' in userData) || !('gender' in userData) || !('contact_number' in userData) || !('email' in userData) || !('address' in userData) || !('preferred_language' in userData) || !('emergency_contact_name' in userData) || !('emergency_contact_phone' in userData) || !('relationship_to_patient' in userData)){
            const missingFields = [];
            if (!('full_name' in userData)) missingFields.push('full_name');
            if (!('dob' in userData)) missingFields.push('dob');
            if (!('gender' in userData)) missingFields.push('gender');
            if (!('contact_number' in userData)) missingFields.push('contact_number');
            if (!('email' in userData)) missingFields.push('email');
            if (!('address' in userData)) missingFields.push('address');
            if (!('preferred_language' in userData)) missingFields.push('preferred_language');
            if (!('emergency_contact_name' in userData)) missingFields.push('emergency_contact_name');
            if (!('emergency_contact_phone' in userData)) missingFields.push('emergency_contact_phone');
            if (!('relationship_to_patient' in userData)) missingFields.push('relationship_to_patient');
            const fieldList = missingFields.join(', ');
            const systemMessage = `Missing field(s): ${fieldList}.
            Before saving the current field, you MUST check if all missing field(s) have already been confirmed with the user.
            - If a missing field is already confirmed, save it directly.
            - If a missing field is NOT yet confirmed, you MUST pause and ask the user for it before saving anything further.
            - Only after confirming and saving all missing field(s), continue with the current field and the rest of the conversation.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'symptoms' || fieldName === 'symptom_duration' || fieldName === 'pain_level' || fieldName === 'current_medications' || fieldName === 'allergies' || fieldName === 'medical_history' || fieldName === 'family_history') {
        if (!('caller_type' in userData) || !('reason_for_visit' in userData) || !('visit_type' in userData) || !('primary_physician' in userData) || !('referral_source' in userData) || !('caller_type' in userData)){
            const missingFields = [];
            if (!('caller_type' in userData)) missingFields.push('caller_type');
            if (!('reason_for_visit' in userData)) missingFields.push('reason_for_visit');
            if (!('visit_type' in userData)) missingFields.push('visit_type');
            if (!('primary_physician' in userData)) missingFields.push('primary_physician');
            if (!('referral_source' in userData)) missingFields.push('referral_source');
            if (!('caller_type' in userData)) missingFields.push('caller_type');
            const fieldList = missingFields.join(', ');
            const systemMessage = `Missing field(s): ${fieldList}.
            Before saving the current field, you MUST check if all missing field(s) have already been confirmed with the user.
            - If a missing field is already confirmed, save it directly.
            - If a missing field is NOT yet confirmed, you MUST pause and ask the user for it before saving anything further.
            - Only after confirming and saving all missing field(s), continue with the current field and the rest of the conversation.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
     }
    if (fieldName === 'interpreter_need' || fieldName === 'interpreter_language' || fieldName === 'accessibility_needs' || fieldName === 'dietary_needs') {
        if (!('symptoms' in userData) || !('symptom_duration' in userData) || !('pain_level' in userData) || !('current_medications' in userData) || !('allergies' in userData) || !('medical_history' in userData) || !('family_history' in userData)){
            const missingFields = [];
            if (!('symptoms' in userData)) missingFields.push('symptoms');
            if (!('symptom_duration' in userData)) missingFields.push('symptom_duration');
            if (!('pain_level' in userData)) missingFields.push('pain_level');
            if (!('current_medications' in userData)) missingFields.push('current_medications');
            if (!('allergies' in userData)) missingFields.push('allergies');
            if (!('medical_history' in userData)) missingFields.push('medical_history');
            if (!('family_history' in userData)) missingFields.push('family_history');
            const fieldList = missingFields.join(', ');
            const systemMessage = `Missing field(s): ${fieldList}.
            Before saving the current field, you MUST check if all missing field(s) have already been confirmed with the user.
            - If a missing field is already confirmed, save it directly.
            - If a missing field is NOT yet confirmed, you MUST pause and ask the user for it before saving anything further.
            - Only after confirming and saving all missing field(s), continue with the current field and the rest of the conversation.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    
    if (fieldName === 'consent_share_records' || fieldName === 'preferred_communication_method' || fieldName === 'appointment_availability') {
        if (!('interpreter_need' in userData) || !('interpreter_language' in userData) || !('accessibility_needs' in userData) || !('dietary_needs' in userData)){
            const missingFields = [];
            if (!('interpreter_need' in userData)) missingFields.push('interpreter_need');
            if (!('interpreter_language' in userData)) missingFields.push('interpreter_language');
            if (!('accessibility_needs' in userData)) missingFields.push('accessibility_needs');
            if (!('dietary_needs' in userData)) missingFields.push('dietary_needs');
            const fieldList = missingFields.join(', ');
            const systemMessage = `Missing field(s): ${fieldList}.
            Before saving the current field, you MUST check if all missing field(s) have already been confirmed with the user.
            - If a missing field is already confirmed, save it directly.
            - If a missing field is NOT yet confirmed, you MUST pause and ask the user for it before saving anything further.
            - Only after confirming and saving all missing field(s), continue with the current field and the rest of the conversation.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'email') {
        if (value === 'not-needed') return [value, isError, finalUpdatedField];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            const systemMessage = `Invalid email: "${value}". Expected valid email format.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'contact_number' || fieldName === 'emergency_contact_phone') {
        if (value === 'not-needed') return [value, isError, finalUpdatedField];
        const phoneRegex = /^\d{3}-\d{3}-\d{4}$/;
        if (!phoneRegex.test(value)) {
            const systemMessage = `Invalid phone number: "${value}". Expected format: XXX-XXX-XXXX. 
            If user input is invalid, ask again politely until correct. 
            If AI formatting is wrong, auto-correct before saving.`;          
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'pain_level') {
        const painLevel = parseInt(value);
        if (isNaN(painLevel) || painLevel < 0 || painLevel > 10) {
            const systemMessage = `Invalid pain level: "${value}". Expected a number between 0 and 10.`;
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
            const systemMessage = `Invalid gender. Expected: Male, Female, Other, or Prefer not to say.`;
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
            const systemMessage = `Invalid caller type. Expected: Patient, Parent, Guardian, or Caregiver.`;
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
            const systemMessage = `Invalid visit type. Expected: First-time or Returning.`;
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
            const systemMessage = `Invalid value for "${fieldName}". Expected Yes or No.`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    if (fieldName === 'confirmation' && value.toLowerCase() === 'no') {
        const systemMessage = `User declined confirmation. Ask for required changes and continue intake.`;
        formatAndSendSystemMessageText(systemMessage);
        isError = true;
        return [value, isError];
    }
    if (fieldName === 'confirmation') {
        const requiredFields = ['full_name', 'dob', 'contact_number', 'reason_for_visit', 'symptoms'];
        const missingFields = requiredFields.filter(field => !(field in userData) || !userData[field]);
        if (missingFields.length > 0) {
            const fieldList = missingFields.join(', ');
            const systemMessage = `(System: The following required fields are missing: ${fieldList}. Please collect this information before finalizing the intake form.)`;
            formatAndSendSystemMessageText(systemMessage);
            isError = true;
            return [value, isError];
        }
    }
    return [value, isError, finalUpdatedField];
};

const handleConfirmationFunctionCall = () => {
    openReviewModal(userData, {
        onSavePatient: async (edited) => {
            Object.assign(userData, edited);
            updateUserDataPanel(userData, lastUpdatedField);
            return await savePatientToDatabase();
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
            const clarificationMessage = `(System: The user's response "${userText}" appears to be unclear or background noise. Please ask them to repeat their response more clearly in English.)`;
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
        console.log('Processing function call arguments:', event.arguments);
        console.log('Current userData:', userData);
        
        let args;
        try { 
            args = JSON.parse(event.arguments); 
            console.log('Parsed function call args:', args);
        }
        catch (jsonError) {
            console.error('JSON parsing error in AI function call:', jsonError);
            console.error('Raw arguments:', event.arguments);
            const errorMessage = `(System: There was an error parsing the function call arguments. Please try again with valid JSON format. For field_name, use a simple string value.)`;
            formatAndSendSystemMessageText(errorMessage);
            hideThinkingIndicator();
            return;
        }
        
        if (args && args.field_name) {
            console.log('Processing field:', args.field_name, 'with value:', args.value);
            clearGeneratedOrOptionContentDisplayPanel();
            
            try {
                const [validatedValue, isError, lastUpdatedValidatedField] = formatAndValidateFieldValues(args.field_name, args.value);
                lastUpdatedField = lastUpdatedValidatedField;
                
                if (isError){
                    console.log('Field validation failed for:', args.field_name);
                    const systemMessage = `(System: The field "${args.field_name}" has not been saved. Please resolve the error and save it again.)`;
                    formatAndSendSystemMessageText(systemMessage);
                    return;
                }
                
                // Check if this is actually a new value
                const currentValue = userData[args.field_name];
                if (currentValue === validatedValue) {
                    console.log('Field value unchanged, skipping save:', args.field_name);
                    // Send a proper function call response to Gemini so it knows the call was handled
                    const functionResponse = `Function call completed: Field "${args.field_name}" is already saved with the same value "${args.value}". No action needed. Please proceed to the next step.`;
                    formatAndSendSystemMessageText(functionResponse);
                    return;
                }
                
                userData[args.field_name] = validatedValue;
                console.log('Successfully updated userData:', userData);
                updateUserDataPanel(userData, lastUpdatedField);
                updateChecklistStatuses();
                
                if (args.field_name === 'confirmation'){
                    console.log('Confirmation received, starting final process');
                    isManualDisconnect = true;
                    disconnect();
                    handleConfirmationFunctionCall();
                    return;
                }
                
                const systemMessage = `Function call completed: Field "${args.field_name}" has been saved successfully with value "${args.value}". Please proceed to the next step in the workflow immediately.`;
                formatAndSendSystemMessageText(systemMessage);
                
            } catch (error) {
                console.error('Error saving field:', error);
                console.error('Field name:', args.field_name, 'Value:', args.value);
                popupMessage(`Failed to save ${args.field_name}. Please try again.`, 'error', 5000);
                const errorSystemMessage = `(System: There was an error saving the field. Please ask the user to repeat their response or try again.)`;
                formatAndSendSystemMessageText(errorSystemMessage);
            } finally {
                hideThinkingIndicator();
            }
        } else {
            console.error('Invalid function call arguments - missing field_name:', args);
            const errorMessage = `(System: Invalid function call - missing field name. Please try again.)`;
            formatAndSendSystemMessageText(errorMessage);
            hideThinkingIndicator();
        }
        return;
    } else if (event.type === 'response.function_call.start') {
        showThinkingIndicator('processing');
        return;
    } else if (event.type === 'response.function_call.done') {
        hideThinkingIndicator();
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
        userData = {};
        const response = await fetch('/clear-voice-flow-session/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCSRFToken() }
        });
        const result = await response.json();
        if (result.success) {
            console.log('Session data cleared successfully');
            checklist = result.checklist;
            renderChecklist(checklist, userData, lastUpdatedField);
            updateUserDataPanel(userData, lastUpdatedField);
        }
    } catch (error) {
        console.error('Error clearing session:', error);
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
    if (isRecording) return;
    console.log('Starting interview...');
    if (!isRecoveryMode) {
        resetConversation();
        clearRecoverySession();
    } else {
        showThinkingIndicator('re-collecting-data');
    }
    conversationStartTime = conversationStartTime || new Date().toISOString();
    addMessageToConversation('system', 'Patient intake conversation started in English');
    updateConnectionButton('connecting');
    clearSessionData();
    resetConversationTimeout();
    try {
        const wsResponse = await startWebSocketVoice();
        if (wsResponse.error) throw new Error(wsResponse.error);
    } catch (error) {
        console.error('Error starting interview:', error);
        disconnect();
        updateConnectionButton('failed');
    }
};

const disconnect = () => {
    if (isDisconnecting) return;
    isDisconnecting = true;
    if (conversationTimeout) { clearTimeout(conversationTimeout); conversationTimeout = null; }
    if (ws) { try { ws.close(); } catch {} ws = null; }
    if (dc) { try { dc.close(); } catch {} dc = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (remoteAudio) { remoteAudio.remove(); remoteAudio = null; }
    try { if (captureProcessor) captureProcessor.disconnect(); } catch {}
    try { if (captureSource) captureSource.disconnect(); } catch {}
    try { if (captureAudioContext) captureAudioContext.close(); } catch {}
    try { if (playbackAudioContext) playbackAudioContext.close(); } catch {}
    captureProcessor = null; captureSource = null; captureAudioContext = null; playbackAudioContext = null; playbackTimeCursor = 0;
    isRecording = false;
    updateButtonStates(isRecording);
    updateConnectionButton('not-connected');
    hideThinkingIndicator();
    setTranscriptPlaceholder();
    cancelScheduledReconnection();
    isRecoveryMode = false;
    reconnectAttempts = 0;
    isDisconnecting = false;
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


