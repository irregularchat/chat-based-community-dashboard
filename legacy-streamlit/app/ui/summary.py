import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
from app.auth.api import list_users_cached, list_events_cached
from app.utils.config import Config
from app.db.session import get_db
from app.db.operations import User, AdminEvent
from sqlalchemy.orm import Session
import logging
from app.ui.common import display_useful_links
from app.db.operations import get_user_metrics

def fetch_user_data():
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    return list_users_cached(Config.AUTHENTIK_API_URL, headers)

def calculate_metrics(users):
    """Calculate user metrics"""
    now = datetime.now().astimezone()
    thirty_days_ago = now - timedelta(days=30)
    one_year_ago = now - timedelta(days=365)

    total_users = len(users)
    active_users = sum(user.get('is_active', False) for user in users)

    # Users who joined in the last 30 days
    recently_joined = [
        user for user in users 
        if 'date_joined' in user and isinstance(user['date_joined'], str) and
        datetime.fromisoformat(user['date_joined']).astimezone() > thirty_days_ago
    ]

    # Users who were deactivated in the last 30 days
    recently_deactivated = [
        user for user in users 
        if (not user.get('is_active', False) and  # Must be inactive
            'last_login' in user and 
            isinstance(user['last_login'], str) and
            datetime.fromisoformat(user['last_login']).astimezone() > thirty_days_ago)  # Last login within 30 days
    ]

    # Users are considered inactive if any of these conditions are met:
    # 1. No last_login timestamp
    # 2. Last login more than a year ago
    # Note: We don't count all inactive users here, only those meeting the time criteria
    inactive_users = [
        user for user in users 
        if ('last_login' not in user or  # No last login timestamp
            (isinstance(user['last_login'], str) and
             datetime.fromisoformat(user['last_login']).astimezone() < one_year_ago))  # Last login more than a year ago
    ]

    return {
        "total_users": total_users,
        "active_users": active_users,
        "recently_joined": len(recently_joined),
        "recently_deactivated": len(recently_deactivated),
        "inactive_users": len(inactive_users)
    }

def display_metrics(metrics):
    st.title("User Status Insights and Metrics")
    st.metric("Total Users", metrics['total_users'])
    st.metric("Active Users", metrics['active_users'])
    st.metric("Recently Joined Users (Last 30 days)", metrics['recently_joined'])
    st.metric("Recently Deactivated Accounts (Last 30 days)", metrics['recently_deactivated'])
    st.metric("Inactive Users (No login in last year)", metrics['inactive_users'])

# FIXME: Review the necessity of fetching event data if not displaying it
# def fetch_event_data():
#     headers = {
#         'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
#         'Content-Type': 'application/json'
#     }
#     return list_events_cached(Config.AUTHENTIK_API_URL, headers)

def display_event_history(db: Session):
    st.subheader("Admin Event Timeline")
    events = db.query(AdminEvent).order_by(AdminEvent.timestamp.desc()).all()
    if not events:
        st.info("No admin events recorded yet.")
        return
    for event in events:
        st.write(
            f"{event.timestamp}: [{event.event_type}] {event.username} - {event.details}"
        )

def main():
    # Display Useful Links in the sidebar
    display_useful_links()
    
    users = fetch_user_data()
    metrics = calculate_metrics(users)
    display_metrics(metrics)
    
    # Now display the timeline
    with next(get_db()) as db:
        display_event_history(db)

if __name__ == "__main__":
    main() 