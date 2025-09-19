import { initTranscriptScrolling, setTranscriptPlaceholder } from './voice-flow-ui.js';
import { initVoiceFlow } from './voice-flow-core.js';

document.addEventListener('DOMContentLoaded', () => {
    setTranscriptPlaceholder();
    initTranscriptScrolling();
    initVoiceFlow();
});
