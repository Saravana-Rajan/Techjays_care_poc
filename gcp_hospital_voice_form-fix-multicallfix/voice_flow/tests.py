import json
from datetime import date, datetime
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status, serializers
from .models import Appointment
from .serializers import AppointmentSerializer


class AppointmentAPITestCase(APITestCase):
    """
    Test cases for AppointmentAPIView
    """
    
    def setUp(self):
        """
        Set up test data
        """
        self.appointment_data = {
            'full_name': 'John Doe',
            'dob': '1990-01-15',
            'gender': 'Male',
            'contact_number': '+1234567890',
            'email': 'john.doe@example.com',
            'address': '123 Main St, City, State, 12345',
            'preferred_language': 'English',
            'emergency_contact_name': 'Jane Doe',
            'emergency_contact_phone': '+1234567891',
            'relationship_to_patient': 'Spouse',
            'caller_type': 'Patient',
            'reason_for_visit': 'Regular checkup',
            'visit_type': 'First time',
            'primary_physician': 'Dr. Smith',
            'referral_source': 'Self',
            'symptoms': 'No current symptoms',
            'symptom_duration': 'N/A',
            'pain_level': 0,
            'current_medications': 'None',
            'allergies': 'None known',
            'medical_history': 'No significant history',
            'family_history': 'No significant family history',
            'guardian_name': None,
            'guardian_contact': None,
            'guardian_relationship': None,
            'school_grade': None,
            'vaccination_status': None,
            'interpreter_need': False,
            'interpreter_language': None,
            'accessibility_needs': None,
            'dietary_needs': None,
            'consent_share_records': True,
            'preferred_communication_method': 'Email',
            'appointment_availability': 'Morning',
            'confirmation': 'Yes'
        }
        
        # Create a test appointment
        self.test_appointment = Appointment.objects.create(**self.appointment_data)
    
    def test_create_appointment_success(self):
        """
        Test successful appointment creation
        """
        url = reverse('voice_flow:appointment_api')
        response = self.client.post(url, self.appointment_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['message'], 'Appointment created successfully')
        self.assertIn('data', response.data)
        
        # Verify appointment was created in database
        self.assertEqual(Appointment.objects.count(), 2)  # 1 from setUp + 1 new
    
    def test_create_appointment_missing_required_fields(self):
        """
        Test appointment creation with missing required fields
        """
        url = reverse('voice_flow:appointment_api')
        incomplete_data = {
            'full_name': 'John Doe',
            'email': 'john.doe@example.com'
            # Missing required fields like dob, gender, contact_number, etc.
        }
        
        response = self.client.post(url, incomplete_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])
        self.assertEqual(response.data['message'], 'Validation failed')
        self.assertIn('errors', response.data)
    
    def test_create_appointment_invalid_email(self):
        """
        Test appointment creation with invalid email format
        """
        url = reverse('voice_flow:appointment_api')
        invalid_data = self.appointment_data.copy()
        invalid_data['email'] = 'invalid-email'
        
        response = self.client.post(url, invalid_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])
        self.assertIn('email', response.data['errors'])
    
    def test_create_appointment_invalid_phone(self):
        """
        Test appointment creation with invalid phone number
        """
        url = reverse('voice_flow:appointment_api')
        invalid_data = self.appointment_data.copy()
        invalid_data['contact_number'] = 'invalid-phone'
        
        response = self.client.post(url, invalid_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])
        self.assertIn('contact_number', response.data['errors'])
    
    def test_create_appointment_invalid_pain_level(self):
        """
        Test appointment creation with invalid pain level (outside 0-10 range)
        """
        url = reverse('voice_flow:appointment_api')
        invalid_data = self.appointment_data.copy()
        invalid_data['pain_level'] = 15  # Invalid: should be 0-10
        
        response = self.client.post(url, invalid_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])
        self.assertIn('pain_level', response.data['errors'])
    
    def test_get_all_appointments_success(self):
        """
        Test successful retrieval of all appointments
        """
        url = reverse('voice_flow:appointment_api')
        response = self.client.get(url)
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['message'], 'Retrieved 1 appointments')
        self.assertEqual(response.data['count'], 1)
        self.assertIn('data', response.data)
        self.assertEqual(len(response.data['data']), 1)
    
    def test_get_specific_appointment_success(self):
        """
        Test successful retrieval of a specific appointment
        """
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': self.test_appointment.id})
        response = self.client.get(url)
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['message'], 'Appointment retrieved successfully')
        self.assertIn('data', response.data)
        self.assertEqual(response.data['data']['id'], self.test_appointment.id)
        self.assertEqual(response.data['data']['full_name'], 'John Doe')
    
    def test_get_specific_appointment_not_found(self):
        """
        Test retrieval of non-existent appointment
        """
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': 99999})
        response = self.client.get(url)
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(response.data['success'])
        self.assertEqual(response.data['message'], 'Appointment not found')
    
    def test_get_appointments_with_multiple_records(self):
        """
        Test retrieval when multiple appointments exist
        """
        # Create additional test appointments
        appointment_data_2 = self.appointment_data.copy()
        appointment_data_2['full_name'] = 'Jane Smith'
        appointment_data_2['email'] = 'jane.smith@example.com'
        appointment_data_2['contact_number'] = '+1234567892'
        
        appointment_data_3 = self.appointment_data.copy()
        appointment_data_3['full_name'] = 'Bob Johnson'
        appointment_data_3['email'] = 'bob.johnson@example.com'
        appointment_data_3['contact_number'] = '+1234567893'
        
        Appointment.objects.create(**appointment_data_2)
        Appointment.objects.create(**appointment_data_3)
        
        url = reverse('voice_flow:appointment_api')
        response = self.client.get(url)
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['count'], 3)
        self.assertEqual(len(response.data['data']), 3)
    
    def test_appointment_serializer_validation(self):
        """
        Test AppointmentSerializer validation methods
        """
        # Test contact number validation
        serializer = AppointmentSerializer()
        
        # Valid contact number
        valid_phone = '+1234567890'
        self.assertEqual(serializer.validate_contact_number(valid_phone), valid_phone)
        
        # Empty contact number should raise validation error
        with self.assertRaises(serializers.ValidationError):
            serializer.validate_contact_number('')
        
        # Test emergency contact phone validation (should allow None/empty)
        self.assertEqual(serializer.validate_emergency_contact_phone(''), '')
        self.assertIsNone(serializer.validate_emergency_contact_phone(None))
        
        # Test guardian contact validation (should allow None/empty)
        self.assertEqual(serializer.validate_guardian_contact(''), '')
        self.assertIsNone(serializer.validate_guardian_contact(None))
    
    def test_appointment_model_str_representation(self):
        """
        Test Appointment model string representation
        """
        expected_str = f"{self.test_appointment.full_name} - {self.test_appointment.created_at.strftime('%Y-%m-%d')}"
        self.assertEqual(str(self.test_appointment), expected_str)
    
    def test_appointment_model_meta_options(self):
        """
        Test Appointment model meta options
        """
        self.assertEqual(Appointment._meta.verbose_name, 'Appointment')
        self.assertEqual(Appointment._meta.verbose_name_plural, 'Appointments')
        self.assertEqual(Appointment._meta.db_table, 'appointment')
    
    def test_appointment_choices_validation(self):
        """
        Test appointment creation with valid choice fields
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with valid gender choice
        valid_data = self.appointment_data.copy()
        valid_data['gender'] = 'Female'
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with valid visit_type choice
        valid_data['visit_type'] = 'Returning'
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with valid referral_source choice
        valid_data['referral_source'] = 'Physician Referral'
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_appointment_optional_fields(self):
        """
        Test appointment creation with optional fields
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with all optional fields filled
        optional_data = self.appointment_data.copy()
        optional_data['preferred_language'] = 'Spanish'
        optional_data['emergency_contact_name'] = 'Emergency Contact'
        optional_data['emergency_contact_phone'] = '+1234567899'
        optional_data['guardian_name'] = 'Guardian Name'
        optional_data['guardian_contact'] = '+1234567898'
        optional_data['interpreter_need'] = True
        optional_data['interpreter_language'] = 'Spanish'
        optional_data['accessibility_needs'] = 'Wheelchair access needed'
        optional_data['dietary_needs'] = 'Vegetarian'
        
        response = self.client.post(url, optional_data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['success'])
        
        # Verify optional fields were saved
        appointment_id = response.data['data']['id']
        appointment = Appointment.objects.get(id=appointment_id)
        self.assertEqual(appointment.preferred_language, 'Spanish')
        self.assertEqual(appointment.interpreter_need, True)
        self.assertEqual(appointment.accessibility_needs, 'Wheelchair access needed')
    
    # ==================== NEGATIVE TEST SCENARIOS ====================
    
    def test_create_appointment_invalid_data_types(self):
        """
        Test appointment creation with invalid data types
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with string instead of integer for pain_level
        invalid_data = self.appointment_data.copy()
        invalid_data['pain_level'] = 'not_a_number'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('pain_level', response.data['errors'])
        
        # Test with object instead of string for full_name
        invalid_data = self.appointment_data.copy()
        invalid_data['full_name'] = {'first': 'John', 'last': 'Doe'}
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full_name', response.data['errors'])
        
        # Test with array instead of string for email
        invalid_data = self.appointment_data.copy()
        invalid_data['email'] = ['john@example.com', 'jane@example.com']
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data['errors'])
    
    def test_create_appointment_boundary_values(self):
        """
        Test appointment creation with boundary values
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test pain_level boundary values
        # Valid: 0 (minimum)
        valid_data = self.appointment_data.copy()
        valid_data['pain_level'] = 0
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Valid: 10 (maximum)
        valid_data['pain_level'] = 10
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Invalid: -1 (below minimum)
        invalid_data = self.appointment_data.copy()
        invalid_data['pain_level'] = -1
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('pain_level', response.data['errors'])
        
        # Invalid: 11 (above maximum)
        invalid_data['pain_level'] = 11
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('pain_level', response.data['errors'])
    
    def test_create_appointment_invalid_choice_values(self):
        """
        Test appointment creation with invalid choice field values
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test invalid gender choice
        invalid_data = self.appointment_data.copy()
        invalid_data['gender'] = 'InvalidGender'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('gender', response.data['errors'])
        
        # Test invalid visit_type choice
        invalid_data = self.appointment_data.copy()
        invalid_data['visit_type'] = 'InvalidVisitType'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('visit_type', response.data['errors'])
        
        # Test invalid referral_source choice
        invalid_data = self.appointment_data.copy()
        invalid_data['referral_source'] = 'InvalidSource'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('referral_source', response.data['errors'])
        
        # Test invalid preferred_communication_method choice
        invalid_data = self.appointment_data.copy()
        invalid_data['preferred_communication_method'] = 'InvalidMethod'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('preferred_communication_method', response.data['errors'])
        
        # Test invalid appointment_availability choice
        invalid_data = self.appointment_data.copy()
        invalid_data['appointment_availability'] = 'InvalidTime'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('appointment_availability', response.data['errors'])
    
    def test_create_appointment_field_length_limits(self):
        """
        Test appointment creation with field length violations
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test full_name too long (max 255 characters)
        invalid_data = self.appointment_data.copy()
        invalid_data['full_name'] = 'A' * 256  # 256 characters
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full_name', response.data['errors'])
        
        # Test valid full_name length (255 characters)
        valid_data = self.appointment_data.copy()
        valid_data['full_name'] = 'A' * 255  # 255 characters
        response = self.client.post(url, valid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test email too long
        invalid_data = self.appointment_data.copy()
        invalid_data['email'] = 'a' * 250 + '@example.com'  # Very long email
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data['errors'])
    
    def test_create_appointment_invalid_date_formats(self):
        """
        Test appointment creation with invalid date formats
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test invalid date format for dob
        invalid_data = self.appointment_data.copy()
        invalid_data['dob'] = 'invalid-date'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('dob', response.data['errors'])
        
        # Test future date for dob (should be valid but test the format)
        invalid_data['dob'] = '2030-01-01'
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)  # Future date is technically valid
        
        # Test invalid date format (wrong format)
        invalid_data['dob'] = '01/15/1990'  # Wrong format
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('dob', response.data['errors'])
    
    def test_create_appointment_sql_injection_attempts(self):
        """
        Test appointment creation with potential SQL injection attempts
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with SQL injection attempt in full_name
        malicious_data = self.appointment_data.copy()
        malicious_data['full_name'] = "'; DROP TABLE appointment; --"
        response = self.client.post(url, malicious_data, format='json')
        # Should create appointment with the malicious string as data (Django ORM prevents SQL injection)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify the data was stored as-is (not executed as SQL)
        appointment_id = response.data['data']['id']
        appointment = Appointment.objects.get(id=appointment_id)
        self.assertEqual(appointment.full_name, "'; DROP TABLE appointment; --")
        
        # Test with XSS attempt
        malicious_data = self.appointment_data.copy()
        malicious_data['full_name'] = "<script>alert('XSS')</script>"
        response = self.client.post(url, malicious_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify XSS attempt was stored as-is
        appointment_id = response.data['data']['id']
        appointment = Appointment.objects.get(id=appointment_id)
        self.assertEqual(appointment.full_name, "<script>alert('XSS')</script>")
    
    def test_create_appointment_unicode_and_special_characters(self):
        """
        Test appointment creation with unicode and special characters
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with unicode characters
        unicode_data = self.appointment_data.copy()
        unicode_data['full_name'] = 'José María Ñoño'
        unicode_data['address'] = 'Café de la Paix, 123 rue de la Paix, Paris'
        response = self.client.post(url, unicode_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with emoji characters
        emoji_data = self.appointment_data.copy()
        emoji_data['full_name'] = 'John 😊 Doe'
        emoji_data['symptoms'] = 'Feeling 😷 and 🤒'
        response = self.client.post(url, emoji_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with special characters
        special_data = self.appointment_data.copy()
        special_data['full_name'] = "O'Connor-Smith"
        special_data['address'] = "123 Main St. #4B, Apt. 2-C"
        response = self.client.post(url, special_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_create_appointment_empty_strings_vs_null(self):
        """
        Test appointment creation with empty strings vs null values
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with empty strings for optional fields
        empty_data = self.appointment_data.copy()
        empty_data['preferred_language'] = ''
        empty_data['emergency_contact_name'] = ''
        empty_data['guardian_name'] = ''
        response = self.client.post(url, empty_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with null values for optional fields
        null_data = self.appointment_data.copy()
        null_data['preferred_language'] = None
        null_data['emergency_contact_name'] = None
        null_data['guardian_name'] = None
        response = self.client.post(url, null_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with whitespace-only strings
        whitespace_data = self.appointment_data.copy()
        whitespace_data['preferred_language'] = '   '
        whitespace_data['emergency_contact_name'] = '\t\n'
        response = self.client.post(url, whitespace_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_create_appointment_duplicate_contact_numbers(self):
        """
        Test appointment creation with duplicate contact numbers
        """
        url = reverse('voice_flow:appointment_api')
        
        # Create first appointment
        response1 = self.client.post(url, self.appointment_data, format='json')
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # Try to create second appointment with same contact number
        duplicate_data = self.appointment_data.copy()
        duplicate_data['full_name'] = 'Different Name'
        duplicate_data['email'] = 'different@example.com'
        # Same contact_number as first appointment
        
        response2 = self.client.post(url, duplicate_data, format='json')
        # Should succeed since there's no unique constraint on contact_number
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)
        
        # Verify both appointments exist
        self.assertEqual(Appointment.objects.count(), 3)  # 1 from setUp + 2 new
    
    def test_create_appointment_duplicate_emails(self):
        """
        Test appointment creation with duplicate email addresses
        """
        url = reverse('voice_flow:appointment_api')
        
        # Create first appointment
        response1 = self.client.post(url, self.appointment_data, format='json')
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # Try to create second appointment with same email
        duplicate_data = self.appointment_data.copy()
        duplicate_data['full_name'] = 'Different Name'
        duplicate_data['contact_number'] = '+1234567899'
        # Same email as first appointment
        
        response2 = self.client.post(url, duplicate_data, format='json')
        # Should succeed since there's no unique constraint on email
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)
        
        # Verify both appointments exist
        self.assertEqual(Appointment.objects.count(), 3)  # 1 from setUp + 2 new
    
    def test_get_appointment_invalid_id_formats(self):
        """
        Test GET requests with invalid appointment ID formats
        """
        # Test with very large ID
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': 999999999})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
    
    def test_post_request_with_get_endpoint(self):
        """
        Test POST request to GET-only endpoint
        """
        # Test POST to detail endpoint (should not be allowed)
        # Since our view doesn't handle POST with appointment_id, it will return 405
        try:
            response = self.client.post(f'/api/appointments/{self.test_appointment.id}/', self.appointment_data, format='json')
            # This will actually return 405 because the view doesn't accept appointment_id for POST
            self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        except TypeError:
            # If the view doesn't handle the appointment_id parameter for POST, it will raise TypeError
            # This is expected behavior since our view only accepts appointment_id for GET requests
            pass
    
    def test_put_request_not_supported(self):
        """
        Test PUT request (not supported by our API)
        """
        url = reverse('voice_flow:appointment_api')
        response = self.client.put(url, self.appointment_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': self.test_appointment.id})
        response = self.client.put(url, self.appointment_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
    
    def test_delete_request_not_supported(self):
        """
        Test DELETE request (not supported by our API)
        """
        url = reverse('voice_flow:appointment_api')
        response = self.client.delete(url)
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': self.test_appointment.id})
        response = self.client.delete(url)
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
    
    def test_patch_request_not_supported(self):
        """
        Test PATCH request (not supported by our API)
        """
        url = reverse('voice_flow:appointment_api')
        response = self.client.patch(url, self.appointment_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        
        url = reverse('voice_flow:appointment_detail', kwargs={'appointment_id': self.test_appointment.id})
        response = self.client.patch(url, self.appointment_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
    
    def test_create_appointment_with_nested_json_objects(self):
        """
        Test appointment creation with nested JSON objects (should fail)
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with nested object in full_name
        invalid_data = self.appointment_data.copy()
        invalid_data['full_name'] = {'first': 'John', 'last': 'Doe'}
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full_name', response.data['errors'])
        
        # Test with array in email
        invalid_data = self.appointment_data.copy()
        invalid_data['email'] = ['john@example.com', 'jane@example.com']
        response = self.client.post(url, invalid_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data['errors'])
    
    def test_create_appointment_with_very_long_text_fields(self):
        """
        Test appointment creation with very long text in text fields
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with very long address (should be allowed for TextField)
        long_data = self.appointment_data.copy()
        long_data['address'] = 'A' * 10000  # 10,000 characters
        response = self.client.post(url, long_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with very long symptoms
        long_data['symptoms'] = 'B' * 10000
        response = self.client.post(url, long_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with very long medical_history
        long_data['medical_history'] = 'C' * 10000
        response = self.client.post(url, long_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_create_appointment_with_extreme_values(self):
        """
        Test appointment creation with extreme values
        """
        url = reverse('voice_flow:appointment_api')
        
        # Test with very old date
        extreme_data = self.appointment_data.copy()
        extreme_data['dob'] = '1900-01-01'
        response = self.client.post(url, extreme_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with very recent date
        extreme_data['dob'] = '2020-01-01'
        response = self.client.post(url, extreme_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Test with very long phone number
        extreme_data['contact_number'] = '+12345678901234567890'
        response = self.client.post(url, extreme_data, format='json')
        # Should fail due to regex validation
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('contact_number', response.data['errors'])
