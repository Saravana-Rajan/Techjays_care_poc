from django.db import models
from django.core.validators import RegexValidator, MinValueValidator, MaxValueValidator


class Appointment(models.Model):
    # Section 1: Patient Identification
    full_name = models.CharField(max_length=255, help_text="Patient's full name")
    dob = models.DateField(help_text="Date of birth in MM/DD/YYYY format")
    gender = models.CharField(
        max_length=20,
        choices=[
            ('Male', 'Male'),
            ('Female', 'Female'),
            ('Other', 'Other'),
            ('Prefer not to say', 'Prefer not to say'),
        ],
        help_text="Patient's gender"
    )
    contact_number = models.CharField(
        max_length=20,
        help_text="Contact phone number"
    )
    email = models.EmailField(help_text="Email address", blank=True, null=True)
    address = models.TextField(help_text="Home address (Street, City, State, ZIP)")
    preferred_language = models.CharField(max_length=100, blank=True, null=True, help_text="Preferred language")
    emergency_contact_name = models.CharField(max_length=255, blank=True, null=True, help_text="Emergency contact name")
    emergency_contact_phone = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text="Emergency contact phone number"
    )
    relationship_to_patient = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Relationship to patient"
    )

    # Section 2: Visit & Care Context
    caller_type = models.CharField(
        max_length=20,
        help_text="Type of caller"
    )
    reason_for_visit = models.TextField(help_text="Reason for the visit")
    visit_type = models.CharField(
        max_length=20,
        choices=[
            ('First time', 'First time'),
            ('Returning', 'Returning'),
        ],
        help_text="Type of visit"
    )
    primary_physician = models.CharField(max_length=255, blank=True, null=True, help_text="Primary care physician")
    referral_source = models.CharField(
        max_length=50,
        choices=[
            ('Self', 'Self'),
            ('Physician Referral', 'Physician Referral'),
            ('Insurance', 'Insurance'),
            ('Other', 'Other'),
        ],
        help_text="Source of referral"
    )

    # Section 3: Medical Information
    symptoms = models.TextField(help_text="Current symptoms")
    symptom_duration = models.CharField(max_length=100, blank=True, null=True, help_text="Duration of symptoms")
    pain_level = models.IntegerField(
        blank=True,
        null=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
        help_text="Pain level on scale of 0-10"
    )
    current_medications = models.TextField(blank=True, null=True, help_text="Current medications")
    allergies = models.TextField(blank=True, null=True, help_text="Known allergies")
    medical_history = models.TextField(blank=True, null=True, help_text="Past medical history")
    family_history = models.TextField(blank=True, null=True, help_text="Family medical history")

    # Section 4: Accessibility & Support Needs
    interpreter_need = models.BooleanField(blank=True, null=True, help_text="Need for interpreter")
    interpreter_language = models.CharField(max_length=100, blank=True, null=True, help_text="Interpreter language")
    accessibility_needs = models.TextField(blank=True, null=True, help_text="Mobility/accessibility needs")
    dietary_needs = models.TextField(blank=True, null=True, help_text="Dietary considerations")

    # Section 5: Consent & Preferences
    consent_share_records = models.BooleanField(blank=True, null=True, help_text="Consent to share records")
    preferred_communication_method = models.CharField(
        max_length=20,
        choices=[
            ('Phone', 'Phone'),
            ('Email', 'Email'),
            ('Patient Portal', 'Patient Portal'),
        ],
        blank=True,
        null=True,
        help_text="Preferred communication method"
    )
    appointment_availability = models.CharField(
        max_length=20,
        choices=[
            ('Morning', 'Morning'),
            ('Afternoon', 'Afternoon'),
            ('Evening', 'Evening'),
        ],
        blank=True,
        null=True,
        help_text="Appointment availability preference"
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, help_text="When the appointment was created")
    updated_at = models.DateTimeField(auto_now=True, help_text="When the appointment was last updated")

    class Meta:
        ordering = ['-created_at']
        db_table = 'appointment'
        verbose_name = 'Appointment'
        verbose_name_plural = 'Appointments'

    def __str__(self):
        return f"{self.full_name} - {self.created_at.strftime('%Y-%m-%d')}"


class AppointmentAttachment(models.Model):
    appointment = models.ForeignKey(Appointment, related_name='attachments', on_delete=models.CASCADE)
    file = models.FileField(upload_to='attachments/%Y/%m/%d/')
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']
        db_table = 'appointment_attachment'
        verbose_name = 'Appointment Attachment'
        verbose_name_plural = 'Appointment Attachments'

    def __str__(self):
        return f"Attachment for {self.appointment_id}: {self.original_name}"