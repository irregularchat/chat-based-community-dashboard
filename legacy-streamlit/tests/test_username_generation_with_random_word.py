import pytest
from unittest.mock import patch, MagicMock
from app.auth.utils import generate_username_with_random_word
import re

def test_generate_username_with_random_word():
    """Test that generate_username_with_random_word creates usernames in the expected format."""
    # Mock the xkcdpass function to return a predictable word
    with patch('xkcdpass.xkcd_password.generate_xkcdpassword', return_value='testword'), \
         patch('random.randint', return_value=42):  # Mock the random number generator
        # Test with a normal first name
        username = generate_username_with_random_word('john')
        assert username == 'john-testword42'
        
        # Test with a first name that needs cleaning
        username = generate_username_with_random_word('John Doe')
        assert username == 'john-testword42'
        
        # Test with a first name containing special characters
        username = generate_username_with_random_word('John@Doe')
        assert username == 'johndoe-testword42'
        
        # Test with an empty first name
        username = generate_username_with_random_word('')
        assert username == 'user-testword42'
        
        # Test with None as first name
        username = generate_username_with_random_word(None)
        assert username == 'user-testword42'

def test_generate_username_with_random_word_integration():
    """Test that generate_username_with_random_word works with the actual xkcdpass library."""
    # Test with a real call to xkcdpass (not mocked)
    username = generate_username_with_random_word('test')
    
    # Check that the username follows the expected pattern
    # Should match: test-[randomword][two digits]
    assert re.match(r'^test-[a-z]+\d{2}$', username) is not None
    
    # Extract the two-digit number at the end
    match = re.search(r'(\d{2})$', username)
    assert match is not None
    
    # Verify the number is between 10 and 99
    num = int(match.group(1))
    assert 10 <= num <= 99
