"""
UI forms tests for the application.
"""
import os
import sys
import unittest
from unittest import mock
import streamlit as st

# Add project root to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

class TestUIForms(unittest.TestCase):
    """Test cases for UI forms."""
    
    def setUp(self):
        """Set up test environment."""
        # Mock Streamlit functions
        self.patchers = [
            mock.patch('streamlit.button'),
            mock.patch('streamlit.text_input'),
            mock.patch('streamlit.selectbox'),
            mock.patch('streamlit.form'),
            mock.patch('streamlit.success'),
            mock.patch('streamlit.error'),
            mock.patch('streamlit.warning')
        ]
        
        for patcher in self.patchers:
            patcher.start()
        
        # Import after patching
        from app.ui.forms import display_user_list
        self.display_user_list = display_user_list
    
    def tearDown(self):
        """Clean up after each test."""
        for patcher in self.patchers:
            patcher.stop()
    
    @mock.patch('app.ui.forms.get_db')
    def test_display_user_list(self, mock_get_db):
        """Test display_user_list function."""
        # Mock database session and query
        from sqlalchemy.orm import Session
        from app.db.models import User
        
        # Create a mock database session
        mock_session = mock.Mock(spec=Session)
        mock_query = mock.Mock()
        
        # Setup mock user data
        mock_user = mock.Mock(spec=User)
        mock_user.id = 1
        mock_user.username = "testuser"
        mock_user.email = "test@example.com"
        mock_user.is_active = True
        mock_user.is_admin = False
        mock_user.is_moderator = False
        
        # Configure mock query
        mock_query.count.return_value = 1
        mock_query.offset.return_value.limit.return_value.all.return_value = [mock_user]
        mock_session.query.return_value = mock_query
        
        # Configure get_db to return our mock session
        mock_get_db.return_value = mock_session
        
        # Call the function
        self.display_user_list()
        
        # Verify database was queried
        mock_session.query.assert_called()
        mock_query.offset.assert_called()
        mock_query.limit.assert_called()
    
    @mock.patch('app.ui.forms.get_db')
    def test_empty_user_list(self, mock_get_db):
        """Test display_user_list with no users."""
        # Mock database session and query
        from sqlalchemy.orm import Session
        
        # Create a mock database session
        mock_session = mock.Mock(spec=Session)
        mock_query = mock.Mock()
        
        # Configure mock query
        mock_query.count.return_value = 0
        mock_query.offset.return_value.limit.return_value.all.return_value = []
        mock_session.query.return_value = mock_query
        
        # Configure get_db to return our mock session
        mock_get_db.return_value = mock_session
        
        # Call the function
        self.display_user_list()
        
        # Verify database was queried
        mock_session.query.assert_called()
        
        # Verify warning was shown for empty user list
        st.warning.assert_called_with("No users found matching the search criteria.")

if __name__ == "__main__":
    unittest.main()
