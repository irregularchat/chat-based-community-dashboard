import pytest
from unittest.mock import MagicMock, patch
import streamlit as st
from app.auth.token_handler import token_handler_page


@pytest.fixture
def mock_session_state():
    with patch("streamlit.session_state", new={}) as mock_state:
        yield mock_state


@pytest.fixture
def mock_st():
    with patch("app.auth.token_handler.st") as mock_st:
        mock_st.experimental_get_query_params.return_value = {}
        mock_st.error = MagicMock()
        mock_st.success = MagicMock()
        mock_st.info = MagicMock()
        mock_st.text_input = MagicMock(return_value="")
        mock_st.button = MagicMock(return_value=False)
        yield mock_st


@pytest.fixture
def mock_requests():
    with patch("app.auth.token_handler.requests") as mock_requests:
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "mock_access_token",
            "id_token": "mock_id_token",
            "refresh_token": "mock_refresh_token",
        }
        mock_response.status_code = 200
        mock_requests.post.return_value = mock_response
        yield mock_requests


@pytest.fixture
def mock_config():
    with patch("app.auth.token_handler.Config") as mock_config:
        mock_config.TOKEN_ENDPOINT = "https://mock-token-endpoint.com"
        mock_config.CLIENT_ID = "mock_client_id"
        mock_config.CLIENT_SECRET = "mock_client_secret"
        mock_config.REDIRECT_URI = "https://mock-redirect-uri.com"
        yield mock_config


def test_token_handler_page_no_code(mock_session_state, mock_st, mock_requests):
    """Test that the token handler page shows an appropriate message when no code is provided."""
    # Setup
    mock_st.experimental_get_query_params.return_value = {}
    
    # Execute
    token_handler_page()
    
    # Assert
    mock_st.info.assert_called_once()
    assert "No authentication code" in mock_st.info.call_args[0][0]
    assert not mock_st.error.called
    assert not mock_st.success.called


def test_manual_code_entry_ui(mock_session_state, mock_st, mock_requests, mock_config):
    """Test that the manual code entry UI is displayed and functions correctly."""
    # Setup
    mock_st.experimental_get_query_params.return_value = {}
    mock_st.text_input.return_value = "test_code"
    mock_st.button.return_value = True
    mock_st.rerun = MagicMock()
    mock_st.query_params = MagicMock()
    mock_st.query_params.update = MagicMock()
    
    # Execute
    token_handler_page()
    
    # Assert
    assert mock_st.text_input.call_count == 2  # Two text inputs: one for code, one for state
    assert mock_st.text_input.call_args_list[0][0][0] == 'Enter code from URL:'
    assert mock_st.text_input.call_args_list[1][0][0] == 'Enter state from URL:'
    mock_st.button.assert_called_once()
    
    # When button is clicked, it should update query params and trigger a rerun
    mock_st.query_params.update.assert_called_once()
    mock_st.rerun.assert_called_once() 