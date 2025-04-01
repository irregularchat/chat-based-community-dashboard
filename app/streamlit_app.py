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
    css_path = os.path.join(os.path.dirname(__file__), 'static/custom.css')
    
    if os.path.exists(css_path):
        with open(css_path, 'r') as f:
            css = f.read()
            
        import streamlit as st
        st.markdown(f'<style>{css}</style>', unsafe_allow_html=True)
    else:
        logging.warning(f"Custom CSS file not found at {css_path}")

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
        
        # Configure streamlit
        st.set_page_config(
            page_title="Community Dashboard",
            page_icon="🏠",
            layout="wide",
            initial_sidebar_state="expanded",
        )
        
        # Load custom CSS
        load_custom_css()
        
        # Run the application
        main()
    except Exception as e:
        logging.error(f"Error starting application: {e}", exc_info=True)
        raise 