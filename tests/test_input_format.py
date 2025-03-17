import pytest
from app.utils.transformations import simple_parse_input

def test_simple_parse_input():
    """Test parsing of various input formats"""
    # Test with email
    input_text = """John Doe
    john@example.com
    Some Organization
    Invited by Jane
    Python, Testing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john@example.com"
    
    # Test without email
    input_text = """John Doe
    Some Organization
    Invited by Jane
    Python, Testing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"

def test_parse_input_edge_cases():
    """Test edge cases for input parsing"""
    # Test empty input
    result = simple_parse_input("")
    assert result["first_name"] == ""
    assert result["last_name"] == ""
    assert result["email"] == ""
    
    # Test single line input
    result = simple_parse_input("John Doe")
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    
    # Test input with special characters
    input_text = """John O'Doe
    test@example.com
    Some Organization
    Invited by Jane
    Python, C++, Testing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "O'Doe"
    assert result["email"] == "test@example.com" 