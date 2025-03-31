import streamlit as st
import logging
from typing import List, Dict, Any
from app.auth.admin import (
    check_admin_permission,
    get_authentik_groups,
    get_user_groups,
    manage_user_groups,
    create_group,
    delete_group,
    grant_admin_privileges,
    revoke_admin_privileges
)
from app.auth.api import list_users
from app.utils.config import Config
from app.db.database import SessionLocal
from app.db.operations import get_admin_users, create_admin_event
import pandas as pd

def render_admin_dashboard():
    """
    Render the admin dashboard UI.
    This function should be called from the main app when an admin user is logged in.
    """
    # Check if the current user is an admin
    if not st.session_state.get("is_authenticated"):
        st.error("You must be logged in to access this page.")
        return
        
    username = st.session_state.get("username")
    if not check_admin_permission(username):
        st.error("You do not have permission to access the admin dashboard.")
        return
    
    st.title("Admin Dashboard")
    
    # Create tabs for different admin functions
    tabs = st.tabs(["User Management", "Group Management", "Admin Users", "Logs"])
    
    # User Management Tab
    with tabs[0]:
        render_user_management()
    
    # Group Management Tab
    with tabs[1]:
        render_group_management()
    
    # Admin Users Tab
    with tabs[2]:
        render_admin_users()
    
    # Logs Tab
    with tabs[3]:
        render_admin_logs()

def render_user_management():
    """Render the user management section of the admin dashboard."""
    st.header("User Management")
    
    # Get all users
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    # Add search functionality
    search_term = st.text_input("Search Users", key="user_search")
    
    # Get users from Authentik
    users = list_users(Config.AUTHENTIK_API_URL, headers, search_term)
    
    if not users:
        st.info("No users found.")
        return
    
    # Convert to DataFrame for easier display
    user_data = []
    for user in users:
        user_data.append({
            'ID': user.get('pk'),
            'Username': user.get('username'),
            'Name': user.get('name'),
            'Email': user.get('email'),
            'Active': user.get('is_active', False),
            'Last Login': user.get('last_login', 'Never')
        })
    
    df = pd.DataFrame(user_data)
    
    # Display users in a table with selection
    st.subheader("Select User to Manage")
    selected_indices = st.multiselect(
        "Select users",
        options=list(range(len(df))),
        format_func=lambda i: f"{df.iloc[i]['Username']} ({df.iloc[i]['Name']})"
    )
    
    if selected_indices:
        selected_users = [df.iloc[i] for i in selected_indices]
        
        # Display selected users
        st.subheader("Selected Users")
        for user in selected_users:
            with st.expander(f"{user['Username']} ({user['Name']})"):
                st.write(f"Email: {user['Email']}")
                st.write(f"Active: {user['Active']}")
                st.write(f"Last Login: {user['Last Login']}")
                
                # Get user groups
                user_groups = get_user_groups(user['ID'])
                
                st.subheader("Group Membership")
                if user_groups:
                    group_data = []
                    for group in user_groups:
                        group_data.append({
                            'ID': group.get('pk'),
                            'Name': group.get('name'),
                            'Description': group.get('attributes', {}).get('description', '')
                        })
                    
                    group_df = pd.DataFrame(group_data)
                    st.dataframe(group_df)
                else:
                    st.info("User is not a member of any groups.")
                
                # Group management
                st.subheader("Manage Groups")
                
                # Get all available groups
                all_groups = get_authentik_groups()
                
                # Create options for adding to groups
                available_groups = [g for g in all_groups if g.get('pk') not in [group.get('pk') for group in user_groups]]
                
                if available_groups:
                    groups_to_add = st.multiselect(
                        "Add to groups",
                        options=[g.get('pk') for g in available_groups],
                        format_func=lambda pk: next((g.get('name') for g in available_groups if g.get('pk') == pk), pk)
                    )
                    
                    if groups_to_add and st.button(f"Add {user['Username']} to Selected Groups", key=f"add_groups_{user['ID']}"):
                        result = manage_user_groups(
                            st.session_state.get("username"),
                            user['ID'],
                            groups_to_add=groups_to_add
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully added {user['Username']} to groups.")
                            st.rerun()
                        else:
                            st.error(f"Failed to add {user['Username']} to groups: {result.get('error')}")
                else:
                    st.info("User is already a member of all available groups.")
                
                # Remove from groups
                if user_groups:
                    groups_to_remove = st.multiselect(
                        "Remove from groups",
                        options=[g.get('pk') for g in user_groups],
                        format_func=lambda pk: next((g.get('name') for g in user_groups if g.get('pk') == pk), pk)
                    )
                    
                    if groups_to_remove and st.button(f"Remove {user['Username']} from Selected Groups", key=f"remove_groups_{user['ID']}"):
                        result = manage_user_groups(
                            st.session_state.get("username"),
                            user['ID'],
                            groups_to_remove=groups_to_remove
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully removed {user['Username']} from groups.")
                            st.rerun()
                        else:
                            st.error(f"Failed to remove {user['Username']} from groups: {result.get('error')}")
                
                # Admin privileges
                st.subheader("Admin Privileges")
                
                # Check if user is an admin
                with SessionLocal() as db:
                    is_admin = db.query(db.query(db.model.User).filter_by(username=user['Username']).first().is_admin).scalar()
                
                if is_admin:
                    if st.button(f"Revoke Admin Privileges from {user['Username']}", key=f"revoke_admin_{user['ID']}"):
                        result = revoke_admin_privileges(
                            st.session_state.get("username"),
                            user['Username']
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully revoked admin privileges from {user['Username']}.")
                            st.rerun()
                        else:
                            st.error(f"Failed to revoke admin privileges from {user['Username']}: {result.get('error')}")
                else:
                    if st.button(f"Grant Admin Privileges to {user['Username']}", key=f"grant_admin_{user['ID']}"):
                        result = grant_admin_privileges(
                            st.session_state.get("username"),
                            user['Username']
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully granted admin privileges to {user['Username']}.")
                            st.rerun()
                        else:
                            st.error(f"Failed to grant admin privileges to {user['Username']}: {result.get('error')}")

def render_group_management():
    """Render the group management section of the admin dashboard."""
    st.header("Group Management")
    
    # Get all groups
    groups = get_authentik_groups()
    
    # Create new group
    with st.expander("Create New Group"):
        group_name = st.text_input("Group Name", key="new_group_name")
        group_description = st.text_area("Group Description", key="new_group_description")
        
        if st.button("Create Group", key="create_group_button"):
            if not group_name:
                st.error("Group name is required.")
            else:
                result = create_group(
                    st.session_state.get("username"),
                    group_name,
                    group_description
                )
                
                if result.get('success'):
                    st.success(f"Successfully created group '{group_name}'.")
                    st.rerun()
                else:
                    st.error(f"Failed to create group: {result.get('error')}")
    
    # Display existing groups
    st.subheader("Existing Groups")
    
    if not groups:
        st.info("No groups found.")
        return
    
    # Convert to DataFrame for easier display
    group_data = []
    for group in groups:
        group_data.append({
            'ID': group.get('pk'),
            'Name': group.get('name'),
            'Description': group.get('attributes', {}).get('description', ''),
            'Member Count': group.get('member_count', 0)
        })
    
    df = pd.DataFrame(group_data)
    
    # Display groups in a table with selection
    selected_indices = st.multiselect(
        "Select groups to manage",
        options=list(range(len(df))),
        format_func=lambda i: f"{df.iloc[i]['Name']} ({df.iloc[i]['Member Count']} members)"
    )
    
    if selected_indices:
        selected_groups = [df.iloc[i] for i in selected_indices]
        
        # Display selected groups
        for group in selected_groups:
            with st.expander(f"{group['Name']} ({group['Member Count']} members)"):
                st.write(f"Description: {group['Description']}")
                
                # Delete group button
                if st.button(f"Delete Group '{group['Name']}'", key=f"delete_group_{group['ID']}"):
                    result = delete_group(
                        st.session_state.get("username"),
                        group['ID']
                    )
                    
                    if result.get('success'):
                        st.success(f"Successfully deleted group '{group['Name']}'.")
                        st.rerun()
                    else:
                        st.error(f"Failed to delete group: {result.get('error')}")

def render_admin_users():
    """Render the admin users section of the admin dashboard."""
    st.header("Admin Users")
    
    # Get admin users from configuration
    config_admins = Config.ADMIN_USERNAMES
    
    st.subheader("Configured Admin Users")
    if config_admins:
        st.write("The following users are configured as administrators in the .env file:")
        for admin in config_admins:
            st.write(f"- {admin}")
    else:
        st.info("No administrators are configured in the .env file.")
    
    # Get admin users from database
    with SessionLocal() as db:
        db_admins = get_admin_users(db)
    
    st.subheader("Database Admin Users")
    if db_admins:
        admin_data = []
        for admin in db_admins:
            admin_data.append({
                'Username': admin.username,
                'Name': f"{admin.first_name} {admin.last_name}",
                'Email': admin.email,
                'Date Joined': admin.date_joined
            })
        
        df = pd.DataFrame(admin_data)
        st.dataframe(df)
    else:
        st.info("No administrators found in the database.")

def render_admin_logs():
    """Render the admin logs section of the admin dashboard."""
    st.header("Admin Event Logs")
    
    # Get admin events from database
    with SessionLocal() as db:
        from app.db.operations import get_admin_events
        events = get_admin_events(db, limit=100)  # Get the last 100 events
    
    if events:
        event_data = []
        for event in events:
            event_data.append({
                'Timestamp': event.timestamp,
                'Event Type': event.event_type,
                'Username': event.username,
                'Details': event.details
            })
        
        df = pd.DataFrame(event_data)
        st.dataframe(df)
    else:
        st.info("No admin events found in the database.")
