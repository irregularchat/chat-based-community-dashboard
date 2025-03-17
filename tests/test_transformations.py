import pytest
from app.utils.transformations import simple_parse_input

def test_parse_input_with_organization():
    """Test parsing input with organization information"""
    input_text = """John Doe
    ACME Corporation
    john@example.com
    Invited by Jane Smith
    Python, Testing, DevOps"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john@example.com"
    assert "ACME Corporation" in result["intro"]["organization"]

def test_parse_input_with_inviter():
    """Test parsing input with inviter information"""
    input_text = """John Doe
    john@example.com
    
    Invited by Jane Smith
    Python, Testing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john@example.com"
    # Check if the inviter information is in the intro text since it's not a separate field
    assert "Jane Smith" in str(result["intro"])

def test_parse_input_minimal():
    """Test parsing with minimal input"""
    input_text = "John Doe"
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == ""
    assert result["intro"]["organization"] == ""
    assert result["intro"]["interests"] == "" 