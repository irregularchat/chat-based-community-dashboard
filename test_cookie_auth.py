#!/usr/bin/env python3
"""
Test script for cookie-based authentication system.

This script provides a comprehensive testing interface for the cookie authentication
functionality, including real-time monitoring and debugging tools.
"""

import streamlit as st

# MUST be first Streamlit command
st.set_page_config(
    page_title="Cookie Authentication Test",
    page_icon="🍪",
    layout="wide"
)

import json
import time
from datetime import datetime, timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import our cookie auth functions with error handling
cookie_auth_available = False
try:
    from app.auth.cookie_auth import (
        store_auth_in_cookies, 
        retrieve_auth_from_cookies, 
        clear_auth_cookies,
        restore_session_from_cookies,
        check_and_refresh_cookies,
        hide_cookie_component,
        reset_cookie_controller
    )
    cookie_auth_available = True
except ImportError as e:
    logger.error(f"Failed to import cookie authentication module: {e}")

def main():
    """Main test interface"""
    
    # Hide the cookie component UI
    if cookie_auth_available:
        try:
            hide_cookie_component()
        except Exception as e:
            logger.error(f"Error hiding cookie component: {e}")
    
    st.title("🍪 Cookie Authentication Test Suite")
    
    # Show import status
    if cookie_auth_available:
        st.success("✅ Cookie authentication module imported successfully")
    else:
        st.error("❌ Failed to import cookie authentication module")
        st.stop()
    
    st.markdown("This tool helps test and debug the cookie-based authentication system.")
    
    # Create columns for layout
    col1, col2 = st.columns([1, 1])
    
    with col1:
        st.header("🔧 Test Controls")
        
        # Test 1: Store auth data
        st.subheader("1. Store Authentication Data")
        with st.form("store_auth_form"):
            username = st.text_input("Username", value="testuser")
            is_admin = st.checkbox("Is Admin", value=True)
            is_moderator = st.checkbox("Is Moderator", value=False)
            auth_method = st.selectbox("Auth Method", ["local", "sso"], index=0)
            
            if st.form_submit_button("🔒 Store Auth Data"):
                try:
                    store_auth_in_cookies(username, is_admin, is_moderator, auth_method)
                    st.success(f"✅ Stored auth data for {username}")
                    st.rerun()
                except Exception as e:
                    st.error(f"❌ Error storing auth data: {e}")
                    logger.error(f"Store auth error: {e}")
        
        # Test 2: Retrieve auth data
        st.subheader("2. Retrieve Authentication Data")
        if st.button("🔍 Retrieve Auth Data"):
            try:
                auth_data = retrieve_auth_from_cookies()
                if auth_data:
                    st.success("✅ Retrieved auth data from cookies")
                    st.json(auth_data)
                else:
                    st.warning("⚠️ No auth data found in cookies")
            except Exception as e:
                st.error(f"❌ Error retrieving auth data: {e}")
                logger.error(f"Retrieve auth error: {e}")
        
        # Test 3: Session management
        st.subheader("3. Session Management")
        col3, col4 = st.columns(2)
        
        with col3:
            if st.button("🔄 Restore Session"):
                try:
                    success = restore_session_from_cookies()
                    if success:
                        st.success("✅ Session restored from cookies")
                        st.rerun()
                    else:
                        st.warning("⚠️ No session data to restore")
                except Exception as e:
                    st.error(f"❌ Error restoring session: {e}")
                    logger.error(f"Restore session error: {e}")
        
        with col4:
            if st.button("🔄 Refresh Cookies"):
                try:
                    check_and_refresh_cookies()
                    st.success("✅ Cookies refreshed")
                except Exception as e:
                    st.error(f"❌ Error refreshing cookies: {e}")
                    logger.error(f"Refresh cookies error: {e}")
        
        # Test 4: Clear data
        st.subheader("4. Clear Authentication Data")
        col5, col6 = st.columns(2)
        
        with col5:
            if st.button("🗑️ Clear Cookies"):
                try:
                    clear_auth_cookies()
                    st.success("✅ Cookies cleared")
                    st.rerun()
                except Exception as e:
                    st.error(f"❌ Error clearing cookies: {e}")
                    logger.error(f"Clear cookies error: {e}")
        
        with col6:
            if st.button("🔄 Reset Controller"):
                try:
                    reset_cookie_controller()
                    st.success("✅ Cookie controller reset")
                    st.rerun()
                except Exception as e:
                    st.error(f"❌ Error resetting controller: {e}")
                    logger.error(f"Reset controller error: {e}")
        
        # Test 5: Complete logout
        st.subheader("5. Complete Logout Test")
        if st.button("🚪 Logout (Clear All)"):
            try:
                # Clear session state
                auth_keys = [
                    'is_authenticated', 'username', 'user_info', 'auth_method', 'auth_timestamp',
                    'is_admin', 'is_moderator', 'permanent_auth', 'permanent_admin', 
                    'permanent_moderator', 'permanent_username', 'permanent_auth_method'
                ]
                
                for key in auth_keys:
                    if key in st.session_state:
                        del st.session_state[key]
                
                # Clear cookies
                clear_auth_cookies()
                
                st.success("✅ Complete logout successful")
                st.rerun()
            except Exception as e:
                st.error(f"❌ Error during logout: {e}")
                logger.error(f"Logout error: {e}")
    
    with col2:
        st.header("📊 Current State")
        
        # Display session state
        st.subheader("Session State")
        auth_session_state = {
            k: v for k, v in st.session_state.items() 
            if any(keyword in k.lower() for keyword in ['auth', 'admin', 'user', 'permanent'])
        }
        
        if auth_session_state:
            st.json(auth_session_state)
        else:
            st.info("No authentication-related session state found")
        
        # Display cookie data
        st.subheader("Cookie Data")
        try:
            cookie_data = retrieve_auth_from_cookies()
            if cookie_data:
                st.json(cookie_data)
                
                # Show expiry information
                expires_at = datetime.fromisoformat(cookie_data['expires_at'])
                time_remaining = expires_at - datetime.now()
                
                if time_remaining.total_seconds() > 0:
                    st.success(f"⏰ Cookie expires in: {time_remaining}")
                else:
                    st.error("⏰ Cookie has expired")
            else:
                st.info("No cookie data found")
        except Exception as e:
            st.error(f"Error reading cookie data: {e}")
        
        # Real-time monitoring
        st.subheader("🔄 Real-time Monitoring")
        if st.checkbox("Enable Auto-refresh", value=False):
            time.sleep(1)
            st.rerun()
    
    # Testing instructions
    st.markdown("---")
    st.header("📋 Testing Instructions")
    
    with st.expander("Step-by-Step Testing Guide", expanded=False):
        st.markdown("""
        ### 🧪 How to Test Cookie Authentication
        
        1. **Store Authentication Data**:
           - Enter a username (e.g., "testuser")
           - Check admin/moderator privileges as needed
           - Select authentication method
           - Click "Store Auth Data"
        
        2. **Verify Storage**:
           - Click "Retrieve Auth Data" to see stored cookie data
           - Check the "Cookie Data" section on the right
        
        3. **Test Session Restoration**:
           - Click "Restore Session" to simulate page refresh
           - Check "Session State" section to see restored data
        
        4. **Test Page Refresh Persistence**:
           - After storing auth data, refresh the browser page (F5)
           - The auth data should persist and be visible
        
        5. **Test Cookie Refresh**:
           - Click "Refresh Cookies" to extend session
           - Check expiry time in "Cookie Data" section
        
        6. **Test Logout**:
           - Click "Logout (Clear All)" to clear everything
           - Verify both session state and cookies are cleared
        
        ### 🔧 Troubleshooting
        
        - **Widget Errors**: Click "Reset Controller" if you see widget key errors
        - **Cookie Issues**: Clear cookies and try again
        - **Session Issues**: Use "Restore Session" to rebuild session state
        
        ### 🎯 Expected Behavior
        
        - ✅ Auth data should persist across page refreshes
        - ✅ Session state should be restored from cookies
        - ✅ Logout should clear both session and cookies
        - ✅ Cookie expiry should be respected (24 hours)
        """)
    
    # Debug information
    with st.expander("🐛 Debug Information", expanded=False):
        st.subheader("All Session State")
        st.json(dict(st.session_state))
        
        st.subheader("Cookie Controller Status")
        try:
            from app.auth.cookie_auth import get_cookie_controller
            controller = get_cookie_controller()
            if controller:
                st.success("✅ Cookie controller is available")
            else:
                st.error("❌ Cookie controller is not available")
        except Exception as e:
            st.error(f"❌ Error checking cookie controller: {e}")

# Run the main function
if __name__ == "__main__":
    main()
else:
    # When imported by Streamlit, run main
    main() 