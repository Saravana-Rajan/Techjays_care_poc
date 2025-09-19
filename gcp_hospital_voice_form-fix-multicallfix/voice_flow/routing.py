from django.urls import re_path

from .ws import GeminiVoiceConsumer

websocket_urlpatterns = [
    re_path(r"^ws/voice/$", GeminiVoiceConsumer.as_asgi()),
]


