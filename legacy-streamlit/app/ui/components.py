import streamlit as st

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