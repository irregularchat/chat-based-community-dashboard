#!/usr/bin/env python3
"""
Test script to verify session persistence functionality.

This script tests that login state is preserved across page refreshes
and that the permanent session flags work correctly.
"""

import streamlit as st
import sys
import os
import time

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '.'))

def main():
    """Test session persistence functionality"""
    st.set_page_config(
        page_title="Session Persistence Test",
        page_icon="🔄",
        layout="wide"
    )
    
    st.title("🔄 Session Persistence Test")
    
    st.markdown("""
    ## Session Persistence Testing
    
    This page tests the improved session handling that prevents login state loss on page refresh.
    
    ### ✅ Improvements Made:
    
    1. **Smart Session Initialization**: `initialize_session_state()` now checks for permanent flags before resetting auth state
    2. **Enhanced Persistence Flags**: Added `permanent_username` and `permanent_auth_method` for better restoration
    3. **Robust Session Restoration**: Improved logic in `main()` to restore all session variables
    4. **Clean Logout**: Updated logout to clear all permanent session variables
    
    ### 🧪 Test Instructions:
    
    1. **Login Test**: Use the sidebar login forms to authenticate
    2. **Refresh Test**: After successful login, refresh the page (F5 or Ctrl+R)
    3. **Verify Persistence**: Check that you remain logged in after refresh
    4. **Logout Test**: Use the logout button and verify clean logout
    """)
    
    # Import and test the updated functionality
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
        st.markdown("**Persistence Flags:**")
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
    
    # Test session initialization
    st.subheader("🔧 Session Initialization Test")
    
    if st.button("Test Session Initialization"):
        st.info("Testing initialize_session_state() function...")
        
        # Store current state
        current_auth = st.session_state.get('is_authenticated', False)
        current_permanent = st.session_state.get('permanent_auth', False)
        
        # Call initialize_session_state
        initialize_session_state()
        
        # Check results
        new_auth = st.session_state.get('is_authenticated', False)
        
        if current_permanent and current_auth == new_auth:
            st.success("✅ Session initialization preserved authentication state!")
        elif not current_permanent:
            st.info("ℹ️ No permanent flags - initialization reset state as expected")
        else:
            st.error("❌ Session initialization failed to preserve state")
    
    # Refresh test
    st.subheader("🔄 Page Refresh Test")
    
    st.markdown("""
    **Instructions for manual testing:**
    
    1. **If not logged in**: Use the sidebar forms to login first
    2. **If logged in**: Press F5 or Ctrl+R to refresh the page
    3. **Expected result**: You should remain logged in after refresh
    4. **Check the logs**: Look for "Restored authentication state" messages
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
        st.markdown("Test that logout properly clears all session state:")
        
        if st.button("🚪 Test Logout"):
            from app.auth.authentication import logout
            logout()
            st.success("Logout function called - page will refresh")
            time.sleep(1)
            st.rerun()

if __name__ == "__main__":
    main() 