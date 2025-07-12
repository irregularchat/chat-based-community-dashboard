import streamlit as st
from app.utils.config import Config
from app.auth.authentication import is_authenticated, get_current_user, get_login_url, get_logout_url, logout
import logging
from app.auth.local_auth import display_local_login_form

def display_useful_links():
    """Display the Useful Links section in the sidebar with improved styling."""
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
        # Simplified sidebar login - main login forms are now in render_sidebar()
        st.sidebar.markdown("### Login Options")
        
        # SSO login button
        st.sidebar.markdown(f"""
        <div style="margin-bottom: 10px;">
            <a href="{login_url}" 
               style="display: block; 
                      text-align: center; 
                      background-color: #4285f4; 
                      color: white; 
                      padding: 8px 12px; 
                      border-radius: 4px; 
                      text-decoration: none; 
                      font-weight: bold;">
                🔐 Login with SSO
            </a>
        </div>
        """, unsafe_allow_html=True)
        
        # Local admin login form
        st.sidebar.markdown("**Local Admin Login**")
        with st.sidebar.form("simple_local_login_form", clear_on_submit=True):
            username = st.text_input("Username", placeholder="Enter username")
            password = st.text_input("Password", type="password", placeholder="Enter password")
            
            if st.form_submit_button("Login", use_container_width=True):
                if username and password:
                    from app.auth.local_auth import handle_local_login
                    if handle_local_login(username, password):
                        st.success("✅ Login successful!")
                        st.rerun()
                    else:
                        st.error("❌ Invalid credentials")
                else:
                    st.warning("⚠️ Please enter both username and password")

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
            <div class="login-container" style="text-align: center; margin: 20px 0;">
                <a href="{login_url}" 
                   style="display: inline-block; 
                          background-color: #4285f4; 
                          color: white; 
                          padding: 12px 30px; 
                          border-radius: 5px; 
                          text-decoration: none; 
                          font-weight: bold; 
                          font-size: 16px;">
                    🔐 Login with Authentik
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