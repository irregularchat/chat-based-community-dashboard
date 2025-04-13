import streamlit as st
from app.utils.config import Config
from app.auth.authentication import is_authenticated, get_current_user, get_login_url, get_logout_url, logout
import logging
from app.auth.local_auth import display_local_login_form

def display_useful_links():
    """Display the Useful Links section in the sidebar."""
    # Display login/logout button
    if is_authenticated():
        user_info = get_current_user()
        
        # Handle both SSO and local admin users
        if st.session_state.get('auth_method') == 'local':
            username = user_info.get('preferred_username', 'Local Admin')
            st.sidebar.success(f"Logged in as: {username} (Local Admin)")
        else:
            username = user_info.get('preferred_username', 'User')
            st.sidebar.success(f"Logged in as: {username}")
        
        if st.sidebar.button("Logout"):
            logout()
            
            # For SSO users, redirect to logout URL
            if st.session_state.get('auth_method') != 'local':
                logout_url = get_logout_url()
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{logout_url}\'">', unsafe_allow_html=True)
            
            st.rerun()
    else:
        # Create columns for SSO and local login buttons
        col1, col2 = st.sidebar.columns(2)
        
        with col1:
            login_url = get_login_url()
            st.markdown(f"<a href='{login_url}' class='login-button'>SSO Login</a>", unsafe_allow_html=True)
        
        with col2:
            if st.button("Local Admin", key="local_admin_sidebar"):
                st.session_state['show_local_login'] = True
                st.rerun()
    
    # Show local login form if requested
    if st.session_state.get('show_local_login', False) and not is_authenticated():
        with st.sidebar.expander("Local Admin Login", expanded=True):
            if display_local_login_form():
                st.session_state['show_local_login'] = False
                st.rerun()
            
            if st.button("Cancel"):
                st.session_state['show_local_login'] = False
                st.rerun()
    
    st.sidebar.markdown("""
        ## Useful Links:
        - [Login to IrregularChat SSO](https://sso.irregularchat.com)
        - [Use Signal CopyPasta for Welcome Messages](https://irregularpedia.org/index.php/Signal_Welcome_Prompts)
        - [Admin Prompts for Common Situations](https://irregularpedia.org/index.php/Admin)
        - [Links to Community Chats and Services](https://irregularpedia.org/index.php/Links)
    """) 

def display_login_button(location="sidebar"):
    """
    Display a login button that redirects to the authentication server
    
    Args:
        location (str): Where to display the button ('sidebar' or 'main')
    """
    from app.auth.authentication import get_login_url
    
    logging.info("Using Direct OIDC for authentication")
    login_url = get_login_url()
    
    # Create login buttons for multiple auth options
    if location == "sidebar":
        st.sidebar.markdown("### Login Options")
        
        # Create columns for the two main login options
        col1, col2 = st.sidebar.columns(2)
        
        with col1:
            # SSO login button
            st.button("Login with SSO", key="sso_login_sidebar", on_click=lambda: st.markdown(
                f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True))
        
        with col2:
            # Local login toggle
            if st.button("Local Admin Login", key="show_local_login"):
                st.session_state['show_local_login'] = True
                st.rerun()
        
        # Display local login form if requested
        if st.session_state.get('show_local_login', False):
            with st.sidebar.expander("**LOCAL ADMIN LOGIN**", expanded=True):
                st.write("Use local admin credentials from .env file:")
                if display_local_login_form():
                    st.session_state['show_local_login'] = False
                    st.rerun()
                
                if st.button("Cancel", key="cancel_local_login"):
                    st.session_state['show_local_login'] = False
                    st.rerun()
        
        # Alternative login options in an expander
        with st.sidebar.expander("Having issues? Try alternative login methods"):
            st.markdown("If you're experiencing blank pages with the standard login, try one of these:")
            
            if st.button("HTML-Only Login", key="html_login_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=html_login\'">', unsafe_allow_html=True)
                
            if st.button("Manual Token Handler", key="token_handler_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=token\'">', unsafe_allow_html=True)
                
            if st.button("Alternative Login Flow", key="alt_login_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=alt_login\'">', unsafe_allow_html=True)
            
            if st.button("OIDC Diagnostics", key="oidc_debug_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=oidc_debug\'">', unsafe_allow_html=True)
                
            st.markdown("---")
            st.warning("Authentication Error Detected!")
            st.error("Client authentication failed with Authentik")
            if st.button("Fix Authentication", key="fix_auth_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_config\'">', unsafe_allow_html=True)
                
            st.markdown("---")
            st.warning("Redirect URI Mismatch Detected!")
            if st.button("Fix Configuration", key="fix_config_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=update_config\'">', unsafe_allow_html=True)
                
            if st.button("Debug Login", key="debug_login_sidebar"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_debug\'">', unsafe_allow_html=True)
    else:
        # Login options in the main content area
        st.markdown("### Login to Access Dashboard")
        
        # Create tabs for different login methods
        sso_tab, local_tab = st.tabs(["Login with SSO", "Local Admin Login"])
        
        with sso_tab:
            st.markdown("""
            <div style="text-align: center; margin: 20px 0;">
                <p>Use your community SSO credentials to login:</p>
            </div>
            """, unsafe_allow_html=True)
            
            if st.button("Login with Authentik", key="main_login", use_container_width=True):
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
                
        with local_tab:
            st.markdown("""
            <div style="text-align: center; margin: 10px 0;">
                <p>For administrators with local access credentials:</p>
            </div>
            """, unsafe_allow_html=True)
            
            display_local_login_form()
        
        # Alternative login methods in an expander
        with st.expander("Having trouble with login?"):
            st.markdown("If you see a blank white page after login, try one of these alternative methods:")
            
            login_method = st.radio(
                "Choose alternative login method:",
                ["HTML-Only Login", "Manual Token Handler", "Debug Login"],
                index=0
            )
            
            if st.button("Login with Selected Method", key="alt_login"):
                if login_method == "HTML-Only Login":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=html_login\'">', unsafe_allow_html=True)
                elif login_method == "Manual Token Handler":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=token\'">', unsafe_allow_html=True)
                elif login_method == "Debug Login":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_debug\'">', unsafe_allow_html=True)