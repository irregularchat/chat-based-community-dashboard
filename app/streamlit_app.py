#!/usr/bin/env python3
import os
import sys
import logging
import streamlit as st
from dotenv import load_dotenv

# Try to load environment variables
load_dotenv()

def setup_logging():
    """Configure logging for the application."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
        ]
    )

def add_responsive_meta_tags():
    """Add responsive meta tags for better mobile display."""
    import streamlit as st
    
    st.markdown("""
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="format-detection" content="telephone=no">
    <link rel="manifest" href="data:application/json;base64,ewogICJuYW1lIjogIkNvbW11bml0eSBEYXNoYm9hcmQiLAogICJzaG9ydF9uYW1lIjogIkRhc2hib2FyZCIsCiAgImljb25zIjogWwogICAgewogICAgICAic3JjIjogIi9mYXZpY29uLmljbyIsCiAgICAgICJzaXplcyI6ICIxNngxNiIsCiAgICAgICJ0eXBlIjogImltYWdlL3gtaWNvbiIKICAgIH0KICBdLAogICJzdGFydF91cmwiOiAiLyIsCiAgImRpc3BsYXkiOiAic3RhbmRhbG9uZSIsCiAgImJhY2tncm91bmRfY29sb3IiOiAiI2ZmZmZmZiIsCiAgInRoZW1lX2NvbG9yIjogIiM0Mjg1RjQiCn0K">
    """, unsafe_allow_html=True)

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
        from app.ui.components import theme_toggle, mobile_meta_tags, bottom_nav
        
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
        mobile_meta_tags()
        
        # Load custom CSS
        load_custom_css()
        
        # Add theme toggle
        theme_toggle()
        
        # Run the application
        main()
        
        # Add mobile bottom navigation
        bottom_nav()
        
    except Exception as e:
        logging.error(f"Error starting application: {e}", exc_info=True)
        raise