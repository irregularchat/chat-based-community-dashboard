#!/usr/bin/env python3
"""
Test script to verify browser storage functionality for session persistence.

This script tests that authentication state is properly stored in and retrieved
from browser localStorage to persist across page refreshes.
"""

import streamlit as st
import sys
import os
import time
import json
from datetime import datetime

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '.'))

def main():
    """Test browser storage functionality"""
    st.set_page_config(
        page_title="Browser Storage Test",
        page_icon="💾",
        layout="wide"
    )
    
    st.title("💾 Browser Storage Session Persistence Test")
    
    st.markdown("""
    ## Browser Storage Testing
    
    This page tests the new browser localStorage functionality that ensures login state 
    persists across page refreshes even when Streamlit session state is completely cleared.
    
    ### ✅ New Implementation:
    
    1. **Browser localStorage Storage**: Auth state stored in browser's localStorage with 24-hour expiry
    2. **Automatic Restoration**: On page load, check localStorage and restore session state
    3. **Query Parameter Bridge**: Use URL query parameters to transfer auth data from localStorage to session state
    4. **Clean Logout**: Clear both session state and localStorage on logout
    
    ### 🧪 Test Instructions:
    
    1. **Login Test**: Use the sidebar login forms to authenticate
    2. **Browser Storage Test**: Check that auth state is stored in localStorage
    3. **Refresh Test**: Refresh the page (F5 or Ctrl+R) multiple times
    4. **Verify Persistence**: Check that you remain logged in after refresh
    5. **Logout Test**: Use logout and verify localStorage is cleared
    """)
    
    # Import the browser storage functions
    from app.auth.browser_storage import (
        store_auth_state_in_browser, 
        check_and_restore_browser_auth,
        clear_auth_state_from_browser
    )
    from app.main import initialize_session_state, render_sidebar
    
    # Show current authentication status
    st.subheader("🔍 Current Authentication Status")
    
    is_authenticated = st.session_state.get('is_authenticated', False)
    is_admin = st.session_state.get('is_admin', False)
    is_moderator = st.session_state.get('is_moderator', False)
    username = st.session_state.get('username', '')
    auth_method = st.session_state.get('auth_method', '')
    
    # Create status display
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Authentication State:**")
        if is_authenticated:
            st.success("✅ Authenticated")
            st.info(f"**Username**: {username}")
            st.info(f"**Auth Method**: {auth_method}")
            if is_admin:
                st.info("🔑 **Admin Privileges**: Yes")
            if is_moderator:
                st.info("🛡️ **Moderator Privileges**: Yes")
        else:
            st.warning("⚠️ Not Authenticated")
            st.info("👈 Use the sidebar login forms to authenticate")
    
    with col2:
        st.markdown("**Session State Flags:**")
        permanent_auth = st.session_state.get('permanent_auth', False)
        permanent_admin = st.session_state.get('permanent_admin', False)
        permanent_moderator = st.session_state.get('permanent_moderator', False)
        permanent_username = st.session_state.get('permanent_username', '')
        permanent_auth_method = st.session_state.get('permanent_auth_method', '')
        
        st.write(f"**permanent_auth**: {permanent_auth}")
        st.write(f"**permanent_admin**: {permanent_admin}")
        st.write(f"**permanent_moderator**: {permanent_moderator}")
        st.write(f"**permanent_username**: {permanent_username}")
        st.write(f"**permanent_auth_method**: {permanent_auth_method}")
    
    # Browser storage test section
    st.subheader("💾 Browser Storage Test")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        if st.button("🔄 Test Browser Auth Restore"):
            st.info("Testing browser auth restoration...")
            
            # Clear session state first
            auth_keys = ['is_authenticated', 'is_admin', 'is_moderator', 'username', 'auth_method']
            for key in auth_keys:
                if key in st.session_state:
                    del st.session_state[key]
            
            # Try to restore from browser
            restored = check_and_restore_browser_auth()
            
            if restored:
                st.success("✅ Successfully restored auth state from browser!")
            else:
                st.warning("⚠️ No auth state found in browser storage")
    
    with col2:
        if st.button("💾 Store Test Auth State"):
            st.info("Storing test auth state in browser...")
            store_auth_state_in_browser("test_user", True, False, "test")
            st.success("✅ Test auth state stored in browser localStorage")
    
    with col3:
        if st.button("🗑️ Clear Browser Storage"):
            st.info("Clearing browser localStorage...")
            clear_auth_state_from_browser()
            st.success("✅ Browser localStorage cleared")
    
    # JavaScript to check localStorage directly
    st.subheader("🔍 Browser localStorage Inspector")
    
    # Add JavaScript to display localStorage contents
    st.components.v1.html("""
    <div id="localStorage-display" style="background-color: #f0f2f6; padding: 15px; border-radius: 5px; margin: 10px 0;">
        <h4>Browser localStorage Contents:</h4>
        <div id="auth-data" style="font-family: monospace; background-color: white; padding: 10px; border-radius: 3px;">
            Loading...
        </div>
        <button onclick="refreshLocalStorage()" style="margin-top: 10px; padding: 5px 10px; background-color: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">
            🔄 Refresh
        </button>
        <button onclick="clearLocalStorage()" style="margin-top: 10px; margin-left: 10px; padding: 5px 10px; background-color: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;">
            🗑️ Clear
        </button>
    </div>
    
    <script>
        function refreshLocalStorage() {
            const authData = localStorage.getItem('community_dashboard_auth');
            const display = document.getElementById('auth-data');
            
            if (authData) {
                try {
                    const parsed = JSON.parse(authData);
                    const expiresAt = new Date(parsed.expires_at);
                    const now = new Date();
                    const isExpired = now >= expiresAt;
                    
                    display.innerHTML = `
                        <strong>Auth Data Found:</strong><br>
                        Username: ${parsed.username}<br>
                        Is Admin: ${parsed.is_admin}<br>
                        Is Moderator: ${parsed.is_moderator}<br>
                        Auth Method: ${parsed.auth_method}<br>
                        Timestamp: ${parsed.timestamp}<br>
                        Expires At: ${parsed.expires_at}<br>
                        <span style="color: ${isExpired ? 'red' : 'green'};">
                            Status: ${isExpired ? 'EXPIRED' : 'VALID'}
                        </span>
                    `;
                } catch (e) {
                    display.innerHTML = `<span style="color: red;">Error parsing auth data: ${e.message}</span>`;
                }
            } else {
                display.innerHTML = '<span style="color: gray;">No auth data found in localStorage</span>';
            }
        }
        
        function clearLocalStorage() {
            localStorage.removeItem('community_dashboard_auth');
            refreshLocalStorage();
        }
        
        // Initial load
        refreshLocalStorage();
        
        // Auto-refresh every 5 seconds
        setInterval(refreshLocalStorage, 5000);
    </script>
    """, height=200)
    
    # Refresh test
    st.subheader("🔄 Page Refresh Test")
    
    st.markdown("""
    **Instructions for testing browser storage persistence:**
    
    1. **If not logged in**: Use the sidebar forms to login first
    2. **Check localStorage**: Verify auth data appears in the inspector above
    3. **Refresh test**: Press F5 or Ctrl+R to refresh the page
    4. **Expected result**: You should remain logged in after refresh
    5. **Multiple refreshes**: Try refreshing several times in a row
    6. **Check logs**: Look for "Authentication state restored from browser localStorage" messages
    """)
    
    # Add refresh button for convenience
    if st.button("🔄 Simulate Page Refresh"):
        st.rerun()
    
    # Render the sidebar with login functionality
    selected_page = render_sidebar()
    
    st.markdown("---")
    st.markdown(f"**Current Page**: {selected_page}")
    
    # Session state debugging
    with st.expander("🔍 Full Session State (for debugging)"):
        # Filter out sensitive information
        safe_session_state = {
            k: v for k, v in st.session_state.items() 
            if k not in ['password', '_secrets'] and 'token' not in k.lower()
        }
        st.json(safe_session_state)
    
    # Test logout functionality
    if is_authenticated:
        st.subheader("🚪 Logout Test")
        st.markdown("Test that logout properly clears both session state and browser localStorage:")
        
        if st.button("🚪 Test Logout"):
            from app.auth.authentication import logout
            logout()
            st.success("Logout function called - page will refresh")
            time.sleep(1)
            st.rerun()

if __name__ == "__main__":
    main() 