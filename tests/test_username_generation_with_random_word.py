import pytest
from unittest.mock import patch, MagicMock
from app.auth.utils import generate_username_with_random_word

def test_generate_username_with_random_word():
    """Test that generate_username_with_random_word creates usernames in the expected format."""
    # Mock the xkcdpass function to return a predictable word
    with patch('xkcdpass.xkcd_password.generate_xkcdpassword', return_value='testword'):
        # Test with a normal first name
        username = generate_username_with_random_word('john')
        assert username == 'john-testword'
        
        # Test with a first name that needs cleaning
        username = generate_username_with_random_word('John Doe')
        assert username == 'john-testword'
        
        # Test with a first name containing special characters
        username = generate_username_with_random_word('John@Doe')
        assert username == 'johndoe-testword'
        
        # Test with an empty first name
        username = generate_username_with_random_word('')
        assert username == 'user-testword'
        
        # Test with None as first name
        username = generate_username_with_random_word(None)
        assert username == 'user-testword'

def test_generate_username_with_random_word_integration():
    """Test that generate_username_with_random_word works with the actual xkcdpass library."""
    # Test with a real call to xkcdpass (not mocked)
    username = generate_username_with_random_word('test')
    
    # Check that the username follows the expected pattern
    assert username.startswith('test-')
    assert len(username) > 6  # 'test-' plus at least one character
    
    # Check that the username only contains allowed characters
    import re
    assert re.match(r'^[a-z0-9-]+$', username) is not None
