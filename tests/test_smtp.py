#!/usr/bin/env python3
import logging
import os
from app.utils.config import Config
from app.utils.helpers import send_email, test_email_connection, community_intro_email
import traceback

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def test_email_connection():
    """Test SMTP connectivity"""
    from app.utils.helpers import test_email_connection as app_test_email_connection
    return app_test_email_connection()

def run_smtp_tests():
    """Run a series of tests for SMTP functionality"""
    
    print("\n===== Current SMTP Configuration =====")
    print(f"SMTP_ACTIVE: {Config.SMTP_ACTIVE}")
    print(f"SMTP_SERVER: {Config.SMTP_SERVER}")
    print(f"SMTP_PORT: {Config.SMTP_PORT}")
    print(f"SMTP_USERNAME: {Config.SMTP_USERNAME}")
    print(f"SMTP_PASSWORD: {'*' * len(Config.SMTP_PASSWORD) if Config.SMTP_PASSWORD else None}")
    print(f"SMTP_FROM_EMAIL: {Config.SMTP_FROM_EMAIL}")
    print(f"SMTP_BCC: {Config.SMTP_BCC}")
    
    # Test 1: Test configuration with test_email_connection
    print("\n===== Test 1: Testing SMTP Connection =====")
    try:
        # We'll use the existing function which logs good info
        result = test_email_connection()
        print(f"Connection test result: {result}")
    except Exception as e:
        print(f"Connection test exception: {e}")
        traceback.print_exc()
    
    # Test 2: Email sending test
    print("\n===== Test 2: Testing Email Sending =====")
    test_email = os.environ.get("TEST_EMAIL", "test@example.com")
    try:
        result = send_email(
            to=test_email,
            subject="Test Email from Community Dashboard",
            body="<html><body><h1>Test Email</h1><p>This is a test email from the Community Dashboard.</p></body></html>"
        )
        print(f"Email sending result: {result}")
    except Exception as e:
        print(f"Email sending exception: {e}")
        traceback.print_exc()
    
    # Test 3: Community intro email test
    print("\n===== Test 3: Testing Community Intro Email =====")
    try:
        result = community_intro_email(
            to=test_email,
            subject="Test Welcome Email",
            full_name="Test User",
            username="testuser",
            password="testpassword123",
            topic_id="1"
        )
        print(f"Community intro email result: {result}")
    except Exception as e:
        print(f"Community intro email exception: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    run_smtp_tests() 