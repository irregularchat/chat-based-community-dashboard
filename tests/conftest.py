import os
import sys
from pathlib import Path
from datetime import datetime

# Set testing environment variable first
os.environ["TESTING"] = "True"

# Get the project root directory (parent of tests directory)
ROOT_DIR = Path(__file__).parent.parent

# Add the project root to the Python path
sys.path.insert(0, str(ROOT_DIR))

# Now we can import app modules after setting up the path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Import app modules
from app.db.database import Base
from app.db.operations import *  # Import all models to ensure they're registered
from app.utils.config import Config

# Set up test environment variables
@pytest.fixture(autouse=True)
def setup_test_env():
    """Setup test environment variables"""
    os.environ.update({
        "TESTING": "True",
        "DATABASE_URL": "sqlite:///test.db",
        "SMTP_SERVER": "test.smtp.com",
        "SMTP_PORT": "587",
        "SMTP_USERNAME": "test@test.com",
        "SMTP_PASSWORD": "test_password",
        "MATRIX_HOMESERVER_URL": "https://matrix.example.com",
        "MATRIX_BOT_USERNAME": "testbot",
        "MATRIX_ACCESS_TOKEN": "test_token",
        "MATRIX_DEFAULT_ROOM_ID": "test_room",
        "MATRIX_WELCOME_ROOM_ID": "welcome_room",
        "MATRIX_BOT_DISPLAY_NAME": "Test Bot",
        "MATRIX_ACTIVE": "true"
    })
    yield
    # Clean up after tests
    if os.path.exists("test.db"):
        os.remove("test.db")

@pytest.fixture(scope="session")
def test_db_engine():
    """Create a test database engine"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return engine

@pytest.fixture(scope="function")
def test_db(test_db_engine):
    """Create a fresh database session for each test"""
    connection = test_db_engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    
    # Create all tables
    Base.metadata.create_all(bind=connection)
    
    yield session
    
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture(scope="function")
def test_user(test_db):
    """Create a test user"""
    user = User(
        username="testuser",
        email="test@example.com",
        first_name="Test",
        last_name="User",
        is_active=True,
        is_admin=False,
        date_joined=datetime.now()
    )
    test_db.add(user)
    test_db.commit()
    return user

@pytest.fixture(scope="function")
def test_admin(test_db):
    """Create a test admin user"""
    admin = User(
        username="admin",
        email="admin@example.com",
        first_name="Admin",
        last_name="User",
        is_active=True,
        is_admin=True,
        date_joined=datetime.now()
    )
    test_db.add(admin)
    test_db.commit()
    return admin 