import pytest
import unittest
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.utils.helpers import (
    is_valid_email_for_sending,
    validate_smtp_configuration,
    test_smtp_connection,
    send_admin_email_to_users,
    admin_user_email,
    EmailConfigError,
    EmailValidationError,
    EmailSendError
)

class TestEmailValidation(unittest.TestCase):
    """Test email validation functionality."""
    
    def test_valid_emails(self):
        """Test that valid emails pass validation."""
        valid_emails = [
            'user@example.com',
            'test.user@company.org',
            'admin@sub.domain.net',
            'user+tag@example.co.uk',
            'firstname.lastname@company.com'
        ]
        
        for email in valid_emails:
            with self.subTest(email=email):
                self.assertTrue(is_valid_email_for_sending(email))
    
    def test_invalid_email_formats(self):
        """Test that invalid email formats fail validation."""
        invalid_emails = [
            '',
            None,
            'not-an-email',
            '@example.com',
            'user@',
            'user..double@example.com',
            'user@.com',
            'user@com',
            'user name@example.com'  # Space in email
        ]
        
        for email in invalid_emails:
            with self.subTest(email=email):
                self.assertFalse(is_valid_email_for_sending(email))
    
    def test_filtered_domains(self):
        """Test that restricted domains are filtered out."""
        restricted_emails = [
            # Russian TLDs
            'user@example.ru',
            'test@company.рф',
            'admin@old.su',
            
            # Chinese TLDs
            'user@example.cn',
            'test@company.中国',
            'admin@site.中國',
            
            # Iranian TLDs
            'user@example.ir',
            
            # Placeholder emails
            'user@irregularchat.com',
            'test@irregularchat.com'
        ]
        
        for email in restricted_emails:
            with self.subTest(email=email):
                self.assertFalse(is_valid_email_for_sending(email))
    
    def test_edge_cases(self):
        """Test edge cases for email validation."""
        edge_cases = [
            ('user@EXAMPLE.COM', True),  # Uppercase domain should work
            ('USER@example.com', True),  # Uppercase local part should work
            ('user@example.CO.UK', True),  # Multi-part TLD should work
            ('a@b.co', True),  # Short email should work
            ('very.long.email.address@very.long.domain.name.example.com', True)
        ]
        
        for email, expected in edge_cases:
            with self.subTest(email=email):
                self.assertEqual(is_valid_email_for_sending(email), expected)


class TestSMTPConfiguration(unittest.TestCase):
    """Test SMTP configuration validation."""
    
    @patch('app.utils.helpers.Config')
    def test_smtp_disabled(self, mock_config):
        """Test validation when SMTP is disabled."""
        mock_config.SMTP_ACTIVE = False
        
        result = validate_smtp_configuration()
        
        self.assertFalse(result['valid'])
        self.assertIn('SMTP is not active', result['errors'][0])
    
    @patch('app.utils.helpers.Config')
    def test_missing_configuration(self, mock_config):
        """Test validation with missing configuration values."""
        mock_config.SMTP_ACTIVE = True
        mock_config.SMTP_SERVER = ''
        mock_config.SMTP_PORT = ''
        mock_config.SMTP_USERNAME = 'user'
        mock_config.SMTP_PASSWORD = 'pass'
        mock_config.SMTP_FROM_EMAIL = 'from@example.com'
        
        result = validate_smtp_configuration()
        
        self.assertFalse(result['valid'])
        self.assertIn('Missing SMTP_SERVER', result['errors'])
        self.assertIn('Missing SMTP_PORT', result['errors'])
    
    @patch('app.utils.helpers.Config')
    def test_invalid_email_format(self, mock_config):
        """Test validation with invalid from email format."""
        mock_config.SMTP_ACTIVE = True
        mock_config.SMTP_SERVER = 'smtp.example.com'
        mock_config.SMTP_PORT = '587'
        mock_config.SMTP_USERNAME = 'user'
        mock_config.SMTP_PASSWORD = 'pass'
        mock_config.SMTP_FROM_EMAIL = 'invalid-email'
        
        result = validate_smtp_configuration()
        
        self.assertFalse(result['valid'])
        self.assertTrue(any('Invalid SMTP_FROM_EMAIL format' in error for error in result['errors']))
    
    @patch('app.utils.helpers.Config')
    def test_invalid_port(self, mock_config):
        """Test validation with invalid port numbers."""
        mock_config.SMTP_ACTIVE = True
        mock_config.SMTP_SERVER = 'smtp.example.com'
        mock_config.SMTP_USERNAME = 'user'
        mock_config.SMTP_PASSWORD = 'pass'
        mock_config.SMTP_FROM_EMAIL = 'from@example.com'
        
        # Test non-numeric port
        mock_config.SMTP_PORT = 'not-a-number'
        result = validate_smtp_configuration()
        self.assertFalse(result['valid'])
        
        # Test out-of-range port
        mock_config.SMTP_PORT = '70000'
        result = validate_smtp_configuration()
        self.assertFalse(result['valid'])
    
    @patch('app.utils.helpers.Config')
    def test_configuration_warnings(self, mock_config):
        """Test configuration warnings for common issues."""
        mock_config.SMTP_ACTIVE = True
        mock_config.SMTP_SERVER = 'smtp.gmail.com'
        mock_config.SMTP_PORT = '25'  # Wrong port for Gmail
        mock_config.SMTP_USERNAME = 'user'
        mock_config.SMTP_PASSWORD = 'pass'
        mock_config.SMTP_FROM_EMAIL = 'from@example.com'
        
        result = validate_smtp_configuration()
        
        self.assertTrue(result['valid'])  # Should be valid but with warnings
        self.assertTrue(len(result['warnings']) > 0)
        self.assertTrue(any('Gmail SMTP typically uses' in warning for warning in result['warnings']))
    
    @patch('app.utils.helpers.Config')
    def test_valid_configuration(self, mock_config):
        """Test validation with valid configuration."""
        mock_config.SMTP_ACTIVE = True
        mock_config.SMTP_SERVER = 'smtp.example.com'
        mock_config.SMTP_PORT = '587'
        mock_config.SMTP_USERNAME = 'user@example.com'
        mock_config.SMTP_PASSWORD = 'password123'
        mock_config.SMTP_FROM_EMAIL = 'noreply@example.com'
        
        result = validate_smtp_configuration()
        
        self.assertTrue(result['valid'])
        self.assertEqual(len(result['errors']), 0)


class TestSMTPConnection(unittest.TestCase):
    """Test SMTP connection functionality."""
    
    @patch('app.utils.helpers.validate_smtp_configuration')
    def test_connection_with_invalid_config(self, mock_validate):
        """Test connection test with invalid configuration."""
        mock_validate.return_value = {
            'valid': False,
            'errors': ['Missing SMTP_SERVER'],
            'warnings': []
        }
        
        result = test_smtp_connection()
        
        self.assertFalse(result['success'])
        self.assertIn('Configuration invalid', result['error'])
    
    @patch('app.utils.helpers.validate_smtp_configuration')
    @patch('app.utils.helpers.smtplib.SMTP')
    def test_successful_connection(self, mock_smtp, mock_validate):
        """Test successful SMTP connection."""
        # Mock valid configuration
        mock_validate.return_value = {
            'valid': True,
            'errors': [],
            'warnings': []
        }
        
        # Mock successful SMTP connection
        mock_server = Mock()
        mock_server.getwelcome.return_value = b'220 Welcome'
        mock_smtp.return_value = mock_server
        
        with patch('app.utils.helpers.Config') as mock_config:
            mock_config.SMTP_SERVER = 'smtp.example.com'
            mock_config.SMTP_PORT = '587'
            mock_config.SMTP_USERNAME = 'user'
            mock_config.SMTP_PASSWORD = 'pass'
            
            result = test_smtp_connection()
        
        self.assertTrue(result['success'])
        self.assertIsNone(result['error'])
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once()
        mock_server.quit.assert_called_once()
    
    @patch('app.utils.helpers.validate_smtp_configuration')
    @patch('app.utils.helpers.smtplib.SMTP')
    def test_connection_timeout(self, mock_smtp, mock_validate):
        """Test SMTP connection timeout."""
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        
        # Mock timeout
        import socket
        mock_smtp.side_effect = socket.timeout("Connection timeout")
        
        with patch('app.utils.helpers.Config') as mock_config:
            mock_config.SMTP_SERVER = 'smtp.example.com'
            mock_config.SMTP_PORT = '587'
            
            result = test_smtp_connection()
        
        self.assertFalse(result['success'])
        self.assertIn('Connection timeout', result['error'])
    
    @patch('app.utils.helpers.validate_smtp_configuration')
    @patch('app.utils.helpers.smtplib.SMTP')
    def test_authentication_failure(self, mock_smtp, mock_validate):
        """Test SMTP authentication failure."""
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        
        # Mock authentication failure
        mock_server = Mock()
        mock_server.login.side_effect = Exception("Authentication failed")
        mock_smtp.return_value = mock_server
        
        with patch('app.utils.helpers.Config') as mock_config:
            mock_config.SMTP_SERVER = 'smtp.example.com'
            mock_config.SMTP_PORT = '587'
            mock_config.SMTP_USERNAME = 'user'
            mock_config.SMTP_PASSWORD = 'wrongpass'
            
            result = test_smtp_connection()
        
        self.assertFalse(result['success'])
        self.assertIn('Authentication failed', result['error'])


class TestBulkEmailSending(unittest.TestCase):
    """Test bulk email sending functionality."""
    
    def test_no_users_selected(self):
        """Test error when no users are selected."""
        result = send_admin_email_to_users([], "Subject", "Message")
        
        self.assertFalse(result['success'])
        self.assertIn('No users selected', result['error'])
    
    def test_empty_subject(self):
        """Test error when subject is empty."""
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        result = send_admin_email_to_users(users, "", "Message")
        
        self.assertFalse(result['success'])
        self.assertIn('Email subject is required', result['error'])
    
    def test_empty_message(self):
        """Test error when message is empty."""
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        result = send_admin_email_to_users(users, "Subject", "")
        
        self.assertFalse(result['success'])
        self.assertIn('Email message is required', result['error'])
    
    @patch('app.utils.helpers.validate_smtp_configuration')
    def test_invalid_smtp_config(self, mock_validate):
        """Test error when SMTP configuration is invalid."""
        mock_validate.return_value = {
            'valid': False,
            'errors': ['Missing SMTP_SERVER'],
            'warnings': []
        }
        
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        result = send_admin_email_to_users(users, "Subject", "Message")
        
        self.assertFalse(result['success'])
        self.assertIn('SMTP configuration invalid', result['error'])
    
    @patch('app.utils.helpers.is_valid_email_for_sending')
    @patch('app.utils.helpers.validate_smtp_configuration')
    def test_no_valid_emails(self, mock_validate, mock_email_valid):
        """Test error when no users have valid emails."""
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        mock_email_valid.return_value = False
        
        users = [
            {'Username': 'test1', 'Email': 'invalid', 'Name': 'Test User 1'},
            {'Username': 'test2', 'Email': 'user@blocked.ru', 'Name': 'Test User 2'}
        ]
        result = send_admin_email_to_users(users, "Subject", "Message")
        
        self.assertFalse(result['success'])
        self.assertIn('No users with valid email addresses found', result['error'])
    
    @patch('app.utils.helpers.admin_user_email')
    @patch('app.utils.helpers.is_valid_email_for_sending')
    @patch('app.utils.helpers.validate_smtp_configuration')
    @patch('app.utils.helpers.get_db')
    @patch('app.utils.helpers.add_timeline_event')
    def test_successful_email_sending(self, mock_timeline, mock_get_db, mock_validate, mock_email_valid, mock_send):
        """Test successful email sending to all users."""
        # Mock configuration and validation
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        mock_email_valid.return_value = True
        mock_send.return_value = True
        
        # Mock database
        mock_db = Mock()
        mock_get_db.return_value = iter([mock_db])
        
        users = [
            {'Username': 'test1', 'Email': 'user1@example.com', 'Name': 'Test User 1'},
            {'Username': 'test2', 'Email': 'user2@example.com', 'Name': 'Test User 2'}
        ]
        
        result = send_admin_email_to_users(users, "Test Subject", "Test Message")
        
        self.assertTrue(result['success'])
        self.assertEqual(result['success_count'], 2)
        self.assertEqual(len(result['failed_users']), 0)
        self.assertIn('Successfully sent emails to all 2 users', result['message'])
        
        # Verify email sending was called for each user
        self.assertEqual(mock_send.call_count, 2)
    
    @patch('app.utils.helpers.admin_user_email')
    @patch('app.utils.helpers.is_valid_email_for_sending')
    @patch('app.utils.helpers.validate_smtp_configuration')
    @patch('app.utils.helpers.get_db')
    @patch('app.utils.helpers.add_timeline_event')
    def test_partial_email_sending_failure(self, mock_timeline, mock_get_db, mock_validate, mock_email_valid, mock_send):
        """Test partial failure in email sending."""
        # Mock configuration and validation
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        mock_email_valid.return_value = True
        
        # Mock database
        mock_db = Mock()
        mock_get_db.return_value = iter([mock_db])
        
        # Mock email sending - first succeeds, second fails
        mock_send.side_effect = [True, False]
        
        users = [
            {'Username': 'test1', 'Email': 'user1@example.com', 'Name': 'Test User 1'},
            {'Username': 'test2', 'Email': 'user2@example.com', 'Name': 'Test User 2'}
        ]
        
        result = send_admin_email_to_users(users, "Test Subject", "Test Message")
        
        self.assertTrue(result['success'])  # Partial success
        self.assertEqual(result['success_count'], 1)
        self.assertEqual(len(result['failed_users']), 1)
        self.assertIn('Partially successful: Sent emails to 1 out of 2 users', result['message'])
    
    @patch('app.utils.helpers.admin_user_email')
    @patch('app.utils.helpers.is_valid_email_for_sending')
    @patch('app.utils.helpers.validate_smtp_configuration')
    def test_email_sending_with_attachments(self, mock_validate, mock_email_valid, mock_send):
        """Test email sending with attachments."""
        # Mock configuration and validation
        mock_validate.return_value = {'valid': True, 'errors': [], 'warnings': []}
        mock_email_valid.return_value = True
        mock_send.return_value = True
        
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        attachments = [
            {'filename': 'test.txt', 'content': b'test content', 'content_type': 'text/plain'}
        ]
        
        with patch('app.utils.helpers.get_db'), patch('app.utils.helpers.add_timeline_event'):
            result = send_admin_email_to_users(users, "Subject", "Message", attachments)
        
        self.assertTrue(result['success'])
        
        # Verify that admin_user_email was called with attachments
        mock_send.assert_called_once()
        call_args = mock_send.call_args
        self.assertEqual(call_args[1]['attachments'], attachments)


class TestEmailFormIntegration(unittest.TestCase):
    """Test email form integration and session state management."""
    
    @patch('streamlit.write')
    @patch('streamlit.expander')
    @patch('streamlit.error')
    def test_smtp_not_active(self, mock_error, mock_expander, mock_write):
        """Test form behavior when SMTP is not active."""
        from app.ui.forms import render_email_form
        
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        
        with patch('app.ui.forms.Config') as mock_config:
            mock_config.SMTP_ACTIVE = False
            
            success, result = render_email_form(users)
        
        self.assertFalse(success)
        self.assertIsNone(result)
        mock_error.assert_called()
    
    @patch('streamlit.write')
    @patch('streamlit.expander')
    @patch('streamlit.error')
    def test_missing_smtp_config(self, mock_error, mock_expander, mock_write):
        """Test form behavior when SMTP configuration is missing."""
        from app.ui.forms import render_email_form
        
        users = [{'Username': 'test', 'Email': 'test@example.com', 'Name': 'Test User'}]
        
        with patch('app.ui.forms.Config') as mock_config:
            mock_config.SMTP_ACTIVE = True
            mock_config.SMTP_SERVER = ''  # Missing
            mock_config.SMTP_PORT = '587'
            mock_config.SMTP_USERNAME = 'user'
            mock_config.SMTP_PASSWORD = 'pass'
            mock_config.SMTP_FROM_EMAIL = 'from@example.com'
            
            success, result = render_email_form(users)
        
        self.assertFalse(success)
        self.assertIsNone(result)
        mock_error.assert_called()


if __name__ == '__main__':
    # Create test suite
    test_suite = unittest.TestSuite()
    
    # Add test cases
    test_cases = [
        TestEmailValidation,
        TestSMTPConfiguration,
        TestSMTPConnection,
        TestBulkEmailSending,
        TestEmailFormIntegration
    ]
    
    for test_case in test_cases:
        tests = unittest.TestLoader().loadTestsFromTestCase(test_case)
        test_suite.addTests(tests)
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    # Exit with appropriate code
    exit(0 if result.wasSuccessful() else 1) 