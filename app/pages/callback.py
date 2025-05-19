# app/pages/callback.py
import streamlit as st
from app.auth.callback import auth_callback

def main():
    st.set_page_config(page_title="OIDC Callback", layout="centered")
    auth_callback()

if __name__ == "__main__":
    main()
