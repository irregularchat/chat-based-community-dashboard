#!/usr/bin/env python3
import os
import logging
from logging.handlers import RotatingFileHandler

def setup_logging():
    """Set up logging configuration."""
    log_dir = os.path.join(os.getcwd(), 'logs')
    os.makedirs(log_dir, exist_ok=True)
    
    log_file = os.path.join(log_dir, 'app.log')
    
    # Configure root logger
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )
    
    # Add file handler to root logger
    file_handler = RotatingFileHandler(
        log_file, maxBytes=10*1024*1024, backupCount=5
    )
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    ))
    logging.getLogger().addHandler(file_handler)
    
    # Set log levels for some verbose libraries
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('streamlit').setLevel(logging.WARNING)
    logging.getLogger('matplotlib').setLevel(logging.WARNING)
    
    logging.info("Logging configured")

def load_custom_css():
    """Load custom CSS styles."""
    # Load the main custom CSS file
    css_path = os.path.join(os.path.dirname(__file__), 'static/custom.css')
    
    if os.path.exists(css_path):
        with open(css_path, 'r') as f:
            css = f.read()
            
        import streamlit as st
        st.markdown(f'<style>{css}</style>', unsafe_allow_html=True)
    else:
        logging.warning(f"Custom CSS file not found at {css_path}")
    
    # Load mobile-specific CSS
    mobile_css_path = os.path.join(os.path.dirname(__file__), 'static/mobile.css')
    
    if os.path.exists(mobile_css_path):
        with open(mobile_css_path, 'r') as f:
            mobile_css = f.read()
            
        import streamlit as st
        st.markdown(f'<style>{mobile_css}</style>', unsafe_allow_html=True)
    else:
        logging.warning(f"Mobile CSS file not found at {mobile_css_path}")
    
    # Also load the styles.css file for additional styling
    styles_path = os.path.join(os.path.dirname(__file__), 'styles.css')
    
    if os.path.exists(styles_path):
        with open(styles_path, 'r') as f:
            styles_css = f.read()
            
        import streamlit as st
        st.markdown(f'<style>{styles_css}</style>', unsafe_allow_html=True)
    else:
        logging.warning(f"Styles CSS file not found at {styles_path}")

def add_theme_detection_script():
    """Add JavaScript to detect user's preferred color scheme."""
    import streamlit as st
    
    # JavaScript to detect dark mode preference and add a class to the body
    st.markdown("""
    <script>
    // Check if the user prefers dark mode
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        // Add a class to the body for dark mode
        document.body.classList.add('dark-mode');
        // Store the preference
        localStorage.setItem('color-theme', 'dark');
    } else {
        // Add a class to the body for light mode
        document.body.classList.add('light-mode');
        // Store the preference
        localStorage.setItem('color-theme', 'light');
    }
    
    // Listen for changes in the color scheme preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (event.matches) {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            localStorage.setItem('color-theme', 'dark');
        } else {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            localStorage.setItem('color-theme', 'light');
        }
    });
    </script>
    """, unsafe_allow_html=True)

def add_responsive_meta_tags():
    """Add responsive design meta tags."""
    import streamlit as st
    
    # Add viewport meta tag for better mobile experience
    st.markdown("""
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    """, unsafe_allow_html=True)

if __name__ == "__main__":
    # Configure logging before the app starts
    setup_logging()
    
    # Ensure asyncio uses the right event loop policy and patch for nested event loops
    import asyncio
    import nest_asyncio
    
    # Apply nest_asyncio to allow running asyncio in Streamlit
    nest_asyncio.apply()
    
    # Configure the app and run it
    try:
        import streamlit as st
        from app.main import main
        
        # Configure streamlit with theme support
        st.set_page_config(
            page_title="Community Dashboard",
            page_icon="🏠",
            layout="wide",
            initial_sidebar_state="expanded",
            menu_items={
                'Get Help': 'https://irregularchat.com/help',
                'Report a bug': 'https://irregularchat.com/report',
                'About': 'Community Dashboard for managing users and resources'
            }
        )
        
        # Add responsive meta tags
        add_responsive_meta_tags()
        
        # Add theme detection script
        add_theme_detection_script()
        
        # Load custom CSS
        load_custom_css()
        
        # Run the application
        main()
    except Exception as e:
        logging.error(f"Error starting application: {e}", exc_info=True)
        raise