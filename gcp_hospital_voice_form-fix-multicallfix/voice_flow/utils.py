"""Utility functions for OpenAI integration for the hiring manager conversation."""

import logging

from rest_framework import serializers


logger = logging.getLogger(__name__)

_openai_initialized = False

MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 3
BASE_DELAY = 1.0
MAX_DELAY = 32.0
JITTER_RANGE = 0.1


def get_initial_checklist_data():
    """
    Returns the initial checklist data structure for patient intake form.
    """

    checklist = [
        {"references": ["full_name", "dob", "gender", "contact_number", "email", "address", "preferred_language", "emergency_contact_name", "emergency_contact_phone", "relationship_to_patient"], "title": "Patient Information", "description": "Basic patient information", "status": "pending"},
        {"references": [ "caller_type", "reason_for_visit", "visit_type", "primary_physician", "referral_source"], "title": "Visit & Care Context", "description": "Visit details", "status": "pending"},
        {"references": ["symptoms", "symptom_duration", "pain_level", "current_medications", "allergies", "medical_history", "family_history"], "title": "Medical Information", "description": "Medical history", "status": "pending"},
        {"references": ["interpreter_need", "interpreter_language", "accessibility_needs", "dietary_needs"], "title": "Accessibility & Support", "description": "Support needs", "status": "pending"},
        {"references": ["consent_share_records", "preferred_communication_method", "appointment_availability", "confirmation"], "title": "Consent & Preferences", "description": "Consent & preferences", "status": "pending"},
    ]
    return {
        'checklist': checklist
    }

def is_falsy_value(value):
    """
    Check if a value should be considered falsy for checklist completion.
    
    Args:
        value: The value to check
        
    Returns:
        bool: True if the value should be considered falsy, False otherwise
    """
    if value is None:
        return True
    if isinstance(value, bool):
        return not value
    if isinstance(value, str):
        return value.lower() in ['false', '0', 'null', 'none', 'undefined', '']
    if isinstance(value, (int, float)):
        return value == 0
    return False


def format_serializer_errors(serializer_errors):
    """
    Convert serializer errors from list format to single string format.
    """
    if isinstance(serializer_errors, list):
        if serializer_errors:
            return str(serializer_errors[0])
        return "Validation error"
    
    formatted_errors = {}
    for field, errors in serializer_errors.items():
        if isinstance(errors, list):
            formatted_errors[field] = errors[0]
        else:
            formatted_errors[field] = str(errors)
    
    return formatted_errors

def try_except_wrapper(func):
    """
    Decorator that wraps a function in a try-except block and returns a tuple of (result, error).
    """
    def wrapper(*args, **kwargs):
        try:
            result = func(*args, **kwargs)
            return result, None
        except serializers.ValidationError as e:
            return None, format_serializer_errors(e.detail)
        except Exception as e:
            return None, str(e)
    return wrapper

def atomic_transaction(func):
    """
    Decorator that wraps a function in a transaction.
    """
    from django.db import transaction
    def wrapper(*args, **kwargs):
        with transaction.atomic():
            return func(*args, **kwargs)
    return wrapper
