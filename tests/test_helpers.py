import pytest
from datetime import datetime, date, time
import string
from app.utils.helpers import create_unique_username, get_eastern_time, generate_unique_code, test_email_connection
from app.utils.config import Config
import smtplib

def test_create_unique_username(mocker):
    # Mock the function that checks if we're in a test environment to return False
    # so we test the production behavior with random suffix
    mocker.patch('sys.modules', {})
    
    # Create a simple username
    username = create_unique_username(None, "testuser")
    
    # Check that it starts with "testuser" and ends with 2 digits
    assert username.startswith("testuser")
    assert len(username) == len("testuser") + 2
    
    # Check that the suffix is numeric
    suffix = username[len("testuser"):]
    assert suffix.isdigit()
    assert 10 <= int(suffix) <= 99

def test_get_eastern_time():
    """Test the eastern time conversion"""
    from app.utils.helpers import get_eastern_time
    
    test_date = date(2024, 1, 1)
    test_time = time(14, 30)
    
    result = get_eastern_time(test_date, test_time)
    assert result.tzname() in ['EST', 'EDT']

def test_generate_unique_code():
    # Test code generation
    code1 = generate_unique_code()
    code2 = generate_unique_code()
    
    # Test length
    assert len(code1) == 6
    assert len(code2) == 6
    
    # Test uniqueness
    assert code1 != code2
    
    # Test custom length
    assert len(generate_unique_code(length=8)) == 8
    
    # Test that codes only contain valid characters
    code = generate_unique_code()
    assert all(c in string.ascii_uppercase + string.digits for c in code)

def test_email_connection(mocker):
    """Test the email connection function"""
    from app.utils.helpers import test_email_connection
    
    # Mock SMTP
    mock_smtp = mocker.patch('smtplib.SMTP')
    mock_server = mock_smtp.return_value
    
    # Mock Config values
    mocker.patch.object(Config, 'SMTP_SERVER', 'test.smtp.com')
    mocker.patch.object(Config, 'SMTP_PORT', '587')
    mocker.patch.object(Config, 'SMTP_USERNAME', 'test@test.com')
    mocker.patch.object(Config, 'SMTP_PASSWORD', 'password')
    
    # Test successful connection
    mock_server.starttls.return_value = True
    mock_server.login.return_value = True
    
    result = test_email_connection()
    assert result == True
    
    # Test failed connection
    mock_smtp.side_effect = Exception("Connection failed")
    result = test_email_connection()
    assert result == False 