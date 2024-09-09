# app/main.py
import streamlit as st
from ui.home import render_home_page

# Ensure the main Streamlit app starts with the correct logic from home.py
if __name__ == "__main__":
    render_home_page()
    #pass