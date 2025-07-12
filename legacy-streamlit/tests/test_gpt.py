import pytest
from app.utils.gpt_call import gpt_check_api

def test_gpt_api_key_validation(mocker):
    """Test GPT API key validation"""
    # Mock the OpenAI client
    mock_client = mocker.patch('app.utils.gpt_call.OpenAI')
    mock_response = mocker.Mock()
    mock_response.choices = [mocker.Mock(message=mocker.Mock(content="2"))]
    mock_client.return_value.chat.completions.create.return_value = mock_response
    
    # Test valid API key (51 characters)
    valid_key = "sk-" + "a" * 48  # Creates a key that's valid length
    mocker.patch('app.utils.config.Config.OPENAI_API_KEY', valid_key)
    assert gpt_check_api() == True
    
    # Test invalid API key
    mocker.patch('app.utils.config.Config.OPENAI_API_KEY', 'invalid-key')
    with pytest.raises(ValueError, match="OPENAI_API_KEY must start with 'sk-'"):
        gpt_check_api() 