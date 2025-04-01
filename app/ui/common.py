import streamlit as st
from app.utils.config import Config
from app.auth.authentication import is_authenticated, get_current_user, get_login_url, get_logout_url, logout

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
            from app.auth.local_auth import display_local_login_form
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

def display_login_button(redirect_path=None):
    """
    Display login buttons for both SSO and local authentication.
    
    Args:
        redirect_path (str, optional): Path to redirect to after login
    """
    login_url = get_login_url(redirect_path)
    
    # Create columns for SSO and local login buttons
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown(
            f"""
            <div class="login-container">
                <a href="{login_url}" class="login-button">
                    Login with Authentik
                </a>
            </div>
            """, 
            unsafe_allow_html=True
        )
    
    with col2:
        if st.button("Local Admin Login", key="local_admin_main"):
            st.session_state['show_local_login'] = True
            st.rerun()
    
    # Show local login form if requested
    if st.session_state.get('show_local_login', False):
        with st.expander("Local Admin Login", expanded=True):
            from app.auth.local_auth import display_local_login_form
            if display_local_login_form():
                st.session_state['show_local_login'] = False
                st.rerun()
            
            if st.button("Cancel", key="cancel_local_login"):
                st.session_state['show_local_login'] = False
                st.rerun()