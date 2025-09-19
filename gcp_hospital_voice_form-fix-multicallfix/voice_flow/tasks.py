import logging

from rest_framework import serializers

from celery import shared_task
from hiring_manager_convo.utils import (
    generate_user_behavioral_summary, 
    correct_job_data_with_llm
)

logger = logging.getLogger(__name__)


@shared_task
def generate_and_save_behavioral_summary_task(data):
    conversation_messages = data.get('messages', [])
    summary = generate_user_behavioral_summary(conversation_messages)
    logger.info(f"Behavioral summary generated successfully for user")
    data['behavioral_summary'] = summary
    # save_behavioral_summary_to_database(data)


@shared_task(bind=True)
def save_job_requirement_task(self, data, user_id, organization_id, process_log_id):
    try:
        from hiring_manager_convo.serializers import SaveJobSerializer
        from jobs.utils.process_log_utility import update_process_log, STATUS_FAILED, STATUS_COMPLETED, STATUS_PROCESSING

        validated_data = None

        def update_process_log_status(process_log_id, status, progress, message, error_message=None, job_requirement_id=None):
            arguments_passed = {
                "progress": progress,
                "message": message,
                "error_message": error_message,
                "job_requirement_id": job_requirement_id
            }
            update_process_log(process_log_id, status=status, arguments_passed=arguments_passed)

        def correct_job_data(data, serializer_errors):
            return correct_job_data_with_llm(data, serializer_errors)
        
        def call_serializer(data):
            context = {
                'user_id': user_id,
                'organization_id': organization_id
            }
            serializer = SaveJobSerializer(
                data=data, 
                context=context, 
                update_process_log_status=update_process_log_status, 
                process_log_id=process_log_id
            )
            return serializer
        
        serializer = call_serializer(data)
        
        if not serializer.is_valid():
            corrected_data, correction_error, correction_summary = correct_job_data(data, serializer.errors)
            
            if correction_error:
                logger.error(f"LLM correction failed: {correction_error}")
                raise serializers.ValidationError(f"Data validation failed: {correction_error}")
            else:
                serializer = call_serializer(corrected_data)
                if not serializer.is_valid():
                    logger.error(f"Serializer validation failed: {serializer.errors}")
                    raise serializers.ValidationError(f"Data validation failed: {serializer.errors}")
                validated_data = serializer.validated_data
        else:
            validated_data = serializer.validated_data
        
        job_requirement = serializer.save_job_requirement(validated_data)
        job_requirement_id = job_requirement.id
        update_process_log_status(process_log_id, STATUS_PROCESSING, 50, "Interview Plan and Skills are being generated...", job_requirement_id=job_requirement_id)
        result = serializer.save_interview_plan(validated_data, job_requirement)
        update_process_log_status(process_log_id, STATUS_COMPLETED, 100, "Job posting created successfully.", job_requirement_id=job_requirement_id)
        logger.info(f"Job saved successfully: {result}")
        return result
        
    except serializers.ValidationError as e:
        update_process_log_status(process_log_id, STATUS_FAILED, 100, "Job posting failed to be created.", error_message=str(e))
        logger.error(f"Validation error in task: {e}")
        raise
    except Exception as e:
        update_process_log_status(process_log_id, STATUS_FAILED, 100, "Job posting failed to be created.", error_message=str(e))
        logger.error(f"Unexpected error in task: {e}")
        raise