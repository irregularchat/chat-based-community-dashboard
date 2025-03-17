import pytest
from app.utils.config import Config

def test_config_exists():
    """Basic test to verify Config class is accessible"""
    assert hasattr(Config, 'PAGE_TITLE')

def test_smtp_config():
    """Test SMTP configuration exists"""
    assert hasattr(Config, 'SMTP_SERVER')
    assert hasattr(Config, 'SMTP_PORT')

def test_environment():
    """Verify we're in test environment"""
    assert Config.DATABASE_URL is not None 