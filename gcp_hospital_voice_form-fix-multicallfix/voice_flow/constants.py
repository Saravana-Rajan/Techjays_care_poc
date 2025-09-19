import os

from dotenv import load_dotenv

load_dotenv()

OPENAI_API_BASE_URL = "https://api.openai.com/v1"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")    

# Gemini (Google Generative Language API) configuration
# Realtime WebRTC connect endpoint pattern:
#   https://generativelanguage.googleapis.com/v1beta/models/{model}:connect?alt=sdp
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "models/gemini-2.5-flash-preview-native-audio-dialog"
# GEMINI_MODEL = "gemini-live-2.5-flash-preview"
GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"

# Enhanced configuration for native audio dialog
GEMINI_AUDIO_CONFIG = {
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16", 
    "sample_rate": 16000,
    "channels": 1,
    "enable_voice_activity_detection": True,
    "enable_automatic_punctuation": True
}

