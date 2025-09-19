import parseMarkdown from './marked.js';

// UI-only state
let currentAssistantText = '';
let userScrolledUp = false;
let transcriptObserver = null;
let scrollToBottomBtn = null;

const NOT_APPLICABLE_STRING = 'not-applicable';
const PANEL_UPDATE_SCROLL_TIMEOUT_MS = 100;

const getTranscriptElements = () => {
    const transcriptDiv = document.getElementById('transcript');
    const transcriptContainer = transcriptDiv?.parentElement;
    return { transcriptDiv, transcriptContainer };
};

// Thinking indicator
export const showThinkingIndicator = (state = 'thinking') => {
    const thinkingEl = document.getElementById('ai-thinking');
    const thinkingText = document.getElementById('ai-thinking-text');
    if (thinkingEl && thinkingText) {
        thinkingEl.classList.remove('hidden');
        thinkingEl.classList.add('flex');
        const stateTextMap = {
            'thinking': 'Assistant is thinking...',
            'processing': 'Assistant is processing...',
            'listening': 'Assistant is listening...',
            'reading': 'Assistant is reading...',
            'reconnecting': 'Assistant is reconnecting to network...',
            're-collecting-data': 'Assistant is re-collecting data...'
        };
        thinkingText.textContent = stateTextMap[state] || 'Hiring Assistant is Working...';
    }
};

export const hideThinkingIndicator = () => {
    const thinkingEl = document.getElementById('ai-thinking');
    if (thinkingEl) {
        thinkingEl.classList.add('hidden');
        thinkingEl.classList.remove('flex');
    }
};

// Buttons & connection
export const updateButtonStates = (isRecording) => {
    const startButton = document.getElementById('start-btn');
    const stopButton = document.getElementById('stop-btn');
    if (startButton) startButton.disabled = isRecording;
    if (stopButton) stopButton.disabled = !isRecording;
};

export const updateConnectionButton = (status = 'not-connected') => {
    const connectionBtn = document.getElementById('connection-btn');
    if (!connectionBtn) return;
    const buttonConfig = {
        connected: { text: 'Connected', className: 'status-indicator status-success', disabled: false },
        failed: { text: 'Connection Failed', className: 'status-indicator status-danger', disabled: false },
        connecting: { text: 'Connecting...', className: 'status-indicator status-warning', disabled: true },
        'not-connected': { text: 'Not Connected', className: 'status-indicator status-neutral', disabled: false },
        reconnecting: { text: 'Reconnecting...', className: 'status-indicator status-warning', disabled: true }
    };
    const config = buttonConfig[status] || buttonConfig['not-connected'];
    connectionBtn.textContent = config.text;
    connectionBtn.className = config.className;
    connectionBtn.disabled = config.disabled;
};

export const clearCurrentAssistantMessage = () => {
    const currentAssistantMessage = document.getElementById('current-assistant-message');
    if (currentAssistantMessage) {
        currentAssistantMessage.remove();
        currentAssistantText = '';
    }
};

// Checklist UI
export const renderChecklist = (checklist, userData = {}, lastUpdatedField = null) => {
    const checklistUI = document.getElementById('checklist');
    if (!checklistUI) return;
    // Overall progress elements (in header)
    const progressBar = document.getElementById('checklist-progress-bar');
    const progressContainer = document.getElementById('checklist-progress-container');
    // Compute overall progress: total answered fields across all checklist references
    try {
        let percent = 0;
        // Primary: compute by counting field references across all items
        let uniqueRefs = new Set();
        if (Array.isArray(checklist)) {
            checklist.forEach((item) => {
                const refs = Array.isArray(item.references) ? item.references : [];
                refs.forEach((r) => uniqueRefs.add(r));
            });
        }
        const totalFields = uniqueRefs.size;
        if (totalFields > 0) {
            let filledFields = 0;
            uniqueRefs.forEach((ref) => {
                const v = userData ? userData[ref] : undefined;
                if (v !== undefined && v !== null && v !== '') filledFields += 1;
            });
            percent = Math.round((filledFields / totalFields) * 100);
        } else {
            // Fallback: derive from item statuses (completed=1, partial=0.5, pending=0)
            const totalItems = Array.isArray(checklist) ? checklist.length : 0;
            if (totalItems > 0) {
                let score = 0;
                checklist.forEach((item) => {
                    if (item.status === 'completed') score += 1;
                    else if (item.status === 'partially_completed') score += 0.5;
                });
                percent = Math.round((score / totalItems) * 100);
            }
        }
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            let startColor;
            let endColor;
            if (percent >= 66) { 
                startColor = '#22c55e';
                endColor = '#16a34a';
            } else if (percent >= 33) { 
                startColor = '#60a5fa';
                endColor = '#3b82f6';
            } else { 
                startColor = '#facc15';
                endColor = '#eab308';
            }
            progressBar.style.background = `linear-gradient(90deg, ${startColor} 0%, ${endColor} 100%)`;
        }
        if (progressContainer && progressContainer.setAttribute) {
            progressContainer.setAttribute('aria-valuenow', String(percent));
        }
    } catch {}
    checklistUI.innerHTML = '';
    checklist.forEach((item, index) => {
        const li = document.createElement('li');
        li.id = `checklist-item-${index}`;
        li.className = 'transition-colors duration-300';

        if (item.status === 'completed') {
            li.classList.add('text-green-600');
        } else if (item.status === 'partially_completed') {
            li.classList.add('text-yellow-600');
        } else {
            li.classList.add('text-gray-700');
        }

        const container = document.createElement('div');
        container.className = 'flex items-start';

        const icon = document.createElement('span');
        icon.className = 'w-6 h-6 mr-3 mt-0.5 border-2 rounded-full flex items-center justify-center transition-all duration-300 flex-shrink-0';
        if (item.status === 'completed') {
            icon.classList.add('bg-green-500', 'border-green-500', 'text-white');
            icon.innerHTML = '✓';
        } else if (item.status === 'partially_completed') {
            icon.classList.add('bg-yellow-500', 'border-yellow-500', 'text-white');
            icon.innerHTML = '○';
        } else {
            icon.classList.add('border-gray-400');
            icon.innerHTML = '';
        }

        const content = document.createElement('div');
        content.className = 'flex-1 min-w-0';

        const title = document.createElement('div');
        title.className = 'font-medium text-sm';
        if (item.status === 'completed') {
            title.classList.add('text-green-700');
        } else if (item.status === 'partially_completed') {
            title.classList.add('text-yellow-700');
        } else {
            title.classList.add('text-gray-800');
        }
        title.textContent = item.title || item.text || 'Untitled';

        const description = document.createElement('div');
        description.className = 'text-xs text-gray-500 mt-1 leading-relaxed';
        description.textContent = item.description || '';

        content.appendChild(title);
        content.appendChild(description);

        // Removed per-section inline progress bars; progress now shown in top bar only
        container.appendChild(icon);
        container.appendChild(content);
        li.appendChild(container);
        checklistUI.appendChild(li);
    });
};

// Transcript helpers
export const setTranscriptPlaceholder = () => {
    const { transcriptDiv } = getTranscriptElements();
    if (!transcriptDiv) return;
    if (!transcriptDiv.hasChildNodes()) {
        transcriptDiv.innerHTML = '<div class="text-gray-400 italic text-center py-8">Once you are ready to start the interview, click the "Start" button.</div>';
    } else if (transcriptDiv && transcriptDiv.hasChildNodes()) {
        const hasContentNodes = Array.from(transcriptDiv.childNodes).some(node => 
            node.nodeType === Node.ELEMENT_NODE || 
            (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        );
        if (!hasContentNodes) {
            transcriptDiv.innerHTML = '<div class="text-gray-400 italic text-center py-8">Once you are ready to start the interview, click the "Start" button.</div>';
        }
    }
};

export const clearTranscriptPlaceholder = () => {
    const { transcriptDiv } = getTranscriptElements();
    if (transcriptDiv && transcriptDiv.children.length === 1 && 
        transcriptDiv.children[0].textContent === 'Once you are ready to start the interview, click the "Start" button.') {
        transcriptDiv.innerHTML = '';
        ensureTranscriptScroll();
    }
};

export const clearTranscript = () => {
    const { transcriptDiv } = getTranscriptElements();
    if (transcriptDiv) {
        transcriptDiv.innerHTML = '';
        ensureTranscriptScroll();
    }
};

// Content panel
export const clearGeneratedOrOptionContentDisplayPanel = () => {
    const contentPanel = document.getElementById('content-display-panel');
    const defaultState = document.getElementById('content-default-state');
    if (contentPanel) contentPanel.classList.add('hidden');
    if (defaultState) defaultState.classList.remove('hidden');
};

// Live transcription display
export const createLiveTranscriptionElement = () => {
    const { transcriptDiv } = getTranscriptElements();
    if (!transcriptDiv) return;
    
    // Check if live transcription element already exists
    let liveTranscriptionEl = document.getElementById('live-transcription');
    if (!liveTranscriptionEl) {
        liveTranscriptionEl = document.createElement('div');
        liveTranscriptionEl.id = 'live-transcription';
        liveTranscriptionEl.className = 'live-transcription';
        liveTranscriptionEl.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(59, 130, 246, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            font-size: 16px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-width: 80%;
            text-align: center;
            z-index: 1000;
            display: none;
            transition: all 0.3s ease;
            word-wrap: break-word;
        `;
        
        // Add pulsing animation for interim results
        const style = document.createElement('style');
        style.textContent = `
            .live-transcription.interim {
                animation: pulse 1.5s ease-in-out infinite;
            }
            @keyframes pulse {
                0% { opacity: 0.8; }
                50% { opacity: 1; }
                100% { opacity: 0.8; }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(liveTranscriptionEl);
    }
    
    return liveTranscriptionEl;
};

// Transcript message rendering
export const appendMessage = (role, text) => {
    const { transcriptDiv } = getTranscriptElements();
    if (!transcriptDiv) return;
    if (!text.trim() && role !== 'assistant') return;
    clearTranscriptPlaceholder();
    const messageEl = document.createElement('div');
    const baseClasses = 'p-4 my-3 rounded-lg shadow-sm border break-words overflow-hidden';
    const roleClasses = {
        user: 'bg-blue-50 text-right border-blue-200',
        assistant: 'bg-white border-gray-200 text-left',
        system: 'bg-yellow-50 text-xs italic hidden border-yellow-200'
    };
    messageEl.className = `${baseClasses} ${roleClasses[role] || ''}`;
    if (role === 'assistant') {
        messageEl.innerHTML = parseMarkdown(text);
    } else {
        messageEl.textContent = text;
    }
    if (role === 'assistant' && !document.getElementById('current-assistant-message')) {
        messageEl.id = 'current-assistant-message';
    }
    transcriptDiv.appendChild(messageEl);
    ensureTranscriptScroll();
};

export const updateAssistantMessage = (text, isFinal) => {
    const { transcriptDiv } = getTranscriptElements();
    if (!transcriptDiv) return null;
    let messageDiv = document.getElementById('current-assistant-message');
    if (!messageDiv) {
        appendMessage('assistant', '');
        messageDiv = document.getElementById('current-assistant-message');
        currentAssistantText = '';
    }
    if (!isFinal) {
        currentAssistantText += text;
        messageDiv.innerHTML = parseMarkdown(currentAssistantText);
        scrollToBottomImmediate();
        return null;
    } else {
        const finalText = currentAssistantText || text;
        messageDiv.innerHTML = parseMarkdown(finalText);
        messageDiv.id = '';
        currentAssistantText = '';
        ensureTranscriptScroll();
        return finalText;
    }
};

// Field formatting helpers
export const formatFieldValueForDisplay = (fieldName, value) => {
    if (value === null || value === undefined) return 'Not set';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (value === 'not-needed') return '-';
    if (fieldName === 'medical_history' && typeof value === 'object') {
        let formatted = '';
        if (value.conditions) formatted += `<span style="font-weight:600;">Medical Conditions:</span>\n${value.conditions}\n\n`;
        if (value.surgeries) formatted += `<span style="font-weight:600;">Surgeries:</span>\n${value.surgeries}\n\n`;
        if (value.hospitalizations) formatted += `<span style=\"font-weight:600;\">Hospitalizations:</span>\n${value.hospitalizations}`;
        return formatted || 'No medical history provided';
    }
    if (fieldName === 'symptoms' && typeof value === 'object') {
        let formatted = '';
        if (value.description) formatted += `<span style=\"font-weight:600;\">Symptom Description:</span>\n${value.description}\n\n`;
        if (value.severity) formatted += `<span style=\"font-weight:600;\">Severity:</span> ${value.severity}\n\n`;
        if (value.onset) formatted += `<span style=\"font-weight:600;\">Onset:</span> ${value.onset}`;
        return formatted || 'No symptoms provided';
    }
    if (fieldName === 'allergies' && typeof value === 'object') {
        let formatted = '';
        if (value.medications) formatted += `<span style=\"font-weight:600;\">Medication Allergies:</span>\n${value.medications}\n\n`;
        if (value.food) formatted += `<span style=\"font-weight:600;\">Food Allergies:</span>\n${value.food}\n\n`;
        if (value.environmental) formatted += `<span style=\"font-weight:600;\">Environmental Allergies:</span>\n${value.environmental}`;
        return formatted || 'No allergies reported';
    }
    if (fieldName === 'current_medications' && typeof value === 'object') {
        let formatted = '';
        if (value.medications) formatted += `<span style=\"font-weight:600;\">Current Medications:</span>\n${value.medications}\n\n`;
        if (value.dosages) formatted += `<span style=\"font-weight:600;\">Dosages:</span>\n${value.dosages}\n\n`;
        if (value.frequency) formatted += `<span style=\"font-weight:600;\">Frequency:</span>\n${value.frequency}`;
        return formatted || 'No current medications';
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return 'None';
        return value.map(item => `• ${item}`).join('\n');
    }
    if (typeof value === 'string') {
        if (value === NOT_APPLICABLE_STRING) return 'Not applicable';
        if (value === 'yes') return 'Yes';
        if (value === 'no') return 'No';
        // Handle DOB format conversion
        if (fieldName === 'dob') {
            const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (isoMatch) {
                const [_, yyyy, mm, dd] = isoMatch;
                return `${mm}/${dd}/${yyyy}`;
            }
        }
        if (value.startsWith('[') && value.endsWith(']')) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    if (parsed.length === 0) return 'None';
                    return parsed.map(item => `• ${item}`).join('\n');
                }
            } catch {}
        }
        return value;
    }
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return value.toString();
};

export const getFieldDisplayName = (fieldName) => {
    const displayNames = {
        'full_name': 'Full Name',
        'dob': 'Date of Birth',
        'gender': 'Gender',
        'contact_number': 'Contact Number',
        'email': 'Email Address',
        'address': 'Home Address',
        'preferred_language': 'Preferred Language',
        'emergency_contact_name': 'Emergency Contact Name',
        'emergency_contact_phone': 'Emergency Contact Phone',
        'caller_type': 'Caller Type',
        'relationship_to_patient': 'Relationship to Patient',
        'reason_for_visit': 'Reason for Visit',
        'visit_type': 'Visit Type',
        'primary_physician': 'Primary Care Physician',
        'referral_source': 'Referral Source',
        'symptoms': 'Current Symptoms',
        'symptom_duration': 'Duration of Symptoms',
        'pain_level': 'Pain Level',
        'current_medications': 'Current Medications',
        'allergies': 'Known Allergies',
        'medical_history': 'Past Medical History',
        'family_history': 'Family Medical History',
        'interpreter_need': 'Interpreter Need',
        'interpreter_language': 'Interpreter Language',
        'accessibility_needs': 'Mobility / Accessibility Needs',
        'dietary_needs': 'Dietary Considerations',
        'consent_share_records': 'Consent to Share Records',
        'preferred_communication_method': 'Preferred Communication Method',
        'appointment_availability': 'Appointment Availability',
        'confirmation': 'Final Confirmation'
    };
    return displayNames[fieldName] || fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const isExpandableField = (fieldName, value) => {
    const alwaysExpandable = ['symptoms', 'medical_history', 'family_history', 'allergies', 'current_medications', 'accessibility_needs', 'dietary_needs', 'address'];
    if (alwaysExpandable.includes(fieldName)) return true;
    if (typeof value === 'string' && value.length > 100) return true;
    if (typeof value === 'object' && value !== null) return true;
    if (Array.isArray(value) && value.length > 1) return true;
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) && parsed.length > 1) return true;
        } catch {}
    }
    return false;
};

export const updateUserDataPanel = (userData, lastUpdatedField) => {
    console.log('=== updateUserDataPanel CALLED ===');
    console.log('userData:', userData);
    console.log('lastUpdatedField:', lastUpdatedField);
    
    const panel = document.getElementById('job-form-panel-display');
    const contentDiv = document.getElementById('job-form-panel-content');
    
    console.log('Panel element:', panel);
    console.log('Content div element:', contentDiv);
    
    if (!panel || !contentDiv) {
        console.log('Panel or content div not found, returning');
        return;
    }

    const dataEntries = Object.entries(userData || {});
    console.log('Data entries count:', dataEntries.length);
    console.log('Data entries:', dataEntries);
    
    // Filter out system fields
    const filteredEntries = dataEntries.filter(([key, value]) => key !== '_initialized');
    console.log('Filtered entries count:', filteredEntries.length);
    console.log('Filtered entries:', filteredEntries);
    
    if (filteredEntries.length === 0) {
        contentDiv.innerHTML = `
                <div class="text-center py-12">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                        <svg class="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <h3 class="text-lg font-semibold text-slate-900 mb-2">No Data Yet</h3>
                    <p class="text-sm text-slate-500 max-w-sm mx-auto">Patient information will appear here as you fill out the intake form during the conversation.</p>
                </div>
            `;
        return;
    }

    const fieldGroups = {
        'Patient Information': ['full_name', 'dob', 'gender', 'contact_number', 'email', 'address', 'preferred_language', 'emergency_contact_name', 'emergency_contact_phone', 'relationship_to_patient'],
        'Visit & Care Context': ['caller_type', 'reason_for_visit', 'visit_type', 'primary_physician', 'referral_source'],
        'Medical Information': ['symptoms', 'symptom_duration', 'pain_level', 'current_medications', 'allergies', 'medical_history', 'family_history'],
        'Accessibility & Support Needs': ['interpreter_need', 'interpreter_language', 'accessibility_needs', 'dietary_needs'],
        'Consent & Preferences': ['consent_share_records', 'preferred_communication_method', 'appointment_availability'],
        'Final Confirmation': ['confirmation'],
    };

    let html = `<div class="space-y-6">`;
    Object.entries(fieldGroups).forEach(([groupName, groupFields]) => {
        const groupData = filteredEntries.filter(([fieldName]) => groupFields.includes(fieldName));
        console.log(`Group "${groupName}":`, groupData.length, 'fields');
        if (groupData.length > 0) {
            console.log(`Rendering group "${groupName}" with fields:`, groupData);
            html += `
                    <div class="space-y-4">
                        <div class="border-b border-slate-200 pb-3">
                            <h4 class="text-lg font-semibold text-slate-800">${groupName}</h4>
                        </div>
                        <div class="space-y-3">
                `;
            groupData.forEach(([fieldName, value]) => {
                const displayName = getFieldDisplayName(fieldName);
                const formattedValue = formatFieldValueForDisplay(fieldName, value);
                const isExpandable = isExpandableField(fieldName, value);
                const fieldId = `field-${fieldName}`;
                const isLastUpdated = lastUpdatedField === fieldName;
                let statusClass = '';
                if (isLastUpdated) {
                    statusClass = 'border-blue-300 bg-blue-50 shadow-md';
                } else {
                    statusClass = 'border-slate-200 bg-slate-50';
                }
                html += `
                        <div class="bg-white rounded-lg border ${statusClass} shadow-sm hover:shadow-md transition-all duration-200 ease-in-out ${isLastUpdated ? 'ring-2 ring-blue-200' : ''}" id="field-container-${fieldName}">
                            <div class="p-4">
                                <div class="flex items-start justify-between">
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center mb-3">
                                            <h5 class="text-sm font-semibold text-slate-900 leading-tight">${displayName}</h5>
                                        </div>
                                        <div class="text-sm text-slate-700 leading-relaxed">
                                            ${isExpandable ? 
                                                `<div class="truncate" id="${fieldId}-preview">${formattedValue}</div>
                                                <div class="hidden mt-2 whitespace-pre-wrap break-words" id="${fieldId}-full">${formattedValue}</div>` :
                                                `<div class="whitespace-pre-wrap">${formattedValue}</div>`
                                            }
                                        </div>
                                    </div>
                                    ${isExpandable ? 
                                        `<button onclick="toggleFieldExpansion('${fieldId}')" class="ml-4 text-slate-600 hover:text-slate-800 text-sm font-medium flex-shrink-0 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 rounded">
                                            <span id="${fieldId}-toggle">Show more</span>
                                        </button>` : ''
                                    }
                                </div>
                            </div>
                        </div>
                    `;
            });
            html += `
                        </div>
                    </div>
                `;
        }
    });
    html += `</div>`;
    contentDiv.innerHTML = html;

    setTimeout(() => {
        if (lastUpdatedField) {
            const lastUpdatedElement = document.getElementById(`field-container-${lastUpdatedField}`);
            if (lastUpdatedElement) {
                const containerRect = contentDiv.getBoundingClientRect();
                const elementRect = lastUpdatedElement.getBoundingClientRect();
                const scrollTop = contentDiv.scrollTop + (elementRect.top - containerRect.top) - 20;
                contentDiv.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
            }
        } else {
            if (contentDiv.scrollHeight > contentDiv.clientHeight) {
                contentDiv.scrollTo({ top: contentDiv.scrollHeight, behavior: 'smooth' });
            }
        }
    }, PANEL_UPDATE_SCROLL_TIMEOUT_MS);
};

export const toggleFieldExpansion = (fieldId) => {
    const preview = document.getElementById(`${fieldId}-preview`);
    const full = document.getElementById(`${fieldId}-full`);
    const toggle = document.getElementById(`${fieldId}-toggle`);
    if (preview && full && toggle) {
        if (full.classList.contains('hidden')) {
            preview.classList.add('hidden');
            full.classList.remove('hidden');
            toggle.textContent = 'Show less';
        } else {
            preview.classList.remove('hidden');
            full.classList.add('hidden');
            toggle.textContent = 'Show more';
        }
    }
};

// Scroll helpers
export const ensureTranscriptScroll = () => {
    const { transcriptContainer } = getTranscriptElements();
    if (transcriptContainer && transcriptContainer.scrollHeight > 0 && !userScrolledUp) {
        setTimeout(() => {
            if (transcriptContainer && !userScrolledUp) {
                transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
            }
        }, 50);
    }
};

export const scrollToBottomImmediate = () => {
    const { transcriptContainer } = getTranscriptElements();
    if (transcriptContainer && transcriptContainer.scrollHeight > 0 && !userScrolledUp) {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
};

export const forceScrollToBottom = () => {
    const { transcriptContainer } = getTranscriptElements();
    if (transcriptContainer && transcriptContainer.scrollHeight > 0) {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
};

export const initTranscriptScrolling = () => {
    const { transcriptDiv, transcriptContainer } = getTranscriptElements();
    if (!(transcriptContainer && transcriptDiv)) return;

    userScrolledUp = false;
    let lastScrollTop = 0;

    const btn = document.createElement('button');
    btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
            </svg>
        `;
    btn.className = 'absolute bottom-20 right-4 bg-blue-600 text-white p-2 rounded-full shadow-lg hover:bg-blue-700 transition-all duration-200 opacity-0 pointer-events-none z-40';
    btn.title = 'Scroll to bottom';

    let conversationPanel = document.querySelector('.transcript-container')?.closest('.panel')
        || document.querySelector('.conversation-header')?.closest('.panel');
    if (conversationPanel) {
        if (getComputedStyle(conversationPanel).position === 'static') {
            conversationPanel.style.position = 'relative';
        }
        conversationPanel.appendChild(btn);
    } else {
        document.body.appendChild(btn);
    }
    btn.addEventListener('click', () => { forceScrollToBottom(); userScrolledUp = false; });
    scrollToBottomBtn = btn;

    transcriptContainer.addEventListener('scroll', () => {
        const currentScrollTop = transcriptContainer.scrollTop;
        const scrollHeight = transcriptContainer.scrollHeight;
        const clientHeight = transcriptContainer.clientHeight;
        if (currentScrollTop + clientHeight < scrollHeight - 10) {
            userScrolledUp = true;
            btn.classList.remove('opacity-0', 'pointer-events-none');
        } else {
            userScrolledUp = false;
            btn.classList.add('opacity-0', 'pointer-events-none');
        }
        lastScrollTop = currentScrollTop;
    });

    transcriptObserver = new MutationObserver((mutations) => {
        let shouldScroll = false;
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                shouldScroll = true;
            }
        });
        if (shouldScroll && !userScrolledUp) {
            setTimeout(() => { if (!userScrolledUp) ensureTranscriptScroll(); }, 100);
        }
    });
    transcriptObserver.observe(transcriptDiv, { childList: true, subtree: true });

    window.transcriptObserver = transcriptObserver;
    window.scrollToBottomBtn = scrollToBottomBtn;
    window.toggleFieldExpansion = toggleFieldExpansion;
};

// Success & Error popups
export const showSuccessPopup = (message, duration = 3000) => {
    let successPopup = document.getElementById('success-popup');
    if (!successPopup) {
        successPopup = document.createElement('div');
        successPopup.id = 'success-popup';
        successPopup.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg transform translate-x-full transition-transform duration-300 z-50';
        successPopup.innerHTML = `
                <div class="flex items-center">
                    <svg class="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <span id="success-message">${message}</span>
                </div>
            `;
        document.body.appendChild(successPopup);
    } else {
        const successMessage = document.getElementById('success-message');
        if (successMessage) successMessage.textContent = message;
    }
    successPopup.classList.remove('translate-x-full');
    successPopup.classList.add('translate-x-0');
    if (duration > 0) setTimeout(() => { hideSuccessPopup(); }, duration);
};

export const hideSuccessPopup = () => {
    const successPopup = document.getElementById('success-popup');
    if (successPopup) {
        successPopup.classList.remove('translate-x-0');
        successPopup.classList.add('translate-x-full');
    }
};

export const showErrorPopup = (title, message, duration = 5000) => {
    const errorPopup = document.getElementById('error-popup');
    const errorTitle = document.getElementById('error-title');
    const errorMessage = document.getElementById('error-message');
    if (errorPopup && errorTitle && errorMessage) {
        errorTitle.textContent = title;
        errorMessage.textContent = message;
        errorPopup.classList.remove('hidden');
        errorPopup.classList.remove('translate-x-full');
        errorPopup.classList.add('translate-x-0');
        if (duration > 0) setTimeout(() => { hideErrorPopup(); }, duration);
    }
};

export const hideErrorPopup = () => {
    const errorPopup = document.getElementById('error-popup');
    if (errorPopup) {
        errorPopup.classList.remove('translate-x-0');
        errorPopup.classList.add('translate-x-full');
        setTimeout(() => { errorPopup.classList.add('hidden'); }, 300);
    }
};

export const popupMessage = (message, type = 'success', duration = 3000) => {
    if (type === 'success') showSuccessPopup(message, duration);
    else if (type === 'error') showErrorPopup('Error', message, duration);
};

// Review & Edit Modal (UI) with callbacks provided by core
export const openReviewModal = (userData, callbacks) => {
    const formattedData = prevalidateDataForModal({ ...userData });
    const modal = document.getElementById('review-modal');
    const body = document.getElementById('review-form-body');
    const form = document.getElementById('review-form');
    const cancelBtn = document.getElementById('review-cancel-btn');
    if (!modal || !body || !form || !cancelBtn) return;

    const fieldGroups = {
        'Patient Information': ['full_name', 'dob', 'gender', 'contact_number', 'email', 'address', 'preferred_language', 'emergency_contact_name', 'emergency_contact_phone', 'relationship_to_patient'],
        'Visit & Care Context': ['caller_type', 'reason_for_visit', 'visit_type', 'primary_physician', 'referral_source'],
        'Medical Information': ['symptoms', 'symptom_duration', 'pain_level', 'current_medications', 'allergies', 'medical_history', 'family_history'],
        'Accessibility & Support Needs': ['interpreter_need', 'interpreter_language', 'accessibility_needs', 'dietary_needs'],
        'Consent & Preferences': ['consent_share_records', 'preferred_communication_method', 'appointment_availability'],
    };

    const renderInput = (fieldName, value) => {
        const displayName = getFieldDisplayName(fieldName);
        const common = 'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
        const requiredFields = ['full_name', 'dob', 'contact_number'];
        const isRequired = requiredFields.includes(fieldName);
        const requiredMark = isRequired ? ' <span class="text-red-600">*</span>' : '';
        const requiredAttr = isRequired ? 'required aria-required="true"' : '';
        if (fieldName === 'gender') {
            const options = ['Male','Female','Other','Prefer not to say'];
            const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        }
        if (fieldName === 'visit_type') {
            const options = ['First time','Returning'];
            const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        }
        if (fieldName === 'referral_source') {
            const options = ['Self','Physician Referral','Insurance','Other'];
            const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        }
        // if (fieldName === 'vaccination_status') {
        //     const options = ['Up to date','Not sure','Behind schedule'];
        //     const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
        //     return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        // }
        if (fieldName === 'preferred_communication_method') {
            const options = ['Phone','Email','Patient Portal'];
            const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        }
        if (fieldName === 'appointment_availability') {
            const options = ['Morning','Afternoon','Evening'];
            const opts = options.map(o => `<option value="${o}" ${value===o?'selected':''}>${o}</option>`).join('');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<select name="${fieldName}" class="${common}">${opts}</select></label>`;
        }
        if (fieldName === 'interpreter_need' || fieldName === 'consent_share_records') {
            return `<fieldset class="block"><legend class="text-sm font-medium text-slate-700 mb-1">${displayName}</legend>
                    <label class="inline-flex items-center mr-4"><input type="radio" name="${fieldName}" value="true" class="mr-2" ${value===true?'checked':''}/>Yes</label>
                    <label class="inline-flex items-center"><input type="radio" name="${fieldName}" value="false" class="mr-2" ${value===false?'checked':''}/>No</label>
                </fieldset>`;
        }
        if (fieldName === 'pain_level') {
            const val = (value ?? '').toString();
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<input type="number" min="0" max="10" step="1" name="${fieldName}" value="${val}" class="${common}" /></label>`;
        }
        if (fieldName === 'dob') {
            let displayDob = '';
            if (typeof value === 'string') {
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    const [y,m,d] = value.split('-');
                    displayDob = `${m}/${d}/${y}`;
                } else {
                    displayDob = value;
                }
            }
            return `<label class="block text-sm font-medium text-slate-700">${displayName}${requiredMark}<input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" name="${fieldName}" value="${displayDob}" class="${common}" ${requiredAttr} /></label>`;
        }
        if (['contact_number','emergency_contact_phone'].includes(fieldName)) {
            const val = (value ?? '').toString();
            return `<label class="block text-sm font-medium text-slate-700">${displayName}${requiredMark}<input type="text" inputmode="tel" placeholder="(555) 555-1234" name="${fieldName}" value="${val}" class="${common}" ${requiredAttr} /></label>`;
        }
        if (fieldName === 'email') {
            const val = (value ?? '').toString();
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<input type="email" placeholder="name@example.com" name="${fieldName}" value="${val}" class="${common}" /></label>`;
        }
        const longText = ['address','symptoms','current_medications','allergies','medical_history','family_history','accessibility_needs','dietary_needs','reason_for_visit'];
        if (longText.includes(fieldName)) {
            const val = (typeof value === 'object') ? JSON.stringify(value, null, 2) : (value ?? '');
            return `<label class="block text-sm font-medium text-slate-700">${displayName}<textarea name="${fieldName}" rows="3" class="${common}">${val}</textarea></label>`;
        }
        const val = (value ?? '').toString();
        return `<label class="block text-sm font-medium text-slate-700">${displayName}${requiredMark}<input type="text" name="${fieldName}" value="${val}" class="${common}" ${requiredAttr} /></label>`;
    };

    let html = '';
    Object.entries(fieldGroups).forEach(([group, fields]) => {
        const present = fields.filter(f => f in formattedData);
        if (present.length === 0) return;
        html += `<div class="border border-slate-200 rounded-lg overflow-hidden">
                <div class="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">${group}</div>
                <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">`;
        present.forEach(f => { html += renderInput(f, formattedData[f]); });
        html += `</div></div>`;
    });
    body.innerHTML = html || '<div class="p-6 text-sm text-slate-600">No data to review yet.</div>';

    const attachmentSection = document.createElement('div');
    attachmentSection.className = 'border border-slate-200 rounded-lg overflow-hidden mt-4';
    attachmentSection.innerHTML = `
            <div class="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">Insurance Document (optional)</div>
            <div class="p-4 space-y-2">
                <input id="insurance-file" name="insurance_file" type="file" class="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf" />
                <p class="text-xs text-slate-500">Accepted: PDF, images (PNG, JPG, WEBP), DOC, DOCX, RTF, TXT. Max 10MB.</p>
                <div id="insurance-file-error" class="text-xs text-red-600 hidden"></div>
            </div>
        `;
    body.insertAdjacentElement('afterend', attachmentSection);

    const dobInput = form.querySelector('input[name="dob"]');
    const phoneFieldNames = ['contact_number','emergency_contact_phone'];
    const onlyDigits = (s) => (s || '').replace(/\D+/g, '');
    const formatDOBMask = (raw) => {
        const d = onlyDigits(raw).slice(0, 8);
        const mm = d.slice(0, 2);
        const dd = d.slice(2, 4);
        const yyyy = d.slice(4, 8);
        if (d.length <= 2) return mm;
        if (d.length <= 4) return `${mm}/${dd}`;
        return `${mm}/${dd}/${yyyy}`;
    };
    const formatUSPhoneMask = (raw) => {
        let d = onlyDigits(raw);
        if (d.length > 10 && d[0] === '1') d = d.slice(1);
        d = d.slice(0, 10);
        const a = d.slice(0, 3);
        const b = d.slice(3, 6);
        const c = d.slice(6, 10);
        if (d.length === 0) return '';
        if (d.length <= 3) return `(${a}`;
        if (d.length <= 6) return `(${a}) ${b}`;
        return `(${a}) ${b}-${c}`;
    };
    if (dobInput) dobInput.addEventListener('input', (e) => { e.target.value = formatDOBMask(e.target.value); });
    phoneFieldNames.forEach((name) => {
        const input = form.querySelector(`input[name="${name}"]`);
        if (input) {
            input.value = formatUSPhoneMask(input.value);
            input.addEventListener('input', (e) => { e.target.value = formatUSPhoneMask(e.target.value); });
        }
    });

    const ensureErrorSummary = () => {
        let summary = document.getElementById('review-error-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.id = 'review-error-summary';
            summary.className = 'mx-6 mt-4 mb-0 hidden';
            form.insertBefore(summary, body);
        }
        return summary;
    };

    const clearFormErrors = () => {
        const summary = document.getElementById('review-error-summary');
        if (summary) { summary.classList.add('hidden'); summary.innerHTML = ''; }
        form.querySelectorAll('.field-error').forEach(el => el.remove());
        form.querySelectorAll('input, select, textarea').forEach(el => {
            el.classList.remove('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
        });
    };

    const showBackendErrors = (errors) => {
        const summary = ensureErrorSummary();
        const listItems = [];
        let firstInvalidInput = null;
        if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
            Object.entries(errors).forEach(([field, msgs]) => {
                const messages = Array.isArray(msgs) ? msgs : [String(msgs)];
                const display = getFieldDisplayName(field);
                const input = form.querySelector(`[name="${field}"]`);
                if (input) {
                    input.classList.add('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
                    const msgEl = document.createElement('p');
                    msgEl.className = 'mt-1 text-xs text-red-600 field-error';
                    msgEl.textContent = messages.join(' ');
                    input.insertAdjacentElement('afterend', msgEl);
                    if (!firstInvalidInput) firstInvalidInput = input;
                }
                listItems.push(`<li><strong>${display}:</strong> ${messages.join(' ')}</li>`);
            });
        } else if (typeof errors === 'string') {
            listItems.push(`<li>${errors}</li>`);
        }
        if (listItems.length > 0) {
            summary.innerHTML = `
                    <div class="error-popup p-4 border border-red-200 rounded-md">
                        <div class="text-sm text-red-800 font-semibold mb-1">Please correct the following:</div>
                        <ul class="list-disc pl-5 text-sm text-red-700 space-y-1">${listItems.join('')}</ul>
                    </div>`;
            summary.classList.remove('hidden');
            if (firstInvalidInput) {
                firstInvalidInput.focus({ preventScroll: true });
                firstInvalidInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    const show = () => { modal.classList.remove('hidden'); };
    const hide = () => { modal.classList.add('hidden'); };
    cancelBtn.onclick = () => { hide(); callbacks?.onCancel && callbacks.onCancel(); };

    const insuranceInput = form.querySelector('#insurance-file');
    const insuranceError = form.querySelector('#insurance-file-error');
    const clearFileError = () => { if (insuranceError) { insuranceError.textContent = ''; insuranceError.classList.add('hidden'); } };
    const showFileError = (msg) => { if (insuranceError) { insuranceError.textContent = msg; insuranceError.classList.remove('hidden'); insuranceInput && insuranceInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
    const validateInsuranceFile = (file) => {
        if (!file) return null;
        const allowed = new Set([
            'image/png','image/jpeg','image/jpg','image/webp','image/gif',
            'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','application/rtf'
        ]);
        if (!allowed.has(file.type)) return 'Unsupported file type.';
        if (file.size > 10 * 1024 * 1024) return 'File too large (max 10MB).';
        return null;
    };
    if (insuranceInput) {
        insuranceInput.addEventListener('change', () => {
            clearFileError();
            const file = insuranceInput.files && insuranceInput.files[0];
            const err = validateInsuranceFile(file);
            if (err) showFileError(err);
        });
    }

    const validateForm = (values) => {
        const errors = {};
        const req = ['full_name','dob','contact_number'];
        req.forEach(field => { const v = (values[field] || '').toString().trim(); if (!v) errors[field] = 'This field is required.'; });
        if (values['dob']) {
            const v = values['dob'].toString().trim();
            if (!/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(v)) errors['dob'] = 'Enter date as MM/DD/YYYY.';
        }
        if (values['contact_number']) {
            let d = values['contact_number'].toString().replace(/\D+/g, '');
            if (d.length === 11 && d[0] === '1') d = d.slice(1);
            if (d.length !== 10) errors['contact_number'] = 'Enter a valid 10-digit US number.';
        }
        ['emergency_contact_phone'].forEach(name => {
            if (values[name]) {
                let d = values[name].toString().replace(/\D+/g, '');
                if (d.length === 11 && d[0] === '1') d = d.slice(1);
                if (d.length !== 10) errors[name] = 'Enter a valid 10-digit US number.';
            }
        });
        if (values['email']) {
            const v = values['email'].toString().trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(v)) errors['email'] = 'Enter a valid email address.';
        }
        return errors;
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const edited = {};
        formData.forEach((v, k) => { edited[k] = v; });

        clearFormErrors();
        clearFileError();
        const clientErrors = validateForm(edited);
        if (Object.keys(clientErrors).length > 0) { showBackendErrors(clientErrors); return; }

        const file = insuranceInput && insuranceInput.files ? insuranceInput.files[0] : null;
        const fileErr = validateInsuranceFile(file);
        if (file && fileErr) { showFileError(fileErr); return; }

        if (edited['dob']) {
            const m = edited['dob'].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) {
                const mm = m[1].padStart(2, '0');
                const dd = m[2].padStart(2, '0');
                const yyyy = m[3];
                edited['dob'] = `${yyyy}-${mm}-${dd}`;
            }
        }
        const phoneFieldNames2 = ['contact_number','emergency_contact_phone'];
        phoneFieldNames2.forEach((name) => {
            if (edited[name]) {
                let d = (edited[name] || '').toString().replace(/\D+/g, '');
                if (d.length === 11 && d[0] === '1') d = d.slice(1);
                if (d.length === 10) edited[name] = `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
            }
        });
        ['interpreter_need','consent_share_records'].forEach(b => {
            if (b in edited) {
                if (edited[b] === 'true') edited[b] = true;
                else if (edited[b] === 'false') edited[b] = false;
            }
        });
        Object.keys(edited).forEach(key => { if (edited[key] === '') edited[key] = null; });

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

        const result = await callbacks.onSavePatient(edited);
        if (result && result.success) {
            const appointmentId = result.data && result.data.id;
            if (file && appointmentId) {
                // if (submitBtn) { submitBtn.textContent = 'Uploading document...'; }
                try {
                    const uploadRes = await callbacks.onUploadAttachment(appointmentId, file);
                    if (!uploadRes || !uploadRes.success) {
                        showFileError((uploadRes && uploadRes.message) || 'Failed to upload document.');
                        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
                        return;
                    }
                } catch (e) {
                    showFileError('Failed to upload document. Please try again.');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
                    return;
                }
            }
            await callbacks.onSaveConversation();
            // showSuccessPopup('Patient details saved');
            callbacks.onRedirectToAppointment(appointmentId);
        } else {
            clearFormErrors();
            const msg = (result && result.message) || 'Validation failed. Please review the highlighted fields.';
            const errors = (result && (result.errors || result.error)) || null;
            if (errors) showBackendErrors(errors); else showBackendErrors(msg);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText || 'Save'; }
        }
    };

    show();
};

// Helpers for modal data pre-validation
export const prevalidateDataForModal = (data) => {
    Object.keys(data).forEach(key => {
        let value = data[key];
        if (value === undefined || value === null) { data[key] = ''; return; }
        if (typeof value === 'string') {
            value = value.trim();
            const lower = value.toLowerCase();
            if (lower === 'not-needed') { data[key] = ''; return; }
            if (lower === 'yes') { data[key] = true; return; }
            if (lower === 'no') { data[key] = false; return; }
            if (key === 'dob') {
                const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (slashMatch) {
                    const mm = slashMatch[1].padStart(2, '0');
                    const dd = slashMatch[2].padStart(2, '0');
                    const yyyy = slashMatch[3];
                    data[key] = `${yyyy}-${mm}-${dd}`;
                    return;
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { data[key] = value; return; }
            }
            data[key] = value;
        }
    });
    return data;
};

// Close error popup button
const closeBtn = document.getElementById('error-close-btn');
if (closeBtn) closeBtn.addEventListener('click', () => { hideErrorPopup(); });


