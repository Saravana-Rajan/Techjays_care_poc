import logging

from rest_framework import serializers
from .models import Appointment, AppointmentAttachment

logger = logging.getLogger(__name__)


class AppointmentSerializer(serializers.ModelSerializer):
    """
    Serializer for Appointment model with all fields included.
    """
    attachments = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = Appointment
        fields = '__all__'
        read_only_fields = ('created_at', 'updated_at')
    
    def validate_contact_number(self, value):
        """Validate contact number format"""
        if not value:
            raise serializers.ValidationError("Contact number is required")
        return value
    
    def validate_emergency_contact_phone(self, value):
        """Validate emergency contact phone format"""
        if value and not value.strip():
            return None
        return value
    
    def validate_guardian_contact(self, value):
        """Validate guardian contact format"""
        if value and not value.strip():
            return None
        return value
    
    def validate(self, data):
        for k, v in data.items():
            if v in ['not-needed', 'Not needed', 'Not Needed']:
                data[k] = None
        return data

    def get_attachments(self, obj):
        attachments = getattr(obj, 'attachments', None)
        if attachments is None:
            attachments = obj.attachments.all()
        return AppointmentAttachmentSerializer(attachments, many=True, context=self.context).data


class AppointmentAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = AppointmentAttachment
        fields = ['id', 'appointment', 'original_name', 'content_type', 'size_bytes', 'uploaded_at', 'url']
        read_only_fields = ['id', 'uploaded_at', 'url']

    def get_url(self, obj):
        request = self.context.get('request') if hasattr(self, 'context') else None
        if obj.file:
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None