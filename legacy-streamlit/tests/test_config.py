import pytest
from app.utils.config import Config

def test_config_loading():
    assert hasattr(Config, 'DATABASE_URL')
    assert hasattr(Config, 'SMTP_SERVER')
    # Add more configuration tests 