import streamlit as st
import logging
from typing import List, Dict, Any, Optional
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
from app.auth.api import list_users, update_user_status, update_user_email, get_authentik_users
from app.utils.config import Config
from app.db.database import SessionLocal
from app.db.models import User, UserNote
from app.db.operations import (
    get_admin_users, 
    create_admin_event, 
    search_users,
    create_user_note,
    get_user_notes,
    update_user_note,
    delete_user_note,
    get_note_by_id,
    sync_user_data_incremental
)
from app.utils.helpers import send_email
import pandas as pd
from datetime import datetime
import time
from sqlalchemy import or_, and_

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
    """Render the user management interface with optional React frontend."""
    st.header("👥 User Management")
    
    # Check if React frontend is available
    try:
        from app.ui.components import render_user_table_with_fallback
        
        # Add a toggle for React frontend (admin preference)
        col1, col2 = st.columns([3, 1])
        with col2:
            use_react = st.checkbox(
                "Use Enhanced UI",
                value=st.session_state.get("use_react_frontend", False),
                help="Enable React-based interface with AG Grid for better performance with large datasets"
            )
            st.session_state["use_react_frontend"] = use_react
        
        # Update config temporarily
        if use_react:
            import os
            os.environ["USE_REACT_FRONTEND"] = "true"
        
        # Render with React or fallback
        render_user_table_with_fallback(st.session_state)
        return
        
    except ImportError:
        # If components module is not available, use original implementation
        pass
    
    # Original Streamlit implementation continues below...
    # Get authentik users with caching
    @st.cache_data(ttl=300)  # Cache for 5 minutes
    def get_cached_users():
        return get_authentik_users()
    
    # Sync with local database
    def sync_users():
        with st.spinner("Syncing users..."):
            try:
                with SessionLocal() as db:
                    users = get_cached_users()
                    if users:
                        sync_user_data_incremental(db, users)
                        st.success(f"Synced {len(users)} users")
                    else:
                        st.error("No users found in Authentik")
            except Exception as e:
                st.error(f"Error syncing users: {str(e)}")
    
    # Sidebar for filters and actions
    with st.sidebar:
        st.subheader("Filters & Actions")
        
        # Sync button
        if st.button("🔄 Sync Users", use_container_width=True):
            sync_users()
            st.cache_data.clear()
            st.rerun()
        
        # Search and filter options
        search_term = st.text_input("🔍 Search", placeholder="Username, email, or name...")
        
        # Status filter
        status_filter = st.selectbox(
            "Status",
            ["All", "Active", "Inactive"],
            index=0
        )
        
        # Role filter
        role_filter = st.multiselect(
            "Roles",
            ["Admin", "Moderator", "Regular User"],
            default=[]
        )
        
        # Group filter
        all_groups = get_authentik_groups()
        group_filter = st.multiselect(
            "Groups",
            options=[g.get('name') for g in all_groups] if all_groups else [],
            default=[]
        )
        
        # Advanced filters
        with st.expander("Advanced Filters"):
            has_notes = st.checkbox("Has moderator notes")
            date_joined_after = st.date_input("Joined after", value=None)
            last_login_before = st.date_input("Last login before", value=None)
    
    # Get users from database with filters
    with SessionLocal() as db:
        query = db.query(User)
        
        # Apply search filter
        if search_term:
            search_pattern = f"%{search_term}%"
            query = query.filter(
                or_(
                    User.username.ilike(search_pattern),
                    User.email.ilike(search_pattern),
                    User.first_name.ilike(search_pattern),
                    User.last_name.ilike(search_pattern)
                )
            )
        
        # Apply status filter
        if status_filter == "Active":
            query = query.filter(User.is_active == True)
        elif status_filter == "Inactive":
            query = query.filter(User.is_active == False)
        
        # Apply role filter
        if role_filter:
            role_conditions = []
            if "Admin" in role_filter:
                role_conditions.append(User.is_admin == True)
            if "Moderator" in role_filter:
                role_conditions.append(User.is_moderator == True)
            if "Regular User" in role_filter:
                role_conditions.append(and_(User.is_admin == False, User.is_moderator == False))
            
            if role_conditions:
                query = query.filter(or_(*role_conditions))
        
        # Apply advanced filters
        if has_notes:
            query = query.join(User.notes).distinct()
        
        if date_joined_after:
            query = query.filter(User.date_joined >= date_joined_after)
        
        if last_login_before:
            query = query.filter(User.last_login <= last_login_before)
        
        # Get filtered users
        db_users = query.all()
        
        # Convert to list of dicts and add note counts
        users_data = []
        for user in db_users:
            user_dict = user.to_dict()
            # Add note count
            note_count = db.query(UserNote).filter(UserNote.user_id == user.id).count()
            user_dict['note_count'] = note_count
            users_data.append(user_dict)
    
    # Create DataFrame for display
    if users_data:
        df = pd.DataFrame(users_data)
        
        # Reorder and rename columns for display
        display_columns = {
            'id': 'ID',
            'username': 'Username',
            'name': 'Name',
            'email': 'Email',
            'is_active': 'Status',
            'last_login': 'Last Login',
            'note_count': 'Notes'
        }
        
        # Select and rename columns
        df_display = df[list(display_columns.keys())].rename(columns=display_columns)
        
        # Format the Status column
        df_display['Status'] = df_display['Status'].apply(lambda x: '✅ Active' if x else '❌ Inactive')
        
        # Format Last Login
        df_display['Last Login'] = pd.to_datetime(df['last_login']).dt.strftime('%Y-%m-%d %H:%M')
        df_display['Last Login'] = df_display['Last Login'].fillna('Never')
    else:
        df = pd.DataFrame()
        df_display = pd.DataFrame()

def render_group_management():
    """Render the group management section of the admin dashboard."""
    st.header("Group Management")
    
    # Get all groups
    with st.spinner("Loading groups..."):
        groups = get_authentik_groups()
    
    # Create two columns for the layout
    col1, col2 = st.columns([1, 2])
    
    with col1:
        st.subheader("Create New Group")
        with st.form("create_group_form"):
            group_name = st.text_input("Group Name", key="new_group_name")
            group_description = st.text_area("Group Description", key="new_group_description", height=100)
            
            submit_button = st.form_submit_button("Create Group")
            
            if submit_button:
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
                        time.sleep(1)
                        st.rerun()
                    else:
                        st.error(f"Failed to create group: {result.get('error')}")
    
    with col2:
        # Display existing groups
        st.subheader("Existing Groups")
        
        if not groups:
            st.info("No groups found.")
        else:
            # Add search filter for groups
            search_group = st.text_input("Search groups", key="group_search")
            
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
            
            # Apply search filter
            if search_group:
                df = df[df['Name'].str.contains(search_group, case=False) | 
                        df['Description'].str.contains(search_group, case=False)]
            
            # Sort by name
            df = df.sort_values(by='Name')
            
            if df.empty:
                st.warning("No groups match your search.")
            else:
                # Display groups in a table with selection
                st.write(f"Showing {len(df)} groups")
                
                # Use data editor for better interaction
                selection = st.data_editor(
                    df,
                    column_config={
                        "ID": st.column_config.TextColumn(
                            "ID",
                            width="small",
                            required=True,
                        ),
                        "Name": st.column_config.TextColumn(
                            "Name",
                            width="medium",
                        ),
                        "Description": st.column_config.TextColumn(
                            "Description",
                            width="large",
                        ),
                        "Member Count": st.column_config.NumberColumn(
                            "Members",
                            width="small",
                        ),
                    },
                    hide_index=True,
                    key="group_table",
                    use_container_width=True,
                    disabled=["ID", "Name", "Description", "Member Count"],
                    selection="single",
                    height=400
                )
                
                # Get selected row
                selected_rows = selection.get("selected_rows", [])
                
                if selected_rows:
                    group = selected_rows[0]
                    
                    st.subheader(f"Manage Group: {group['Name']}")
                    
                    # Create tabs for group management
                    group_tabs = st.tabs(["Group Details", "Group Members", "Delete Group"])
                    
                    # Tab 1: Group Details
                    with group_tabs[0]:
                        st.write(f"**ID:** {group['ID']}")
                        st.write(f"**Name:** {group['Name']}")
                        st.write(f"**Description:** {group['Description']}")
                        st.write(f"**Member Count:** {group['Member Count']}")
                    
                    # Tab 2: Group Members
                    with group_tabs[1]:
                        st.subheader("Group Members")
                        
                        # This would require an API to get group members
                        # For now, just show a placeholder
                        st.info("Group member management will be implemented in a future update.")
                    
                    # Tab 3: Delete Group
                    with group_tabs[2]:
                        st.subheader("Delete Group")
                        st.warning(f"Are you sure you want to delete the group '{group['Name']}'? This action cannot be undone.")
                        
                        # Require confirmation
                        confirm_delete = st.checkbox("I understand that this action cannot be undone", key="confirm_delete")
                        
                        if confirm_delete and st.button(f"Delete Group '{group['Name']}'", key=f"delete_group_{group['ID']}"):
                            result = delete_group(
                                st.session_state.get("username"),
                                group['ID']
                            )
                            
                            if result.get('success'):
                                st.success(f"Successfully deleted group '{group['Name']}'.")
                                time.sleep(1)
                                st.rerun()
                            else:
                                st.error(f"Failed to delete group: {result.get('error')}")

def render_admin_users():
    """Render the admin users section of the admin dashboard."""
    st.header("Admin Users")
    
    # Create tabs for different views
    admin_tabs = st.tabs(["Current Admins", "Grant Admin Access"])
    
    # Tab 1: Current Admins
    with admin_tabs[0]:
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
                    'Date Joined': admin.date_joined.strftime('%Y-%m-%d %H:%M') if admin.date_joined else 'Unknown',
                    'Is Config Admin': admin.username in config_admins
                })
            
            df = pd.DataFrame(admin_data)
            
            # Display admins in a table
            st.dataframe(
                df,
                column_config={
                    "Username": st.column_config.TextColumn(
                        "Username",
                        width="medium",
                    ),
                    "Name": st.column_config.TextColumn(
                        "Name",
                        width="medium",
                    ),
                    "Email": st.column_config.TextColumn(
                        "Email",
                        width="medium",
                    ),
                    "Date Joined": st.column_config.TextColumn(
                        "Date Joined",
                        width="medium",
                    ),
                    "Is Config Admin": st.column_config.CheckboxColumn(
                        "Config Admin",
                        help="Whether this admin is defined in the configuration file",
                        width="small",
                    ),
                },
                hide_index=True,
                use_container_width=True
            )
            
            # Allow revoking admin privileges
            st.subheader("Revoke Admin Privileges")
            
            # Filter out config admins as they can't be revoked
            revokable_admins = [admin for admin in db_admins if admin.username not in config_admins]
            
            if revokable_admins:
                admin_to_revoke = st.selectbox(
                    "Select admin to revoke privileges from",
                    options=[admin.username for admin in revokable_admins],
                    key="admin_to_revoke"
                )
                
                if st.button("Revoke Admin Privileges", key="revoke_admin_btn"):
                    result = revoke_admin_privileges(
                        st.session_state.get("username"),
                        admin_to_revoke
                    )
                    
                    if result.get('success'):
                        st.success(f"Successfully revoked admin privileges from {admin_to_revoke}.")
                        time.sleep(1)
                        st.rerun()
                    else:
                        st.error(f"Failed to revoke admin privileges: {result.get('error')}")
            else:
                st.info("No database admins available to revoke privileges from. Config admins cannot be revoked through the UI.")
        else:
            st.info("No administrators found in the database.")
    
    # Tab 2: Grant Admin Access
    with admin_tabs[1]:
        st.subheader("Grant Admin Privileges")
        
        # Get headers for API requests
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # Search for users
        search_term = st.text_input("Search for users", key="admin_user_search")
        
        if search_term:
            with st.spinner("Searching users..."):
                users = list_users(Config.AUTHENTIK_API_URL, headers, search_term)
            
            if not users:
                st.info("No users found matching your search.")
            else:
                # Filter out users who are already admins
                with SessionLocal() as db:
                    # Get existing admin usernames
                    existing_admins = [admin.username for admin in get_admin_users(db)]
                    
                    # Filter users
                    non_admin_users = [user for user in users if user.get('username') not in existing_admins]
                
                if not non_admin_users:
                    st.info("All users matching your search are already admins.")
                else:
                    # Convert to DataFrame for display
                    user_data = []
                    for user in non_admin_users:
                        user_data.append({
                            'ID': user.get('pk'),
                            'Username': user.get('username'),
                            'Name': user.get('name'),
                            'Email': user.get('email')
                        })
                    
                    df = pd.DataFrame(user_data)
                    
                    # Display users
                    st.subheader("Select User to Grant Admin Privileges")
                    
                    # Use radio buttons for selection
                    selected_username = st.radio(
                        "Select user",
                        options=df['Username'].tolist(),
                        format_func=lambda username: f"{username} ({df[df['Username'] == username]['Name'].iloc[0]})",
                        key="admin_user_select"
                    )
                    
                    if st.button("Grant Admin Privileges", key="grant_admin_btn"):
                        result = grant_admin_privileges(
                            st.session_state.get("username"),
                            selected_username
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully granted admin privileges to {selected_username}.")
                            time.sleep(1)
                            st.rerun()
                        else:
                            st.error(f"Failed to grant admin privileges: {result.get('error')}")

def render_admin_logs():
    """Render the admin logs section of the admin dashboard."""
    st.header("Admin Event Logs")
    
    # Add filtering options
    col1, col2 = st.columns(2)
    
    with col1:
        # Filter by event type
        event_types = ["All", "user_created", "user_updated", "admin_granted", "admin_revoked", 
                      "group_created", "group_deleted", "user_added_to_group", "user_removed_from_group",
                      "user_note_created", "user_note_updated", "user_note_deleted"]
        event_filter = st.selectbox("Filter by event type", options=event_types, key="event_filter")
    
    with col2:
        # Filter by username
        username_filter = st.text_input("Filter by username", key="username_filter")
    
    # Limit control
    limit = st.slider("Number of events to show", min_value=10, max_value=500, value=100, step=10, key="event_limit")
    
    # Get admin events from database
    with SessionLocal() as db:
        from app.db.operations import get_admin_events
        events = get_admin_events(db, limit=limit)  # Get events with the specified limit
    
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
        
        # Apply filters
        if event_filter != "All":
            df = df[df['Event Type'] == event_filter]
        
        if username_filter:
            df = df[df['Username'].str.contains(username_filter, case=False)]
        
        # Sort by timestamp (newest first)
        df = df.sort_values(by='Timestamp', ascending=False)
        
        if df.empty:
            st.info("No events match your filters.")
        else:
            # Format timestamp
            df['Timestamp'] = df['Timestamp'].apply(lambda x: x.strftime('%Y-%m-%d %H:%M:%S'))
            
            # Display events in a table
            st.write(f"Showing {len(df)} events")
            st.dataframe(
                df,
                column_config={
                    "Timestamp": st.column_config.TextColumn(
                        "Timestamp",
                        width="medium",
                    ),
                    "Event Type": st.column_config.TextColumn(
                        "Event Type",
                        width="medium",
                    ),
                    "Username": st.column_config.TextColumn(
                        "Username",
                        width="medium",
                    ),
                    "Details": st.column_config.TextColumn(
                        "Details",
                        width="large",
                    ),
                },
                hide_index=True,
                use_container_width=True
            )
            
            # Add export option
            if st.button("Export to CSV", key="export_logs"):
                # Convert DataFrame to CSV
                csv = df.to_csv(index=False)
                
                # Create a download button
                st.download_button(
                    label="Download CSV",
                    data=csv,
                    file_name="admin_logs.csv",
                    mime="text/csv",
                    key="download_logs"
                )
    else:
        st.info("No admin events found in the database.")