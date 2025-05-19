import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.authentication import handle_auth_callback

def test_token_exchange_error_shown(monkeypatch):
    """Test that token exchange errors are shown to the user."""
    st.session_state.clear()
    st.session_state['auth_state'] = 'test_state'
    # Simulate failed token response
    class FakeResponse:
        status_code = 400
        def json(self):
            return {'error': 'invalid_grant', 'error_description': 'Invalid redirect URI'}
        text = 'invalid_grant: Invalid redirect URI'
    monkeypatch.setattr('requests.post', lambda *a, **k: FakeResponse())
    # Should return False and show error
    with patch('streamlit.error') as mock_error:
        result = handle_auth_callback('code', 'test_state')
        assert result is False
        mock_error.assert_any_call("OIDC token exchange failed with method 'post': Invalid redirect URI")

def test_userinfo_error_shown(monkeypatch):
    """Test that userinfo errors are shown to the user."""
    st.session_state.clear()
    st.session_state['auth_state'] = 'test_state'
    # Simulate successful token, failed userinfo
    class FakeToken:
        status_code = 200
        def json(self):
            return {'access_token': 'tok'}
    class FakeUserinfo:
        status_code = 400
        def json(self):
            return {'error': 'bad_user', 'error_description': 'Userinfo failed'}
        text = 'bad_user: Userinfo failed'
    monkeypatch.setattr('requests.post', lambda *a, **k: FakeToken())
    monkeypatch.setattr('requests.get', lambda *a, **k: FakeUserinfo())
    with patch('streamlit.error') as mock_error:
        result = handle_auth_callback('code', 'test_state')
        assert result is False
        mock_error.assert_any_call('Failed to fetch user info: Userinfo failed')

def test_state_error_shown():
    """Test that state validation errors are shown to the user."""
    st.session_state.clear()
    st.session_state['auth_state'] = 'expected_state'
    with patch('streamlit.error') as mock_error:
        result = handle_auth_callback('code', 'wrong_state')
        assert result is False
        mock_error.assert_any_call('Invalid state parameter in authentication callback. Received: wrong_state, Expected: expected_state')
