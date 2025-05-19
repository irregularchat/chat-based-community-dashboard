#!/usr/bin/env python3
import pytest
import logging
from unittest.mock import patch, MagicMock, Mock
import smtplib
import requests

from app.utils.config import Config
from app.utils.helpers import send_email, community_intro_email, handle_form_submission
from app.auth.api import create_user

# Configure logging
logging.basicConfig(level=logging.INFO,
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


@pytest.fixture
def mock_config():
    """Set up mock SMTP configuration"""
    with patch.object(Config, 'SMTP_SERVER', 'test.smtp.com'), \
         patch.object(Config, 'SMTP_PORT', '587'), \
         patch.object(Config, 'SMTP_USERNAME', 'test@example.com'), \
         patch.object(Config, 'SMTP_PASSWORD', 'password123'), \
         patch.object(Config, 'SMTP_FROM_EMAIL', 'noreply@example.com'), \
         patch.object(Config, 'SMTP_ACTIVE', True), \
         patch.object(Config, 'SMTP_BCC', None):
        yield Config


@pytest.fixture
def mock_smtp_server():
    """Mock the SMTP server"""
    with patch('smtplib.SMTP') as mock_smtp:
        server_instance = MagicMock()
        mock_smtp.return_value = server_instance
        server_instance.starttls.return_value = True
        server_instance.login.return_value = True
        server_instance.sendmail.return_value = {}
        yield mock_smtp


def test_send_email_function(mock_config, mock_smtp_server):
    """Test the basic send_email function"""
    result = send_email(
        to="user@example.com",
        subject="Test Email",
        body="<html><body><h1>Test Email</h1><p>This is a test email body.</p></body></html>"
    )
    
    # Verify the result
    assert result is True
    
    # Verify SMTP was called correctly
    mock_smtp_server.assert_called_once_with('test.smtp.com', 587)
    
    # Get the mock server instance
    server_instance = mock_smtp_server.return_value
    
    # Verify TLS was started
    server_instance.starttls.assert_called_once()
    
    # Verify login was called with correct credentials
    server_instance.login.assert_called_once_with('test@example.com', 'password123')
    
    # Verify sendmail was called
    assert server_instance.sendmail.called
    
    # Verify the server was closed
    server_instance.quit.assert_called_once()


def test_community_intro_email(mock_config, mock_smtp_server):
    """Test the community_intro_email function"""
    result = community_intro_email(
        to="user@example.com",
        subject="Welcome to Our Community",
        full_name="Test User",
        username="testuser",
        password="SecureP@ss123",
        topic_id="1",
        discourse_post_url="https://community.example.com/t/welcome-test-user/1"
    )
    
    # Verify the result
    assert result is True
    
    # Verify SMTP server was used
    mock_smtp_server.assert_called_once()
    
    # Get the mock server instance
    server_instance = mock_smtp_server.return_value
    
    # Verify sendmail was called
    assert server_instance.sendmail.called
    
    # Verify the content of the email
    args, kwargs = server_instance.sendmail.call_args
    
    # args[0] is the sender, args[1] is the recipients list, args[2] is the message string
    # Check that the email contains expected content
    email_content = args[2]
    assert "Welcome to" in email_content
    assert "testuser" in email_content
    assert "SecureP@ss123" in email_content
    assert "https://community.example.com/t/welcome-test-user/1" in email_content


def test_smtp_error_handling(mock_config):
    """Test handling of SMTP errors"""
    with patch('smtplib.SMTP') as mock_smtp:
        # Set up the SMTP mock to raise an exception
        mock_smtp.side_effect = smtplib.SMTPException("Connection failed")
        
        # Call the function and check the result
        result = send_email("user@example.com", "Test", "Test body")
        assert result is False


@patch('app.auth.api.requests.post')
@patch('app.auth.api.Config')
@patch('app.utils.helpers.community_intro_email')
def test_user_creation_sends_email(mock_community_email, mock_config, mock_post):
    """Test that creating a user triggers sending a welcome email"""
    # Configure mocks
    mock_config.AUTHENTIK_API_URL = "https://auth.example.com/api/v2"
    mock_config.AUTHENTIK_API_TOKEN = "test_token"
    mock_config.MAIN_GROUP_ID = "test_group"
    mock_config.MATRIX_ENABLED = False
    mock_config.DISCOURSE_ACTIVE = False
    
    # Mock the API response
    mock_post.return_value.status_code = 201
    mock_post.return_value.json.return_value = {
        "pk": "123",
        "username": "testuser"
    }
    
    # Set up email mock to return success
    mock_community_email.return_value = True
    
    # Call create_user
    result = create_user(
        email="test@example.com",
        first_name="Test",
        last_name="User",
        desired_username="testuser",
        send_welcome=True
    )
    
    # Verify user was created successfully
    assert result['success'] is True
    assert result['username'] == "testuser"
    
    # Verify that the community_intro_email function was called with correct parameters
    mock_community_email.assert_called_once()
    call_args = mock_community_email.call_args[1]  # Get the keyword arguments
    assert call_args['to'] == "test@example.com"
    assert "Test User" in call_args['full_name']
    assert call_args['username'] == "testuser"
    assert call_args['password'] == result['temp_password']


@patch('app.auth.api.requests.post')
@patch('app.auth.api.Config')
@patch('app.auth.api.logger')
def test_user_creation_email_integration(mock_logger, mock_config, mock_post):
    """Test the full email flow in user creation by checking the user creation response"""
    # Configure mocks
    mock_config.AUTHENTIK_API_URL = "https://auth.example.com/api/v2"
    mock_config.AUTHENTIK_API_TOKEN = "test_token"
    mock_config.AUTHENTIK_API_USERNAME = "admin"
    mock_config.MAIN_GROUP_ID = "test_group"
    mock_config.MATRIX_ENABLED = False
    mock_config.DISCOURSE_ACTIVE = True
    mock_config.DISCOURSE_URL = "https://forum.example.com"
    mock_config.DISCOURSE_API_KEY = "discourse_api_key"
    mock_config.DISCOURSE_API_USERNAME = "system"
    mock_config.DISCOURSE_CATEGORY_ID = "1"
    
    # Mock the threading.Thread to avoid actual thread creation
    # We're just testing that user creation works, not the email sending itself
    with patch('app.auth.api.threading.Thread') as mock_thread, \
         patch('app.auth.api.create_discourse_post') as mock_discourse:
        
        # Mock Authentik API response for user creation
        mock_post.return_value.status_code = 201
        mock_post.return_value.json.return_value = {
            "pk": "123",
            "username": "testuser"
        }
        
        # Mock discourse post creation
        mock_discourse.return_value = (True, "https://forum.example.com/t/1/welcome-testuser")
        
        # Create the user
        result = create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            desired_username="testuser",
            send_welcome=True,
            should_create_discourse_post=True
        )
    
    # Verify user was created successfully
    assert result['success'] is True
    assert result['username'] == "testuser"
    
    # Verify that threads were created for sending welcome message and email
    # Our implementation now creates two threads - one for Matrix and one for email
    assert mock_thread.call_count == 2, "Expected two threads to be created (Matrix and email)"
    
    # Get the target functions of both thread calls
    call_args_list = mock_thread.call_args_list
    target_functions = [call.kwargs.get('target').__name__ for call in call_args_list]
    
    # Check that we have both types of tasks
    assert any('welcome_message' in func_name for func_name in target_functions), "Missing Matrix message task"
    assert any('email' in func_name for func_name in target_functions), "Missing email task"


@patch('app.utils.helpers.community_intro_email')
@patch('app.auth.api.create_user')
def test_form_submission_sends_email(mock_create_user, mock_community_email):
    """Test that the handle_form_submission function correctly sends emails when creating users"""
    from app.utils.helpers import handle_form_submission
    
    # Setup the create_user mock to return a successful result
    # Note: The async version returns (success, username, password, discourse_url)
    mock_create_user.return_value.__aiter__.return_value = (True, "testuser", "temp123", "https://discourse.example.com/t/intro-testuser/123")
    
    # Set up community_intro_email to return success
    mock_community_email.return_value = True
    
    # Call the function with email
    with patch('app.utils.helpers.get_db') as mock_get_db, \
         patch('app.utils.helpers.asyncio.new_event_loop') as mock_loop, \
         patch('streamlit.success') as mock_st_success, \
         patch('streamlit.warning') as mock_st_warning, \
         patch('streamlit.session_state', {
             'first_name_input': 'Test',
             'last_name_input': 'User'
         }):
        
        # Mock the database session
        mock_db = MagicMock()
        mock_get_db.return_value.__next__.return_value = mock_db
        
        # Mock asyncio loop
        loop_instance = MagicMock()
        mock_loop.return_value = loop_instance
        loop_instance.run_until_complete.return_value = (True, "testuser", "temp123", "https://discourse.example.com/t/intro-testuser/123")
        
        # Call handle_form_submission to create a user with email
        result = handle_form_submission(
            action="create_user",
            username="testuser",
            email="test@example.com",
            invited_by="admin",
            intro="Test introduction"
        )
    
    # Verify the result
    assert result is True
    
    # Verify community_intro_email was called with the correct parameters
    mock_community_email.assert_called_once()
    call_args = mock_community_email.call_args[1]
    assert call_args['to'] == "test@example.com"
    assert "Welcome" in call_args['subject']
    assert call_args['username'] == "testuser"
    assert call_args['password'] == "temp123"


@patch('app.utils.helpers.send_email')
@patch('app.utils.helpers.get_email_html_content')
def test_email_sending_with_new_user(mock_get_email_html, mock_send_email):
    """Test that email is properly sent when a new user is created"""
    from app.utils.helpers import community_intro_email
    
    # Setup our mocks
    mock_get_email_html.return_value = "<html><body>Welcome Email</body></html>"
    mock_send_email.return_value = True
    
    # Call the community_intro_email function directly - this is what handles email sending
    result = community_intro_email(
        to="test@example.com",
        subject="Welcome to Our Community!",
        full_name="Test User",
        username="testuser",
        password="securepassword123",
        topic_id="123",
        discourse_post_url="https://discourse.example.com/t/intro/123"
    )
    
    # Verify the result
    assert result is True
    
    # Verify get_email_html_content was called with the right parameters - using positional args
    mock_get_email_html.assert_called_once_with(
        "Test User",  # full_name (positional)
        "testuser",   # username (positional)
        "securepassword123",  # password (positional)
        "123",        # topic_id (positional)
        "https://discourse.example.com/t/intro/123"  # discourse_post_url (positional)
    )
    
    # Verify send_email was called with the right parameters
    mock_send_email.assert_called_once()
    call_args = mock_send_email.call_args[0]  # Positional arguments
    assert call_args[0] == "test@example.com"  # to
    assert call_args[1] == "Welcome to Our Community!"  # subject
    assert call_args[2] == "<html><body>Welcome Email</body></html>"  # HTML body


if __name__ == "__main__":
    pytest.main(["-xvs", __file__]) 