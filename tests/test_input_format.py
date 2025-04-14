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

def test_numbered_formats_with_special_chars():
    """Test parsing of numbered lists with various special characters"""
    
    test_inputs = [
        """1: John Doe
2: Acme Corporation
3: Jane Smith
4: john.doe@example.com
5: Python, AI""",

        """1.. John Doe
2.. Acme Corporation
3.. Jane Smith
4.. john.doe@example.com
5.. Python, AI""",

        """1- John Doe
2- Acme Corporation
3- Jane Smith
4- john.doe@example.com
5- Python, AI""",

        """1) John Doe
2) Acme Corporation
3) Jane Smith
4) john.doe@example.com
5) Python, AI""",

        """1_ John Doe
2_ Acme Corporation
3_ Jane Smith
4_ john.doe@example.com
5_ Python, AI""",

        """1] John Doe
2] Acme Corporation
3] Jane Smith
4] john.doe@example.com
5] Python, AI"""
    ]
    
    for input_text in test_inputs:
        result = simple_parse_input(input_text)
        
        # Check that the parsing was successful
        assert result["first_name"] == "John"
        assert result["last_name"] == "Doe"
        assert result["email"] == "john.doe@example.com"
        assert result["invited_by"] == "Jane Smith"
        assert result["intro"]["organization"] == "Acme Corporation"
        assert result["intro"]["interests"] == "Python, AI" 

def test_ordinal_numbers_are_not_treated_as_list_markers():
    """Test that ordinal numbers (1st, 2nd, 3rd, 4th, etc.) are correctly treated as content, not list markers"""
    
    input_text = """John Doe
john.doe@example.com
At Acme Corp, I was ranked 3rd in the sales team
My 1st priority is learning Python
During my 2nd year, I focused on AI"""
    
    result = simple_parse_input(input_text)
    
    # Assert that name was correctly parsed
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john.doe@example.com"
    
    # Ensure ordinal numbers are preserved in interests
    assert "3rd in the sales team" in result["intro"]["interests"]
    assert "1st priority" in result["intro"]["interests"]
    assert "2nd year" in result["intro"]["interests"] 