import pytest
from app.utils.transformations import simple_parse_input, parse_input, determine_input_format

def test_simple_parse_input_with_email_first():
    """Test parsing when email is the first line"""
    input_text = """test@example.com
    John Doe
    ACME Corporation
    Python, AI, Testing"""
    
    result = simple_parse_input(input_text)
    assert result["email"] == "test@example.com"
    assert "John Doe" in result["intro"]["interests"]
    assert "ACME Corporation" in result["intro"]["interests"]
    assert "Python" in result["intro"]["interests"]

def test_simple_parse_input_with_numbers_and_bullets():
    """Test parsing input with numbers and bullets"""
    input_text = """1. John Doe
    2. john@example.com
    3. ACME Corporation
    • Python
    • AI
    • Testing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john@example.com"
    assert "ACME Corporation" in result["intro"]["interests"]
    assert "Python" in result["intro"]["interests"]
    assert "AI" in result["intro"]["interests"]

def test_simple_parse_input_with_special_characters():
    """Test parsing input with special characters in name"""
    input_text = """John O'Reilly-Smith
    john.oreilly@example.com
    Tech Company Inc.
    Interests: Java, Python, Cloud"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "O'Reilly-Smith"
    assert result["email"] == "john.oreilly@example.com"
    assert "Tech Company Inc." in result["intro"]["interests"]
    assert "Java" in result["intro"]["interests"]

def test_simple_parse_input_with_invited_by_format():
    """Test parsing input with 'Invited by' format"""
    input_text = """John Doe
    john@example.com
    Invited by: Sarah Johnson
    Interests: Python, Cloud Computing"""
    
    result = simple_parse_input(input_text)
    assert result["first_name"] == "John"
    assert result["last_name"] == "Doe"
    assert result["email"] == "john@example.com"
    assert "Sarah Johnson" in result["intro"]["interests"]
    assert "Python" in result["intro"]["interests"]

def test_parse_input_empty():
    """Test parsing with empty input"""
    input_text = ""
    
    result = parse_input(input_text)
    assert isinstance(result, dict)
    assert result["first_name"] == ""
    assert result["last_name"] == ""
    assert result["email"] == ""

def test_parse_input_whitespace_only():
    """Test parsing with whitespace only input"""
    input_text = "   \n   \t   "
    
    result = parse_input(input_text)
    assert isinstance(result, dict)
    assert result["first_name"] == ""
    assert result["last_name"] == ""
    assert result["email"] == ""

def test_parse_input_with_complex_format():
    """Test parsing with a more complex input format"""
    input_text = """John Doe (Software Engineer)
    john.doe@example.com
    Tech Company - AI Division
    Referred by: @sarahjohnson
    Interests: Machine Learning, Python, Cloud Computing, Data Science
    Skills: TensorFlow, PyTorch, AWS, Docker"""
    
    result = parse_input(input_text)
    assert result["first_name"] == "John"
    assert "Doe" in result["last_name"]
    assert "(Software Engineer)" in result["last_name"]
    assert result["email"] == "john.doe@example.com"
    assert "Tech Company" in result["intro"]["interests"]
    assert "Machine Learning" in result["intro"]["interests"]

def test_determine_input_format_with_email():
    """Test input format detection with email"""
    input_text = """John Doe
    john.doe@example.com
    Some Organization"""
    
    format_type, is_confident = determine_input_format(input_text)
    assert format_type == "numbered"
    assert is_confident is True

def test_determine_input_format_with_social_handle():
    """Test input format detection with social media handle"""
    input_text = """John Doe
    Some Organization
    @johndoe
    Interests: Python, AI"""
    
    format_type, is_confident = determine_input_format(input_text)
    assert format_type == "numbered"
    assert is_confident is True 