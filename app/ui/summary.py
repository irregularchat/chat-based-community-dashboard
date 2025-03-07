import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
from auth.api import list_users_cached, list_events_cached
from utils.config import Config
from db.database import get_db
from db.operations import User, AdminEvent
from sqlalchemy.orm import Session
import logging
from ui.common import display_useful_links

def fetch_user_data():
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    return list_users_cached(Config.AUTHENTIK_API_URL, headers)

def calculate_metrics(users):
    total_users = len(users)
    active_users = sum(user.get('is_active', False) for user in users)
    
    # FIXME: Ensure timezone handling is consistent across all datetime operations
    now = datetime.now().astimezone()

    recently_joined = [
        user for user in users 
        if 'date_joined' in user and isinstance(user['date_joined'], str) and
        datetime.fromisoformat(user['date_joined']).astimezone() > now - timedelta(days=30)
    ]
    recently_deactivated = [
        user for user in users 
        if not user.get('is_active', False) and 'last_login' in user and isinstance(user['last_login'], str) and
        datetime.fromisoformat(user['last_login']).astimezone() > now - timedelta(days=30)
    ]
    inactive_users = [
        user for user in users 
        if 'last_login' not in user or (isinstance(user['last_login'], str) and
        datetime.fromisoformat(user['last_login']).astimezone() < now - timedelta(days=365))
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
            f"{event.timestamp}: [{event.event_type}] {event.username} - {event.description}"
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