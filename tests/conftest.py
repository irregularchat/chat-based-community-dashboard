import pytest
import os
import sys
from pathlib import Path

# Get the project root directory
ROOT_DIR = Path(__file__).parent.parent

# Add the project root to the Python path
sys.path.insert(0, str(ROOT_DIR))

# Add the project root directory to Python path
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# Set up test environment variables
@pytest.fixture(autouse=True)
def setup_test_env():
    """Setup test environment variables"""
    os.environ.update({
        "TESTING": "True",
        "DATABASE_URL": "sqlite:///test.db",
        "SMTP_SERVER": "test.smtp.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "test@test.com",
        "SMTP_PASSWORD": "test_password",
    })
    yield
    # Clean up after tests
    if os.path.exists("test.db"):
        os.remove("test.db") 