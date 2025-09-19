# AI Hospital Voice System

A comprehensive Django-based healthcare application that enables voice-powered patient intake through real-time AI conversations. The system combines advanced voice processing with intelligent form automation to streamline hospital patient registration and appointment scheduling.

## Features

### Core Functionality
- **Real-time Voice Conversations**: Native audio processing with Google Gemini 2.5 Flash for natural patient interactions
- **Intelligent Patient Intake**: AI-driven conversation flow that collects comprehensive medical information
- **Dynamic Form Completion**: Automatic population of patient data forms based on voice conversations
- **Progress Tracking**: Visual checklist system showing real-time completion status across 5 key intake sections
- **File Upload Support**: Document and image attachment capabilities for medical records

### Advanced Features
- **WebSocket Integration**: Real-time bidirectional communication between frontend and AI backend
- **Session Management**: Persistent conversation state with recovery capabilities
- **Medical Data Validation**: Built-in validation for healthcare-specific data fields
- **Appointment Management**: Complete CRUD operations for patient appointments
- **Responsive Design**: Modern, hospital-themed UI optimized for healthcare workflows
- **Multi-language Support**: Interpreter needs assessment and language preference handling

## Technology Stack

### Backend
- **Framework**: Django 5.2.5 with Django REST Framework 3.16.1
- **WebSocket**: Django Channels 4.1.0 for real-time communication
- **AI Integration**: Google Gemini 2.5 Flash with native audio dialog capabilities
- **Database**: SQLite (development) with comprehensive medical data models
- **File Handling**: Django's file upload system with media management

### Frontend
- **JavaScript**: Vanilla ES6+ with modular architecture
- **Styling**: Tailwind CSS for responsive, modern UI design
- **Audio Processing**: Web Audio API for real-time voice capture and playback
- **WebSocket Client**: Native WebSocket API for bidirectional communication

### Infrastructure
- **Environment Management**: python-dotenv for configuration
- **API Integration**: RESTful endpoints with JSON serialization
- **Static Files**: Django's staticfiles system with organized asset structure

## Installation

### Prerequisites
- Python 3.8 or higher
- pip (Python package manager)
- Git

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/Jetrix-TJ/gcp_hospital_voice_form.git
   cd ai-hospital-voice
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   
   # On Windows
   venv\Scripts\activate
   
   # On macOS/Linux
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   cd ai_hospital
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   Create a `.env` file in the `ai_hospital/` directory:
   ```env
   # Required: Google Gemini API key for voice AI functionality
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Optional: OpenAI API key (if using OpenAI features)
   OPENAI_API_KEY=your_openai_api_key_here
   ```

5. **Run database migrations**
   ```bash
   python manage.py migrate
   ```

6. **Create a superuser (optional)**
   ```bash
   python manage.py createsuperuser
   ```

7. **Start the development server**
   
   For development (HTTP only):
   ```bash
   python manage.py runserver
   ```
   
   For WebSocket support (recommended):
   ```bash
   daphne ai_hospital.asgi:application
   ```

8. **Access the application**
   - Main application: `http://localhost:8000`
   - Admin interface: `http://localhost:8000/admin`
   - WebSocket endpoint: `ws://localhost:8000/ws/voice/`

## Usage

### Voice Conversation Flow

1. **Access the Application**: Navigate to the main page and click "Book an Appointment" or "Virtual Visit"
2. **Start Voice Session**: Click the "Start" button to initiate the AI voice conversation
3. **Natural Conversation**: Speak naturally with the AI assistant about your medical needs
4. **Real-time Processing**: Watch as the AI processes your responses and fills out the form automatically
5. **Progress Monitoring**: Track completion through the visual checklist on the right panel
6. **Data Review**: Review collected information in the left panel as it's populated
7. **Complete Intake**: The AI guides you through all required sections until completion

### Key Application Pages

- **Home Page** (`/`): Hospital information and service navigation
- **Voice Conversation** (`/conversation/`): Main AI-powered patient intake interface
- **Appointments** (`/appointments/`): View and manage patient appointments
- **Admin Interface** (`/admin/`): Backend administration for healthcare staff

### Patient Data Collection

The system collects comprehensive patient information across five main categories:

1. **Patient Information**: Name, DOB, contact details, emergency contacts
2. **Visit & Care Context**: Visit type, reason, physician referrals
3. **Medical Information**: Symptoms, medications, allergies, medical history
4. **Accessibility & Support**: Language needs, mobility requirements
5. **Consent & Preferences**: Communication preferences, appointment availability

## Project Structure

```
ai_hospital/
├── ai_hospital/                    # Django project configuration
│   ├── __init__.py
│   ├── settings.py                 # Main settings with environment variables
│   ├── urls.py                     # Root URL configuration
│   ├── wsgi.py                     # WSGI configuration
│   └── asgi.py                     # ASGI configuration for WebSockets
├── voice_flow/                     # Main application module
│   ├── models.py                   # Database models (Appointment, AppointmentAttachment)
│   ├── views.py                    # View controllers and API endpoints
│   ├── urls.py                     # Application URL routing
│   ├── ws.py                       # WebSocket consumer for real-time voice
│   ├── routing.py                  # WebSocket URL routing
│   ├── serializers.py              # DRF serializers for API responses
│   ├── constants.py                # Configuration constants (API keys, URLs)
│   ├── utils.py                    # Utility functions and checklist logic
│   ├── tasks.py                    # Background task definitions
│   ├── admin.py                    # Django admin configuration
│   ├── apps.py                     # App configuration
│   ├── tests.py                    # Test suite
│   ├── migrations/                 # Database migration files
│   ├── management/                 # Custom Django commands
│   ├── static/voice_flow/          # Static assets
│   │   ├── css/                    # Stylesheets
│   │   └── js/                     # JavaScript modules
│   │       ├── voice-flow-core.js  # Core voice processing logic
│   │       ├── voice-flow-ui.js    # UI management and interactions
│   │       ├── voice-flow.js       # Main application entry point
│   │       ├── prompt.js           # AI prompt templates
│   │       ├── common.js           # Shared utilities
│   │       └── marked.js           # Markdown processing
│   └── templates/voice_flow/       # HTML templates
│       ├── base.html               # Base template with common layout
│       ├── home.html               # Hospital homepage
│       ├── conversation.html       # Voice conversation interface
│       └── appointments.html       # Appointment management
├── media/                          # User-uploaded files
│   ├── attachments/                # Medical document attachments
│   └── uploads/                    # General file uploads
├── db.sqlite3                      # SQLite database (development)
├── manage.py                       # Django management script
├── requirements.txt                # Python dependencies
├── Dockerfile                      # Docker containerization
├── .env                           # Environment variables (not in repo)
└── README.md                      # This file
```

## Architecture Overview

### Core Components

#### 1. Voice Processing System
- **WebSocket Consumer** (`ws.py`): Handles real-time bidirectional communication with Google Gemini
- **Audio Processing**: Web Audio API integration for microphone capture and audio playback
- **Voice Activity Detection**: Automatic speech detection and processing
- **Session Management**: Persistent conversation state with recovery capabilities

#### 2. AI Integration
- **Google Gemini 2.5 Flash**: Native audio dialog model for natural conversation
- **Conversation Flow**: Intelligent dialogue management with context awareness
- **Data Extraction**: AI-powered form field population from natural speech
- **Validation System**: Real-time data validation and error correction

#### 3. Patient Data Management
- **Database Models**: Comprehensive patient and appointment data structures
- **API Endpoints**: RESTful APIs for data operations (CRUD)
- **File Handling**: Medical document and image attachment support
- **Session Storage**: Temporary data storage during intake process

#### 4. User Interface
- **Responsive Design**: Modern hospital-themed interface using Tailwind CSS
- **Real-time Updates**: Dynamic form population and progress tracking
- **Modular JavaScript**: Component-based frontend architecture
- **Accessibility**: Healthcare-optimized user experience

### Data Flow

1. **User Interaction**: Patient speaks into microphone
2. **Audio Capture**: Web Audio API captures and processes speech
3. **WebSocket Transmission**: Audio data sent to Django backend
4. **AI Processing**: Gemini processes audio and generates responses
5. **Data Extraction**: AI extracts structured data from conversation
6. **Form Population**: Frontend receives and displays extracted data
7. **Progress Tracking**: Checklist updates based on completed sections
8. **Database Storage**: Final data saved to appointment records

## API Endpoints

### REST API
- `GET /` - Hospital homepage
- `GET /conversation/` - Voice conversation interface
- `GET /appointments/` - Appointment management page
- `POST /save/` - Save voice flow data
- `POST /clear-voice-flow-session/` - Clear session data
- `GET|POST /api/appointments/` - Appointment CRUD operations
- `GET|PUT|DELETE /api/appointments/<id>/` - Individual appointment operations

### WebSocket
- `ws://localhost:8000/ws/voice/` - Real-time voice communication endpoint

## Database Schema

### Appointment Model
Comprehensive patient data structure including:
- **Patient Information**: Personal details, contact information, emergency contacts
- **Visit Context**: Visit type, reason, physician referrals, appointment preferences
- **Medical Data**: Symptoms, medications, allergies, medical history, pain levels
- **Accessibility**: Language needs, interpreter requirements, mobility considerations
- **Consent & Preferences**: Communication methods, record sharing permissions

### AppointmentAttachment Model
- File upload support for medical documents
- Metadata tracking (file type, size, upload timestamp)
- Secure file storage with organized directory structure

## Development

### Architecture Decisions
- **Django Channels**: Enables WebSocket support for real-time communication
- **Modular JavaScript**: Separation of concerns with distinct modules for UI, core logic, and utilities
- **Session-based State**: Temporary data storage during conversation flow
- **RESTful Design**: Clean API structure for frontend-backend communication

### Key Features Implementation
- **Real-time Voice**: WebSocket connection to Google Gemini for native audio processing
- **Progressive Data Collection**: Checklist-driven approach ensures comprehensive data gathering
- **Error Recovery**: Robust error handling with connection recovery and retry mechanisms
- **Responsive UI**: Mobile-friendly design optimized for healthcare environments

### Testing
The application includes comprehensive test coverage in `voice_flow/tests.py` covering:
- Model validation and data integrity
- API endpoint functionality
- WebSocket communication
- Session management

## Deployment Considerations

### Production Setup
- Configure proper database (PostgreSQL recommended)
- Set up secure environment variable management
- Configure static file serving (WhiteNoise or CDN)
- Implement proper logging and monitoring
- Set up SSL/TLS for secure WebSocket connections
- Use Daphne or other ASGI server for WebSocket support:
  ```bash
  daphne ai_hospital.asgi:application
  ```

### Environment Variables
Required environment variables for production:
```env
# Required
GEMINI_API_KEY=your_gemini_api_key
SECRET_KEY=your_django_secret_key
DEBUG=False
ALLOWED_HOSTS=your_domain.com

# Optional
OPENAI_API_KEY=your_openai_api_key
DATABASE_URL=your_database_url
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues, questions, or contributions, please refer to the project repository or contact the development team.