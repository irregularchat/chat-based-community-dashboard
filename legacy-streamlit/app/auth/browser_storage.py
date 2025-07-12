#!/usr/bin/env python3
"""
Browser storage utilities for persisting authentication state across page refreshes.

This module provides functions to store and retrieve authentication state
in the browser's localStorage, which persists across page refreshes and
browser sessions until explicitly cleared.
"""

import streamlit as st
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

def store_auth_state_in_browser(username: str, is_admin: bool, is_moderator: bool, auth_method: str):
    """
    Store authentication state in browser localStorage.
    
    Args:
        username: The authenticated username
        is_admin: Whether user has admin privileges
        is_moderator: Whether user has moderator privileges
        auth_method: The authentication method used ('local' or 'sso')
    """
    try:
        auth_data = {
            'username': username,
            'is_admin': is_admin,
            'is_moderator': is_moderator,
            'auth_method': auth_method,
            'timestamp': datetime.now().isoformat(),
            'expires_at': (datetime.now() + timedelta(hours=24)).isoformat()  # 24 hour expiry
        }
        
        # Use Streamlit's HTML component to store in localStorage
        st.components.v1.html(f"""
        <script>
            localStorage.setItem('community_dashboard_auth', '{json.dumps(auth_data)}');
            console.log('Stored auth state in localStorage:', {json.dumps(auth_data)});
        </script>
        """, height=0)
        
        logger.info(f"Stored auth state in browser localStorage for user: {username}")
        
    except Exception as e:
        logger.error(f"Error storing auth state in browser: {e}")

def retrieve_auth_state_from_browser() -> Optional[Dict[str, Any]]:
    """
    Retrieve authentication state from browser localStorage.
    
    Returns:
        Dict containing auth state if found and valid, None otherwise
    """
    try:
        # Use Streamlit's HTML component to retrieve from localStorage
        # This is a bit tricky since we can't directly get return values from HTML components
        # We'll use a different approach with session state as a bridge
        
        if 'browser_auth_checked' not in st.session_state:
            st.session_state['browser_auth_checked'] = False
            
            # Inject JavaScript to check localStorage and store result in a hidden element
            st.components.v1.html(f"""
            <script>
                const authData = localStorage.getItem('community_dashboard_auth');
                if (authData) {{
                    try {{
                        const parsed = JSON.parse(authData);
                        const expiresAt = new Date(parsed.expires_at);
                        const now = new Date();
                        
                        if (now < expiresAt) {{
                            // Store in a way that Streamlit can access
                            document.body.setAttribute('data-auth-state', authData);
                            console.log('Found valid auth state in localStorage:', parsed);
                        }} else {{
                            localStorage.removeItem('community_dashboard_auth');
                            console.log('Auth state expired, removed from localStorage');
                        }}
                    }} catch (e) {{
                        console.error('Error parsing auth state:', e);
                        localStorage.removeItem('community_dashboard_auth');
                    }}
                }} else {{
                    console.log('No auth state found in localStorage');
                }}
            </script>
            """, height=0)
            
            st.session_state['browser_auth_checked'] = True
            
        return None  # We'll handle this differently
        
    except Exception as e:
        logger.error(f"Error retrieving auth state from browser: {e}")
        return None

def clear_auth_state_from_browser():
    """
    Clear authentication state from browser localStorage.
    """
    try:
        st.components.v1.html("""
        <script>
            localStorage.removeItem('community_dashboard_auth');
            console.log('Cleared auth state from localStorage');
        </script>
        """, height=0)
        
        logger.info("Cleared auth state from browser localStorage")
        
    except Exception as e:
        logger.error(f"Error clearing auth state from browser: {e}")

def check_and_restore_browser_auth() -> bool:
    """
    Check browser localStorage for valid auth state and restore to session state.
    
    Returns:
        True if auth state was restored, False otherwise
    """
    try:
        # Use a simpler approach with query parameters as a bridge
        # We'll inject JavaScript that can modify the URL if auth state is found
        
        if 'browser_auth_restore_attempted' not in st.session_state:
            st.session_state['browser_auth_restore_attempted'] = True
            
            # Check if we have auth restoration query parameters
            query_params = st.query_params
            if 'browser_auth' in query_params:
                try:
                    auth_data_str = query_params.get('browser_auth')
                    auth_data = json.loads(auth_data_str)
                    
                    # Validate expiry
                    expires_at = datetime.fromisoformat(auth_data['expires_at'])
                    if datetime.now() < expires_at:
                        # Restore to session state
                        st.session_state['is_authenticated'] = True
                        st.session_state['username'] = auth_data['username']
                        st.session_state['is_admin'] = auth_data['is_admin']
                        st.session_state['is_moderator'] = auth_data['is_moderator']
                        st.session_state['auth_method'] = auth_data['auth_method']
                        st.session_state['permanent_auth'] = True
                        st.session_state['permanent_admin'] = auth_data['is_admin']
                        st.session_state['permanent_moderator'] = auth_data['is_moderator']
                        st.session_state['permanent_username'] = auth_data['username']
                        st.session_state['permanent_auth_method'] = auth_data['auth_method']
                        
                        # Create user_info
                        st.session_state['user_info'] = {
                            'preferred_username': auth_data['username'],
                            'name': auth_data['username'],
                            'email': '',
                            'is_local_admin': auth_data['auth_method'] == 'local'
                        }
                        
                        logger.info(f"Restored auth state from browser for user: {auth_data['username']}")
                        
                        # Clear the query parameter
                        clean_params = {k: v for k, v in query_params.items() if k != 'browser_auth'}
                        st.query_params.update(clean_params)
                        
                        return True
                    else:
                        logger.info("Browser auth state expired")
                        
                except Exception as e:
                    logger.error(f"Error parsing browser auth data: {e}")
            
            # If no query params, inject JavaScript to check localStorage
            st.components.v1.html("""
            <script>
                const authData = localStorage.getItem('community_dashboard_auth');
                if (authData) {
                    try {
                        const parsed = JSON.parse(authData);
                        const expiresAt = new Date(parsed.expires_at);
                        const now = new Date();
                        
                        if (now < expiresAt) {
                            // Redirect with auth data in query params
                            const currentUrl = new URL(window.location);
                            currentUrl.searchParams.set('browser_auth', authData);
                            window.location.href = currentUrl.toString();
                        } else {
                            localStorage.removeItem('community_dashboard_auth');
                            console.log('Auth state expired, removed from localStorage');
                        }
                    } catch (e) {
                        console.error('Error parsing auth state:', e);
                        localStorage.removeItem('community_dashboard_auth');
                    }
                }
            </script>
            """, height=0)
        
        return False
        
    except Exception as e:
        logger.error(f"Error checking browser auth state: {e}")
        return False 