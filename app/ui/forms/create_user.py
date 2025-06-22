"""
This file will contain the functions that started on forms.py to create users in the main page.
"""

import streamlit as st

from app.auth.api import create_user
from app.messages import create_user_message, display_welcome_message_ui
from app.utils.form_helpers import reset_create_user_form_fields, parse_and_rerun
