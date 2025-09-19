from django.urls import path
from . import views

app_name = 'voice_flow'

urlpatterns = [
    path('', views.home, name='home'),
    path('conversation/', views.voice_flow_conversation, name='voice_flow_conversation'),
    path('appointments/', views.appointments_page, name='appointments'),
    path('save/', views.save_voice_flow, name='save_voice_flow'),
    path('clear-voice-flow-session/', views.clear_voice_flow_session, name='clear_voice_flow_session'),
    path('api/appointments/', views.AppointmentAPIView.as_view(), name='appointment_api'),
    path('api/appointments/<int:appointment_id>/', views.AppointmentAPIView.as_view(), name='appointment_detail'),
    path('api/appointments/<int:appointment_id>/attachments/', views.AppointmentAttachmentAPIView.as_view(), name='appointment_attachments'),
    path('api/upload/', views.upload_document, name='upload_document'),
]
