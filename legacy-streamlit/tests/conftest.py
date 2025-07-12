"""
Pytest configuration for test suite
"""
import pytest
import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add the parent directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.database import Base
from app.db.models import User, AdminEvent, ModeratorPermission


@pytest.fixture(scope="session")
def test_engine():
    """Create a test database engine"""
    # Use an in-memory SQLite database for tests
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def test_session(test_engine):
    """Create a test database session"""
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestSessionLocal()
    
    # Begin a transaction
    session.begin()
    
    yield session
    
    # Rollback the transaction to clean up
    session.rollback()
    session.close()


@pytest.fixture
def mock_admin_user(test_session):
    """Create a mock admin user for testing"""
    admin = User(
        username="admin",
        email="admin@test.com",
        first_name="Admin",
        last_name="User",
        is_active=True,
        is_admin=True,
        is_moderator=False
    )
    test_session.add(admin)
    test_session.commit()
    return admin


@pytest.fixture(autouse=True)
def setup_test_env(monkeypatch):
    """Set up test environment variables"""
    # Set test environment variables
    monkeypatch.setenv("TESTING", "true")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("MATRIX_ACTIVE", "false")
    monkeypatch.setenv("SMTP_ACTIVE", "false")
    monkeypatch.setenv("DISCOURSE_ACTIVE", "false") 