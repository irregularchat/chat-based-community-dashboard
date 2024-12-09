import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
from auth.api import list_users_cached
from utils.config import Config

def fetch_user_data():
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    return list_users_cached(Config.AUTHENTIK_API_URL, headers)

def calculate_metrics(users):
    total_users = len(users)
    active_users = sum(user.get('is_active', False) for user in users)
    
    # Get the current time as an offset-aware datetime
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

def main():
    users = fetch_user_data()
    metrics = calculate_metrics(users)
    display_metrics(metrics)

if __name__ == "__main__":
    main() 