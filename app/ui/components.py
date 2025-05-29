import streamlit as st
import streamlit.components.v1 as components
import json
import os
from typing import Dict, Any, Optional, List
from app.utils.config import Config
import logging

# Configure component paths
COMPONENT_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "components")
BUILD_DIR = os.path.join(COMPONENT_DIR, "build")

# Check if we're in development mode
_RELEASE = not Config.DEBUG

# Create the component function
if not _RELEASE:
    # Development mode - serve from the React dev server
    user_management_table = components.declare_component(
        "user_management_table",
        url="http://localhost:3001"  # React dev server URL
    )
else:
    # Production mode - serve from built files
    user_management_table = components.declare_component(
        "user_management_table",
        path=BUILD_DIR
    )

def render_user_management_table(
    api_url: str,
    api_key: str,
    current_user: str,
    height: int = 800,
    key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Render the enhanced user management table with React and AG Grid.
    
    Args:
        api_url: Base URL for the API endpoints
        api_key: API key for authentication
        current_user: Username of the current user
        height: Height of the component in pixels
        key: Optional key for the component
        
    Returns:
        Dict containing any user interactions/updates from the component
    """
    # Component properties
    component_props = {
        "apiUrl": api_url,
        "apiKey": api_key,
        "currentUser": current_user,
    }
    
    # Render the component
    component_value = user_management_table(
        **component_props,
        height=height,
        key=key,
        default={}
    )
    
    return component_value or {}

def render_user_table_with_fallback(session_state: Dict[str, Any]) -> None:
    """
    Render user management table with React frontend or fallback to Streamlit.
    
    Args:
        session_state: Streamlit session state containing user info and settings
    """
    # Check if React frontend is enabled
    use_react_frontend = Config.get("USE_REACT_FRONTEND", False)
    
    if use_react_frontend and Config.get("API_SECRET_KEY"):
        try:
            # Use React frontend
            st.markdown("### 🚀 Enhanced User Management (React + AG Grid)")
            
            # API configuration
            api_url = Config.get("API_BASE_URL", "http://localhost:5001")
            api_key = Config.get("API_SECRET_KEY", "")
            current_user = session_state.get("username", "admin")
            
            # Render the React component
            result = render_user_management_table(
                api_url=api_url,
                api_key=api_key,
                current_user=current_user,
                height=800,
                key="user_management_table"
            )
            
            # Handle any actions from the React component
            if result:
                action = result.get("action")
                data = result.get("data")
                
                if action == "view_details":
                    # Store selected user in session state
                    session_state["selected_user_details"] = data
                    st.info(f"Selected user: {data.get('username')}")
                    
                elif action == "refresh_required":
                    # Trigger a refresh
                    st.rerun()
                    
        except Exception as e:
            logging.error(f"Error rendering React component: {e}")
            st.error(f"Failed to load React frontend: {str(e)}")
            st.info("Falling back to Streamlit interface...")
            _render_streamlit_fallback(session_state)
    else:
        # Use Streamlit fallback
        _render_streamlit_fallback(session_state)

def _render_streamlit_fallback(session_state: Dict[str, Any]) -> None:
    """
    Render the fallback Streamlit user management interface.
    This imports and calls the existing render_user_management function.
    """
    try:
        from app.ui.admin import render_user_management
        render_user_management()
    except ImportError as e:
        st.error(f"Error loading user management module: {e}")

# Additional helper components
def render_inline_note_editor(user_id: int, existing_notes: List[Dict[str, Any]]) -> Optional[str]:
    """
    Render an inline note editor for quick note addition.
    
    Args:
        user_id: ID of the user to add note for
        existing_notes: List of existing notes for context
        
    Returns:
        The new note content if submitted, None otherwise
    """
    with st.expander("📝 Quick Add Note", expanded=False):
        # Show recent notes for context
        if existing_notes:
            st.caption("Recent notes:")
            for note in existing_notes[:2]:
                st.text(f"{note['created_by']}: {note['content'][:100]}...")
        
        # Note input form
        with st.form(f"quick_note_{user_id}"):
            note_content = st.text_area(
                "Note Content",
                placeholder="Enter your note here...",
                height=100
            )
            
            col1, col2 = st.columns([3, 1])
            with col1:
                submit = st.form_submit_button("Add Note", use_container_width=True)
            with col2:
                cancel = st.form_submit_button("Cancel", use_container_width=True)
            
            if submit and note_content:
                return note_content
            elif cancel:
                return None
    
    return None

def render_bulk_action_modal(
    action_type: str,
    selected_users: List[Dict[str, Any]],
    available_options: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """
    Render a modal for bulk actions on selected users.
    
    Args:
        action_type: Type of bulk action (e.g., 'add_groups', 'send_email')
        selected_users: List of selected user objects
        available_options: Optional list of available options (e.g., groups)
        
    Returns:
        Action configuration if confirmed, None otherwise
    """
    st.markdown(f"### Bulk Action: {action_type.replace('_', ' ').title()}")
    st.write(f"Selected {len(selected_users)} users")
    
    action_config = {}
    
    if action_type == "add_groups" and available_options:
        selected_groups = st.multiselect(
            "Select groups to add users to:",
            options=[g["pk"] for g in available_options],
            format_func=lambda pk: next((g["name"] for g in available_options if g["pk"] == pk), pk)
        )
        action_config["group_ids"] = selected_groups
        
    elif action_type == "send_email":
        action_config["subject"] = st.text_input("Email Subject")
        action_config["body"] = st.text_area("Email Body", height=200)
        action_config["is_html"] = st.checkbox("Send as HTML", value=True)
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("Confirm", type="primary", use_container_width=True):
            return action_config
    with col2:
        if st.button("Cancel", use_container_width=True):
            return None
    
    return None

# Export functions
__all__ = [
    'render_user_management_table',
    'render_user_table_with_fallback',
    'render_inline_note_editor',
    'render_bulk_action_modal'
]

def theme_toggle():
    """
    Add a theme toggle switch to switch between light and dark mode.
    This component uses JavaScript to save theme preference to localStorage.
    """
    st.markdown("""
    <div class="theme-toggle-container">
        <label class="theme-toggle">
            <input type="checkbox" id="theme-toggle-input">
            <span class="theme-slider">
                <span class="moon-icon">🌙</span>
                <span class="sun-icon">☀️</span>
            </span>
        </label>
    </div>
    
    <script>
    // Function to set theme
    function setTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark-theme');
            document.documentElement.classList.remove('light-theme');
            document.getElementById('theme-toggle-input').checked = true;
        } else {
            document.documentElement.classList.add('light-theme');
            document.documentElement.classList.remove('dark-theme');
            document.getElementById('theme-toggle-input').checked = false;
        }
        localStorage.setItem('theme', theme);
    }
    
    // Initialize theme based on localStorage or system preference
    document.addEventListener('DOMContentLoaded', () => {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme) {
            setTheme(savedTheme);
        } else if (prefersDark) {
            setTheme('dark');
        } else {
            setTheme('light');
        }
        
        // Add event listener to the theme toggle
        document.getElementById('theme-toggle-input').addEventListener('change', function(e) {
            if (e.target.checked) {
                setTheme('dark');
            } else {
                setTheme('light');
            }
        });
        
        // Listen for system preference changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem('theme')) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        });
    });
    </script>
    """, unsafe_allow_html=True)

def mobile_meta_tags():
    """
    Add mobile-friendly meta tags for better responsiveness
    """
    st.markdown("""
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="format-detection" content="telephone=no">
    <link rel="manifest" href="data:application/json;base64,ewogICJuYW1lIjogIkNvbW11bml0eSBEYXNoYm9hcmQiLAogICJzaG9ydF9uYW1lIjogIkRhc2hib2FyZCIsCiAgImljb25zIjogWwogICAgewogICAgICAic3JjIjogIi9mYXZpY29uLmljbyIsCiAgICAgICJzaXplcyI6ICIxNngxNiIsCiAgICAgICJ0eXBlIjogImltYWdlL3gtaWNvbiIKICAgIH0KICBdLAogICJzdGFydF91cmwiOiAiLyIsCiAgImRpc3BsYXkiOiAic3RhbmRhbG9uZSIsCiAgImJhY2tncm91bmRfY29sb3IiOiAiI2ZmZmZmZiIsCiAgInRoZW1lX2NvbG9yIjogIiM0Mjg1RjQiCn0K">
    <style>
    @media (max-width: 767px) {
        /* Hide Streamlit branding on mobile */
        footer {
            display: none !important;
        }
        
        /* Make the app use full height on mobile */
        .stApp {
            min-height: 100vh;
        }
    }
    </style>
    """, unsafe_allow_html=True)

def bottom_nav():
    """
    Add a mobile-friendly bottom navigation bar for small screens
    """
    st.markdown("""
    <style>
    @media (max-width: 767px) {
        .bottom-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background-color: var(--card-bg);
            display: flex;
            justify-content: space-around;
            padding: 10px 0;
            box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
        }
        
        .bottom-nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            color: var(--text-color);
            text-decoration: none;
            font-size: 12px;
        }
        
        .bottom-nav-icon {
            font-size: 24px;
            margin-bottom: 4px;
        }
        
        /* Add padding to main content to prevent overlap with bottom nav */
        .main .block-container {
            padding-bottom: 70px !important;
        }
    }
    
    @media (min-width: 768px) {
        /* Hide on desktop */
        .bottom-nav {
            display: none !important;
        }
    }
    </style>
    
    <div class="bottom-nav">
        <a href="/" class="bottom-nav-item">
            <div class="bottom-nav-icon">🏠</div>
            <div>Home</div>
        </a>
        <a href="/users" class="bottom-nav-item">
            <div class="bottom-nav-icon">👥</div>
            <div>Users</div>
        </a>
        <a href="/invites" class="bottom-nav-item">
            <div class="bottom-nav-icon">✉️</div>
            <div>Invites</div>
        </a>
        <a href="/settings" class="bottom-nav-item">
            <div class="bottom-nav-icon">⚙️</div>
            <div>Settings</div>
        </a>
    </div>
    """, unsafe_allow_html=True) 