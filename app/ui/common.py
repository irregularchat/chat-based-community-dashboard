import streamlit as st
from app.utils.config import Config
from app.auth.authentication import is_authenticated, get_current_user, get_login_url, get_logout_url, logout
import logging
from app.auth.local_auth import display_local_login_form

def display_useful_links():
    """Display the Useful Links section in the sidebar with improved styling."""
    # Display login/logout button
    if is_authenticated():
        user_info = get_current_user()
        
        # Handle both SSO and local admin users with better styling
        if st.session_state.get('auth_method') == 'local':
            username = user_info.get('preferred_username', 'Local Admin')
            st.sidebar.markdown(f"""
            <div class="user-info">
                <p><strong>Logged in as:</strong> {username}</p>
                <p><span style="background-color: #4CAF50; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px;">Local Admin</span></p>
            </div>
            """, unsafe_allow_html=True)
        else:
            username = user_info.get('preferred_username', 'User')
            is_admin = st.session_state.get('is_admin', False)
            admin_badge = '<span style="background-color: #4CAF50; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-left: 5px;">Admin</span>' if is_admin else ''
            
            st.sidebar.markdown(f"""
            <div class="user-info">
                <p><strong>Logged in as:</strong> {username} {admin_badge}</p>
            </div>
            """, unsafe_allow_html=True)
        
        # Styled logout button
        if st.sidebar.button("Logout", key="logout_button", use_container_width=True):
            logout()
            
            # For SSO users, redirect to logout URL
            if st.session_state.get('auth_method') != 'local':
                logout_url = get_logout_url()
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{logout_url}\'">', unsafe_allow_html=True)
            
            st.rerun()
    else:
        # Create columns for SSO and local login buttons with better styling
        col1, col2 = st.sidebar.columns(2)
        
        with col1:
            login_url = get_login_url()
            st.markdown(f"""
            <a href="{login_url}" class="login-button" style="display:block; text-align:center; width:100%;">
                SSO Login
            </a>
            """, unsafe_allow_html=True)
        
        with col2:
            # Initialize this state variable before button creation
            if 'show_local_login' not in st.session_state:
                st.session_state['show_local_login'] = False
                
            # Use a different key to avoid the state modification error
            if st.button("Local Admin", key="local_admin_login_btn"):
                st.session_state['show_local_login'] = True
                st.rerun()
    
    # Show local login form if requested with better styling
    if st.session_state.get('show_local_login', False) and not is_authenticated():
        with st.sidebar.expander("Local Admin Login", expanded=True):
            # Initialize cancel_clicked state before we create the button
            if 'cancel_clicked' not in st.session_state:
                st.session_state['cancel_clicked'] = False
                
            # Display the login form - no need to call st.rerun() anymore as the function handles redirect
            display_local_login_form()
            
            # Use a different key for the cancel button to avoid state conflict
            if st.button("Cancel", key="cancel_local_login_btn", use_container_width=True):
                st.session_state['show_local_login'] = False
                st.rerun()
    
    # Styled useful links section
    st.sidebar.markdown("""
        <div class="card" style="margin-top: 20px;">
            <h3 style="margin-top: 0;">Useful Links</h3>
            <ul style="padding-left: 20px; margin-bottom: 0;">
                <li><a href="https://sso.irregularchat.com" target="_blank">Login to IrregularChat SSO</a></li>
                <li><a href="https://irregularpedia.org/index.php/Signal_Welcome_Prompts" target="_blank">Signal CopyPasta for Welcome Messages</a></li>
                <li><a href="https://irregularpedia.org/index.php/Admin" target="_blank">Admin Prompts for Common Situations</a></li>
                <li><a href="https://irregularpedia.org/index.php/Links" target="_blank">Links to Community Chats and Services</a></li>
            </ul>
        </div>
    """, unsafe_allow_html=True) 

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
            # SSO login button with enhanced styling
            st.markdown(f"""
            <a href="{login_url}" class="login-button" style="display:block; text-align:center; width:100%;">
                Login with SSO
            </a>
            """, unsafe_allow_html=True)
        
        with col2:
            # Initialize this state variable before button creation
            if 'show_local_login' not in st.session_state:
                st.session_state['show_local_login'] = False
                
            # Local login toggle - use a unique key with styled button
            if st.button("Local Admin", key="show_local_login_btn", 
                        help="Login with local administrator credentials"):
                st.session_state['show_local_login'] = True
                st.rerun()
        
        # Display local login form if requested
        if st.session_state.get('show_local_login', False):
            with st.sidebar.expander("**LOCAL ADMIN LOGIN**", expanded=True):
                st.write("Use local admin credentials from .env file:")
                # Display the login form - it now handles redirection internally
                display_local_login_form()
                
                # Use a different key for the cancel button
                if st.button("Cancel", key="cancel_login_form_btn"):
                    st.session_state['show_local_login'] = False
                    st.rerun()

        # Alternative login options in an expander
        with st.sidebar.expander("Having issues? Try alternative login methods"):
            st.markdown("If you're experiencing blank pages with the standard login, try one of these:")
            
            # Create a more mobile-friendly layout with two columns
            alt_col1, alt_col2 = st.columns(2)
            
            with alt_col1:
                if st.button("HTML-Only Login", key="html_login_sidebar"):
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=html_login\'">', unsafe_allow_html=True)
                
                if st.button("Alternative Login", key="alt_login_sidebar"):
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=alt_login\'">', unsafe_allow_html=True)
            
            with alt_col2:
                if st.button("Token Handler", key="token_handler_sidebar"):
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=token\'">', unsafe_allow_html=True)
                
                if st.button("OIDC Diagnostics", key="oidc_debug_sidebar"):
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=oidc_debug\'">', unsafe_allow_html=True)
                
            st.markdown("---")
            st.warning("Authentication Error Detected!")
            st.error("Client authentication failed with Authentik")
            
            # Full-width buttons for error resolution
            if st.button("Fix Authentication", key="fix_auth_sidebar", use_container_width=True):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_config\'">', unsafe_allow_html=True)
                
            st.markdown("---")
            st.warning("Redirect URI Mismatch Detected!")
            
            if st.button("Fix Configuration", key="fix_config_sidebar", use_container_width=True):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=update_config\'">', unsafe_allow_html=True)
                
            if st.button("Debug Login", key="debug_login_sidebar", use_container_width=True):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_debug\'">', unsafe_allow_html=True)
    else:
        # Login options in the main content area with enhanced styling
        st.markdown("""
        <div class="card">
            <h3 style="margin-top:0;">Login to Access Dashboard</h3>
            <p>Please choose one of the following login methods:</p>
        </div>
        """, unsafe_allow_html=True)
        
        # Create tabs for different login methods
        sso_tab, local_tab = st.tabs(["Login with SSO", "Local Admin Login"])
        
        with sso_tab:
            st.markdown("""
            <div style="text-align: center; margin: 20px 0;">
                <p>Use your community SSO credentials to login:</p>
            </div>
            """, unsafe_allow_html=True)
            
            # Centered login button with enhanced styling
            st.markdown(f"""
            <div class="login-container">
                <a href="{login_url}" class="login-button" style="padding: 12px 30px; font-size: 16px;">
                    Login with Authentik
                </a>
            </div>
            """, unsafe_allow_html=True)
                
        with local_tab:
            st.markdown("""
            <div style="text-align: center; margin: 10px 0;">
                <p>For administrators with local access credentials:</p>
            </div>
            """, unsafe_allow_html=True)
            
            # Display the login form directly - it now handles redirection internally
            display_local_login_form()
        
        # Alternative login methods in an expander with better styling
        with st.expander("Having trouble with login?"):
            st.markdown("""
            <div class="alert alert-info">
                If you see a blank white page after login, try one of these alternative methods:
            </div>
            """, unsafe_allow_html=True)
            
            login_method = st.radio(
                "Choose alternative login method:",
                ["HTML-Only Login", "Manual Token Handler", "Debug Login"],
                index=0
            )
            
            # Full-width button for better mobile experience
            if st.button("Login with Selected Method", key="alt_login", use_container_width=True):
                if login_method == "HTML-Only Login":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=html_login\'">', unsafe_allow_html=True)
                elif login_method == "Manual Token Handler":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=token\'">', unsafe_allow_html=True)
                elif login_method == "Debug Login":
                    st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=auth_debug\'">', unsafe_allow_html=True)