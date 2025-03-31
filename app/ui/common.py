import streamlit as st
from app.utils.config import Config
from app.auth.authentication import is_authenticated, get_current_user, get_login_url, get_logout_url, logout

def display_useful_links():
    """Display the Useful Links section in the sidebar."""
    # Display login/logout button
    if is_authenticated():
        user_info = get_current_user()
        username = user_info.get('preferred_username', 'User')
        st.sidebar.success(f"Logged in as: {username}")
        
        if st.sidebar.button("Logout"):
            logout()
            # Get the logout URL and redirect
            logout_url = get_logout_url()
            st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{logout_url}\'">', unsafe_allow_html=True)
            st.rerun()
    else:
        login_url = get_login_url()
        st.sidebar.markdown(f"<a href='{login_url}' class='login-button'>Login</a>", unsafe_allow_html=True)
    
    st.sidebar.markdown("""
        ## Useful Links:
        - [Login to IrregularChat SSO](https://sso.irregularchat.com)
        - [Use Signal CopyPasta for Welcome Messages](https://irregularpedia.org/index.php/Signal_Welcome_Prompts)
        - [Admin Prompts for Common Situations](https://irregularpedia.org/index.php/Admin)
        - [Links to Community Chats and Services](https://irregularpedia.org/index.php/Links)
    """) 

def display_login_button(redirect_path=None):
    """
    Display a login button.
    
    Args:
        redirect_path (str, optional): Path to redirect to after login
    """
    login_url = get_login_url(redirect_path)
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