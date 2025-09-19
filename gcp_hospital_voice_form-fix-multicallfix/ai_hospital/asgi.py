"""
ASGI config for ai_hospital project.

Configures HTTP via Django ASGI app and WebSocket via Channels routing.
"""

import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ai_hospital.settings')

django_asgi_app = get_asgi_application()

try:
    import voice_flow.routing as voice_routing
    websocket_routes = voice_routing.websocket_urlpatterns
except Exception:
    websocket_routes = []

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AuthMiddlewareStack(URLRouter(websocket_routes)),
})
