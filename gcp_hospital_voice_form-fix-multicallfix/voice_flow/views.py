import json
import os
import traceback
import logging
import uuid

import requests
from django.shortcuts import render
from django.contrib.auth.decorators import login_required
from django.views import View
from django.utils.decorators import method_decorator
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.core.files.storage import default_storage
from rest_framework import serializers, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

from voice_flow.utils import (
    get_initial_checklist_data,
    format_serializer_errors
)
from voice_flow.models import Appointment, AppointmentAttachment
from voice_flow.serializers import AppointmentSerializer, AppointmentAttachmentSerializer

logger = logging.getLogger(__name__)


def get_context_data(request):
    from voice_flow.utils import get_initial_checklist_data
    
    # Get initial state data
    initial_state = get_initial_checklist_data()
    
    return {
        'job_creation_state': initial_state,
        'has_errors': False,
        'errors': []
    }


def home(request):
    """
    Renders the voice flow home page.
    """
    context = get_context_data(request)
    return render(request, 'voice_flow/home.html', context)


def voice_flow_conversation(request):
    """
    Renders the voice flow conversation page.
    """
    context = get_context_data(request)
    return render(request, 'voice_flow/conversation.html', context)


def appointments_page(request):
    """
    Renders a simple appointments listing page with upload section.
    """
    context = get_context_data(request)
    return render(request, 'voice_flow/appointments.html', context)


@csrf_exempt
@require_POST
def clear_voice_flow_session(request):
    """
    Clears the voice flow session data.
    """
    try:
        job_state = get_initial_checklist_data()
        if 'voice_flow_state' in request.session:
            request.session['voice_flow_state'] = job_state
            request.session.modified = True
        
        return JsonResponse({'success': True, 'message': 'Session cleared successfully', 'checklist': job_state.get('checklist', [])})
    except Exception as e:
        logger.error(f"Error clearing session: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@csrf_exempt
@require_POST
def save_voice_flow(request):
    try:        
        data = json.loads(request.body)
        action = data.get('action')
        
        if action == 'save_voice_flow':
            return JsonResponse({'success': True, 'message': 'Details saved successfully.'})

        else:
            return JsonResponse({'error': 'Invalid action'}, status=400)

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    
    except serializers.ValidationError as validation_error:
        return JsonResponse({'error': format_serializer_errors(validation_error.detail)}, status=400)
    
    except Exception as e:
        logger.error(f"Error processing AI action '{action}': {e}")
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_POST
def upload_document(request):
    """
    Simple file upload endpoint for images, PDFs, and documents.
    Saves to MEDIA_ROOT/uploads and returns the file URL.
    """
    try:
        upload = request.FILES.get('file')
        if not upload:
            return JsonResponse({'success': False, 'error': 'No file provided'}, status=400)

        allowed_content_types = {
            'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
            'application/pdf',
            'application/msword',  # .doc
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  # .docx
            'text/plain',
            'application/rtf',
        }

        if upload.content_type not in allowed_content_types:
            return JsonResponse({'success': False, 'error': 'Unsupported file type'}, status=400)

        if upload.size > 10 * 1024 * 1024:
            return JsonResponse({'success': False, 'error': 'File too large (max 10MB)'}, status=400)

        _, ext = os.path.splitext(upload.name)
        safe_ext = (ext or '').lower()
        filename = f"{uuid.uuid4().hex}{safe_ext}"
        path = f"uploads/{filename}"

        saved_path = default_storage.save(path, upload)

        from django.conf import settings
        relative_url = f"{settings.MEDIA_URL}{saved_path}"
        absolute_url = request.build_absolute_uri(relative_url)

        return JsonResponse({
            'success': True,
            'filename': upload.name,
            'path': saved_path,
            'url': relative_url,
            'absolute_url': absolute_url,
        })
    except Exception as e:
        logger.error(f"Upload error: {e}")
        return JsonResponse({'success': False, 'error': 'Server error'}, status=500)


class AppointmentAPIView(APIView):
    """
    API View for creating and retrieving appointments.
    Handles both POST (create) and GET (list) methods.
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        """
        Create a new appointment.
        """
        try:
            serializer = AppointmentSerializer(data=request.data)
            if serializer.is_valid():
                appointment = serializer.save()
                return Response({
                    'success': True,
                    'message': 'Appointment created successfully',
                    'data': AppointmentSerializer(appointment).data
                }, status=status.HTTP_201_CREATED)
            else:
                return Response({
                    'success': False,
                    'message': 'Validation failed',
                    'errors': format_serializer_errors(serializer.errors)
                }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error creating appointment: {e}")
            return Response({
                'success': False,
                'message': 'Internal server error',
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def get(self, request, appointment_id=None):
        """
        Get appointments - either all appointments or a specific one by ID.
        """
        try:
            if appointment_id:
                # Get specific appointment by ID
                try:
                    appointment = Appointment.objects.get(id=appointment_id)
                    serializer = AppointmentSerializer(appointment, context={'request': request})
                    return Response({
                        'success': True,
                        'message': 'Appointment retrieved successfully',
                        'data': serializer.data
                    }, status=status.HTTP_200_OK)
                except Appointment.DoesNotExist:
                    return Response({
                        'success': False,
                        'message': 'Appointment not found'
                    }, status=status.HTTP_404_NOT_FOUND)
            else:
                appointments = Appointment.objects.all()
                serializer = AppointmentSerializer(appointments, many=True, context={'request': request})
                
                return Response({
                    'success': True,
                    'message': f'Retrieved {len(serializer.data)} appointments',
                    'data': serializer.data,
                    'count': len(serializer.data)
                }, status=status.HTTP_200_OK)
                
        except Exception as e:
            logger.error(f"Error retrieving appointments: {e}")
            return Response({
                'success': False,
                'message': 'Internal server error',
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@method_decorator(csrf_exempt, name='dispatch')
class AppointmentAttachmentAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, appointment_id):
        try:
            appointment = Appointment.objects.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response({'success': False, 'message': 'Appointment not found'}, status=status.HTTP_404_NOT_FOUND)

        attachments = appointment.attachments.all()
        serializer = AppointmentAttachmentSerializer(attachments, many=True, context={'request': request})
        return Response({'success': True, 'data': serializer.data}, status=status.HTTP_200_OK)

    def post(self, request, appointment_id):
        try:
            appointment = Appointment.objects.get(id=appointment_id)
        except Appointment.DoesNotExist:
            return Response({'success': False, 'message': 'Appointment not found'}, status=status.HTTP_404_NOT_FOUND)

        try:
            upload = request.FILES.get('file')
            if not upload:
                return Response({'success': False, 'message': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

            allowed_content_types = {
                'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain',
                'application/rtf',
            }

            if upload.content_type not in allowed_content_types:
                return Response({'success': False, 'message': 'Unsupported file type'}, status=status.HTTP_400_BAD_REQUEST)

            if upload.size > 10 * 1024 * 1024:
                return Response({'success': False, 'message': 'File too large (max 10MB)'}, status=status.HTTP_400_BAD_REQUEST)

            attachment = AppointmentAttachment.objects.create(
                appointment=appointment,
                file=upload,
                original_name=upload.name,
                content_type=upload.content_type or '',
                size_bytes=upload.size,
            )

            serializer = AppointmentAttachmentSerializer(attachment, context={'request': request})
            return Response({'success': True, **serializer.data}, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f"Attachment upload error: {e}")
            return Response({'success': False, 'message': 'Server error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)