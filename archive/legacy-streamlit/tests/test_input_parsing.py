import pytest
from app.utils.transformations import simple_parse_input, parse_input, determine_input_format
from unittest.mock import patch

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

def test_parse_input_with_gpt_successful():
    """Test parsing with GPT when input is in chatgpt format and GPT parsing succeeds"""
    input_text = """Hello, my name is Jane Smith. 
    I work at ABC Tech as a Data Scientist.
    Sarah Johnson invited me to join.
    You can reach me at jane.smith@example.com.
    I'm interested in machine learning and data visualization."""
    
    # Mock the determine_input_format to return 'chatgpt' format
    with patch('app.utils.transformations.determine_input_format') as mock_determine:
        mock_determine.return_value = ('chatgpt', True)
        
        # Mock gpt_check_api to return True (API key is valid)
        with patch('app.utils.transformations.gpt_check_api') as mock_api_check:
            mock_api_check.return_value = True
            
            # Mock the gpt_parse_input function to return a predefined result
            with patch('app.utils.transformations.gpt_parse_input') as mock_gpt_parse:
                mock_gpt_parse.return_value = {
                    'first_name': 'Jane',
                    'last_name': 'Smith',
                    'email': 'jane.smith@example.com',
                    'invited_by': 'Sarah Johnson',
                    'intro': {
                        'organization': 'ABC Tech',
                        'interests': 'machine learning and data visualization'
                    }
                }
                
                # Call the function
                result = parse_input(input_text)
                
                # Verify result
                assert result['first_name'] == 'Jane'
                assert result['last_name'] == 'Smith'
                assert result['email'] == 'jane.smith@example.com'
                assert result['invited_by'] == 'Sarah Johnson'
                assert result['intro']['organization'] == 'ABC Tech'
                assert 'machine learning' in result['intro']['interests']
                
                # Verify the mocks were called
                mock_determine.assert_called_once()
                mock_api_check.assert_called_once()
                mock_gpt_parse.assert_called_once_with(input_text)

def test_parse_input_with_gpt_fallback():
    """Test parsing with GPT fallback when GPT parsing fails"""
    input_text = """Hello, my name is John Doe. 
    I work at XYZ Corp.
    I was invited by Alex Brown.
    My email is john.doe@example.com.
    I'm interested in software engineering and AI."""
    
    # Mock the determine_input_format to return 'chatgpt' format
    with patch('app.utils.transformations.determine_input_format') as mock_determine:
        mock_determine.return_value = ('chatgpt', True)
        
        # Mock gpt_check_api to raise an exception (API key is invalid or missing)
        with patch('app.utils.transformations.gpt_check_api') as mock_api_check:
            mock_api_check.side_effect = ValueError("No valid API key")
            
            # Mock the simple_parse_input function to return a predefined result
            with patch('app.utils.transformations.simple_parse_input') as mock_simple_parse:
                mock_simple_parse.return_value = {
                    'first_name': 'John',
                    'last_name': 'Doe',
                    'email': 'john.doe@example.com',
                    'intro': {
                        'interests': 'XYZ Corp. I was invited by Alex Brown. I\'m interested in software engineering and AI.'
                    }
                }
                
                # Call the function
                result = parse_input(input_text)
                
                # Verify result matches simple parser output
                assert result['first_name'] == 'John'
                assert result['last_name'] == 'Doe'
                assert result['email'] == 'john.doe@example.com'
                assert 'XYZ Corp' in result['intro']['interests']
                
                # Verify the mocks were called
                mock_determine.assert_called_once()
                mock_api_check.assert_called_once()
                mock_simple_parse.assert_called_once_with(input_text) 