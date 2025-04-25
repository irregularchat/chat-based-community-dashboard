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
from app.auth.api import list_users, update_user_status, update_user_email, update_user_data
from app.utils.config import Config
from app.db.database import SessionLocal
from app.db.operations import (
    get_admin_users, 
    create_admin_event, 
    search_users,
    create_user_note,
    get_user_notes,
    update_user_note,
    delete_user_note,
    get_note_by_id
)
from app.utils.helpers import send_email
import pandas as pd
from datetime import datetime
import time
from app.db.models import User  # Import User model

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
    
    # Initialize session state for filters if not exists
    if 'user_filters' not in st.session_state:
        st.session_state['user_filters'] = {
            'search_term': '',
            'status_filter': 'All',
            'group_filter': 'All',
            'sort_by': 'Username',
            'sort_order': 'Ascending'
        }
    
    # Create filter section with columns for better layout
    st.subheader("Filter Users")
    filter_col1, filter_col2 = st.columns(2)
    
    with filter_col1:
        # Search by name, username, or email
        search_term = st.text_input(
            "Search by name, username, or email", 
            value=st.session_state['user_filters']['search_term'],
            key="user_search"
        )
        st.session_state['user_filters']['search_term'] = search_term
        
        # Filter by status
        status_options = ['All', 'Active', 'Inactive']
        status_filter = st.selectbox(
            "Filter by status",
            options=status_options,
            index=status_options.index(st.session_state['user_filters']['status_filter']),
            key="status_filter"
        )
        st.session_state['user_filters']['status_filter'] = status_filter
    
    with filter_col2:
        # Get all groups for filtering
        all_groups = get_authentik_groups()
        group_options = ['All'] + [g.get('name') for g in all_groups]
        
        # Filter by group membership
        group_filter = st.selectbox(
            "Filter by group membership",
            options=group_options,
            index=group_options.index(st.session_state['user_filters']['group_filter']) 
                if st.session_state['user_filters']['group_filter'] in group_options else 0,
            key="group_filter"
        )
        st.session_state['user_filters']['group_filter'] = group_filter
        
        # Sorting options
        sort_options = ['Username', 'Name', 'Email', 'Last Login', 'Status']
        sort_by = st.selectbox(
            "Sort by",
            options=sort_options,
            index=sort_options.index(st.session_state['user_filters']['sort_by']),
            key="sort_by"
        )
        st.session_state['user_filters']['sort_by'] = sort_by
        
        # Sort order
        order_options = ['Ascending', 'Descending']
        sort_order = st.selectbox(
            "Sort order",
            options=order_options,
            index=order_options.index(st.session_state['user_filters']['sort_order']),
            key="sort_order"
        )
        st.session_state['user_filters']['sort_order'] = sort_order
    
    # Get headers for API requests
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    # Get users from Authentik
    with st.spinner("Loading users..."):
        users = list_users(Config.AUTHENTIK_API_URL, headers, search_term)
    
    if not users:
        st.info("No users found.")
        return
    
    # Apply filters
    filtered_users = users
    
    # Filter by status
    if status_filter != 'All':
        is_active = status_filter == 'Active'
        filtered_users = [u for u in filtered_users if u.get('is_active', False) == is_active]
    
    # Filter by group membership
    if group_filter != 'All':
        # Find the group ID for the selected group name
        group_id = next((g.get('pk') for g in all_groups if g.get('name') == group_filter), None)
        
        if group_id:
            # This is a more complex filter that requires checking each user's group membership
            users_in_group = []
            for user in filtered_users:
                user_id = user.get('pk')
                if user_id:
                    user_groups = get_user_groups(user_id)
                    if any(g.get('pk') == group_id for g in user_groups):
                        users_in_group.append(user)
            filtered_users = users_in_group
    
    # Convert to DataFrame for easier display and sorting
    user_data = []
    for user in filtered_users:
        # Format last login date
        last_login = user.get('last_login', 'Never')
        if last_login and last_login != 'Never':
            try:
                last_login_dt = datetime.fromisoformat(last_login.replace('Z', '+00:00'))
                last_login = last_login_dt.strftime('%Y-%m-%d %H:%M')
            except (ValueError, TypeError):
                last_login = 'Invalid date'
        
        # Get note count for this user
        note_count = 0
        with SessionLocal() as db:
            try:
                db_user = db.query(User).filter_by(username=user.get('username')).first()
                if db_user:
                    note_count = len(db_user.notes) if hasattr(db_user, 'notes') else 0
            except Exception as e:
                logging.error(f"Error getting note count: {e}")
        
        # Add note indicator if there are notes
        notes_indicator = f"📝 {note_count}" if note_count > 0 else ""
        
        user_data.append({
            'ID': user.get('pk'),
            'Username': user.get('username'),
            'Name': user.get('name'),
            'Email': user.get('email'),
            'Status': '✅ Active' if user.get('is_active', False) else '❌ Inactive',
            'Last Login': last_login,
            'LinkedIn': user.get('attributes', {}).get('linkedin_username', ''),
            'Phone Number': user.get('attributes', {}).get('phone_number', ''),
            'Notes': notes_indicator
        })
    
    df = pd.DataFrame(user_data)
    
    # Apply sorting
    sort_column_map = {
        'Username': 'Username',
        'Name': 'Name',
        'Email': 'Email',
        'Last Login': 'Last Login',
        'Status': 'Status',
        'LinkedIn': 'LinkedIn',
        'Phone Number': 'Phone Number'
    }
    
    sort_column = sort_column_map.get(sort_by, 'Username')
    ascending = sort_order == 'Ascending'
    
    if not df.empty:
        df = df.sort_values(by=sort_column, ascending=ascending)
    
    # Display user count
    st.write(f"Found {len(df)} users matching your filters")
    
    # Create tabs for different user management views
    user_tabs = st.tabs(["User List", "Bulk Operations", "User Details"])
    
    # Tab 1: User List
    with user_tabs[0]:
        if not df.empty:
            # Use Streamlit's data editor for better interaction
            selection = st.data_editor(
                df,
                column_config={
                    "ID": st.column_config.TextColumn(
                        "ID",
                        width="small",
                        required=True,
                    ),
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
                    "Status": st.column_config.TextColumn(
                        "Status",
                        width="small",
                    ),
                    "Last Login": st.column_config.TextColumn(
                        "Last Login",
                        width="medium",
                    ),
                    "LinkedIn": st.column_config.TextColumn(
                        "LinkedIn",
                        width="medium",
                    ),
                    "Phone Number": st.column_config.TextColumn(
                        "Phone Number",
                        width="medium",
                    ),
                    "Notes": st.column_config.TextColumn(
                        "Notes",
                        width="small",
                        help="Number of moderator notes for this user"
                    ),
                },
                hide_index=True,
                key="user_table",
                use_container_width=True,
                disabled=["ID", "Username", "Name", "Email", "Status", "Last Login", "Notes"],
                height=400
            )
            
            # Check if data editor has been edited
            if "original_df" not in st.session_state:
                st.session_state.original_df = df.copy()
            
            # Compare original and edited dataframes to detect changes
            edited_df = selection
            changes_detected = False
            changed_rows = []
            
            if not edited_df.equals(st.session_state.original_df):
                changes_detected = True
                # Find which rows changed
                for idx, row in edited_df.iterrows():
                    if idx < len(st.session_state.original_df):
                        orig_row = st.session_state.original_df.iloc[idx]
                        if not row.equals(orig_row):
                            changed_rows.append({
                                'id': row['ID'],
                                'username': row['Username'],
                                'changes': {
                                    'linkedin_username': row['LinkedIn'],
                                    'phone_number': row['Phone Number']
                                }
                            })
            
            # Show save button if changes detected
            if changes_detected:
                st.warning(f"Unsaved changes detected for {len(changed_rows)} user(s). Click 'Save to Authentik' to update.")
                if st.button("Save to Authentik", key="save_data_editor_changes"):
                    success_count = 0
                    for change in changed_rows:
                        try:
                            # Get user details to update attributes
                            from app.auth.admin import get_user_details
                            user_details = get_user_details(change['id'])
                            if user_details is None:
                                st.error(f"Failed to fetch details for user {change['username']}.")
                                continue
                                
                            # Update attributes
                            attributes = user_details.get('attributes', {})
                            attributes['linkedin_username'] = change['changes']['linkedin_username']
                            attributes['phone_number'] = change['changes']['phone_number']
                            
                            # Use a synchronous approach instead of creating a new event loop
                            import requests
                            url = f"{Config.AUTHENTIK_API_URL}/core/users/{change['id']}/"
                            response = requests.patch(url, headers=headers, json={'attributes': attributes})
                            if response.status_code in [200, 201, 202, 204]:
                                success_count += 1
                            else:
                                st.error(f"Failed to update {change['username']} via API. Status code: {response.status_code}")
                        except Exception as e:
                            st.error(f"Failed to update {change['username']}: {e}")
                    
                    if success_count > 0:
                        st.success(f"Successfully updated {success_count} of {len(changed_rows)} users.")
                        # Update the original dataframe to match the current state
                        st.session_state.original_df = edited_df.copy()
                        time.sleep(1)
                        st.rerun()
            
            # Get selected rows
            selected_rows = selection.get("selected_rows", [])
            
            if selected_rows:
                st.success(f"Selected {len(selected_rows)} users")
                st.session_state['selected_users'] = selected_rows
                st.subheader("Quick Actions")
                col1, col2, col3 = st.columns(3)
                with col1:
                    if st.button("View Details", key="view_details_btn"):
                        user_tabs[2].active = True
                with col2:
                    if st.button("Manage Groups", key="manage_groups_btn"):
                        user_tabs[1].active = True
                with col3:
                    all_active = all(row.get('Status', '').startswith('✅') for row in selected_rows)
                    status_action = "Deactivate" if all_active else "Activate"
                    if st.button(f"{status_action} Selected", key="toggle_status_btn"):
                        success_count = 0
                        for row in selected_rows:
                            user_id = row.get('ID')
                            result = update_user_status(
                                Config.AUTHENTIK_API_URL,
                                headers,
                                user_id,
                                not all_active
                            )
                            
                            if result:
                                success_count += 1
                        
                        if success_count == len(selected_rows):
                            st.success(f"Successfully {status_action.lower()}d {success_count} users")
                        else:
                            st.warning(f"Partially successful: {status_action.lower()}d {success_count} out of {len(selected_rows)} users")
                        time.sleep(1)
                        st.rerun()
                # --- User Info Edit Form ---
                if len(selected_rows) == 1:
                    user = selected_rows[0]
                    st.markdown("---")
                    st.subheader(f"Edit User Info: {user.get('Username', 'Unknown')}")
                    new_linkedin = st.text_input(
                        "LinkedIn Username",
                        value=user.get('LinkedIn', ''),
                        key=f"edit_linkedin_{user.get('ID')}"
                    )
                    new_phone = st.text_input(
                        "Phone Number",
                        value=user.get('Phone Number', ''),
                        key=f"edit_phone_{user.get('ID')}"
                    )
                    if st.button("Save Changes", key=f"save_user_info_{user.get('ID')}"):
                        # Fetch latest user details to get attributes
                        from app.auth.admin import get_user_details
                        user_details = get_user_details(user.get('ID'))
                        if user_details is None:
                            st.error("Failed to fetch user details. Cannot update info.")
                        else:
                            attributes = user_details.get('attributes', {})
                            attributes['linkedin_username'] = new_linkedin
                            attributes['phone_number'] = new_phone
                            url = f"{Config.AUTHENTIK_API_URL}/core/users/{user.get('ID')}/"
                            data = {'attributes': attributes}
                            import requests
                            try:
                                response = requests.patch(url, headers=headers, json=data)
                                response.raise_for_status()
                                st.success("User information updated successfully.")
                                time.sleep(1)
                                st.rerun()
                            except Exception as e:
                                st.error(f"Failed to update user info: {e}")
            else:
                st.info("Select one or more users to perform actions")
        else:
            st.warning("No users match the filter criteria.")
    
    # Tab 2: Bulk Operations
    with user_tabs[1]:
        st.subheader("Bulk Group Management")
        
        # Check if users are selected
        selected_users = st.session_state.get('selected_users', [])
        
        if not selected_users:
            st.info("Please select users from the User List tab first")
        else:
            st.write(f"Managing groups for {len(selected_users)} selected users:")
            
            # Display selected usernames
            st.write(", ".join([user.get('Username', 'Unknown') for user in selected_users]))
            
            # Get all available groups
            all_groups = get_authentik_groups()
            
            if not all_groups:
                st.warning("No groups found. Please create groups first.")
            else:
                # Create two columns for add/remove operations
                col1, col2 = st.columns(2)
                
                with col1:
                    st.subheader("Add to Groups")
                    groups_to_add = st.multiselect(
                        "Select groups to add users to",
                        options=[g.get('pk') for g in all_groups],
                        format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                        key="bulk_add_groups"
                    )
                    
                    if groups_to_add and st.button("Add to Selected Groups", key="bulk_add_btn"):
                        success_count = 0
                        for user in selected_users:
                            user_id = user.get('ID')
                            result = manage_user_groups(
                                st.session_state.get("username"),
                                user_id,
                                groups_to_add=groups_to_add
                            )
                            
                            if result.get('success'):
                                success_count += 1
                        
                        if success_count == len(selected_users):
                            st.success(f"Successfully added {success_count} users to the selected groups")
                        else:
                            st.warning(f"Partially successful: Added {success_count} out of {len(selected_users)} users to the selected groups")
                
                with col2:
                    st.subheader("Remove from Groups")
                    groups_to_remove = st.multiselect(
                        "Select groups to remove users from",
                        options=[g.get('pk') for g in all_groups],
                        format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                        key="bulk_remove_groups"
                    )
                    
                    if groups_to_remove and st.button("Remove from Selected Groups", key="bulk_remove_btn"):
                        success_count = 0
                        for user in selected_users:
                            user_id = user.get('ID')
                            result = manage_user_groups(
                                st.session_state.get("username"),
                                user_id,
                                groups_to_remove=groups_to_remove
                            )
                            
                            if result.get('success'):
                                success_count += 1
                        
                        if success_count == len(selected_users):
                            st.success(f"Successfully removed {success_count} users from the selected groups")
                        else:
                            st.warning(f"Partially successful: Removed {success_count} out of {len(selected_users)} users from the selected groups")
                
                # Add Bulk Email section
                st.markdown("---")
                st.subheader("Bulk Email")
                
                # Check if SMTP is configured
                if not Config.SMTP_ACTIVE:
                    st.warning("SMTP is not active. Please configure SMTP settings in your .env file to enable email functionality.")
                else:
                    with st.form("bulk_email_form"):
                        st.write(f"Send email to {len(selected_users)} selected users:")
                        
                        # Display email addresses that will receive the message
                        recipient_emails = [user.get('Email') for user in selected_users if user.get('Email')]
                        st.write(f"Recipients: {', '.join(recipient_emails)}")
                        
                        # Email form fields
                        email_subject = st.text_input("Subject", key="bulk_email_subject", placeholder="Enter email subject")
                        email_body = st.text_area("Message", key="bulk_email_body", height=200, placeholder="Enter your message here...")
                        
                        # Add HTML checkbox
                        is_html = st.checkbox("Send as HTML", value=True, key="bulk_email_is_html")
                        
                        # Submit button
                        submit_email = st.form_submit_button("Send Email to All Selected Users")
                        
                        if submit_email:
                            if not email_subject:
                                st.error("Please enter a subject for the email.")
                            elif not email_body:
                                st.error("Please enter a message for the email.")
                            else:
                                try:
                                    # Add admin signature
                                    admin_username = st.session_state.get("username", "Admin")
                                    signature = f"\n\nSent by {admin_username} from the Admin Dashboard"
                                    
                                    # Format the email body based on HTML setting
                                    if is_html:
                                        # Convert newlines to <br> tags if not already HTML
                                        if not email_body.strip().startswith("<"):
                                            email_body = email_body.replace("\n", "<br>")
                                        
                                        # Add HTML signature
                                        if not email_body.lower().endswith("</body>") and not email_body.lower().endswith("</html>"):
                                            email_body += f"<br><br><em>Sent by {admin_username} from the Admin Dashboard</em>"
                                    else:
                                        # Add plain text signature
                                        email_body += signature
                                    
                                    # Initialize counters
                                    success_count = 0
                                    failed_users = []
                                    
                                    # Create a progress bar
                                    progress = st.progress(0)
                                    total_users = len(recipient_emails)
                                    
                                    # Send emails to all selected users
                                    for idx, (user, email) in enumerate([(u, u.get('Email')) for u in selected_users if u.get('Email')]):
                                        try:
                                            # Update progress
                                            progress.progress((idx + 1) / total_users)
                                            
                                            # Send the email
                                            result = send_email(
                                                to=email,
                                                subject=email_subject,
                                                body=email_body
                                            )
                                            
                                            if result:
                                                # Log the email action
                                                with SessionLocal() as db:
                                                    create_admin_event(
                                                        db,
                                                        "email_sent",
                                                        st.session_state.get("username", "unknown"),
                                                        f"Bulk email sent to {user.get('Username')} ({email}) with subject: {email_subject}"
                                                    )
                                                success_count += 1
                                            else:
                                                failed_users.append(f"{user.get('Username')} ({email})")
                                        except Exception as e:
                                            logging.error(f"Error sending email to {email}: {str(e)}")
                                            failed_users.append(f"{user.get('Username')} ({email}): {str(e)}")
                                    
                                    # Display final results
                                    if success_count == total_users:
                                        st.success(f"Successfully sent emails to all {success_count} users")
                                    elif success_count > 0:
                                        st.warning(f"Partially successful: Sent emails to {success_count} out of {total_users} users")
                                        with st.expander("Failed recipients"):
                                            for user in failed_users:
                                                st.write(f"- {user}")
                                    else:
                                        st.error("Failed to send any emails. Check SMTP settings and try again.")
                                        with st.expander("Failed recipients"):
                                            for user in failed_users:
                                                st.write(f"- {user}")
                                
                                except Exception as e:
                                    logging.error(f"Error in bulk email: {str(e)}")
                                    st.error(f"An error occurred while sending emails: {str(e)}")
    
    # Tab 3: User Details
    with user_tabs[2]:
        st.subheader("User Details")
        
        # Check if users are selected
        selected_users = st.session_state.get('selected_users', [])
        
        if not selected_users:
            st.info("Please select users from the User List tab first")
        elif len(selected_users) > 1:
            st.info("Multiple users selected. Please select only one user to view details.")
        else:
            user = selected_users[0]
            
            # Create columns for user info and actions
            info_col, action_col = st.columns([2, 1])
            
            with info_col:
                st.subheader(f"{user.get('Name')} (@{user.get('Username')})")
                st.write(f"**Email:** {user.get('Email')}")
                st.write(f"**Status:** {user.get('Status')}")
                st.write(f"**Last Login:** {user.get('Last Login')}")
                
                # Get user groups
                user_groups = get_user_groups(user.get('ID'))
                
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
                    st.dataframe(group_df, hide_index=True)
                else:
                    st.info("User is not a member of any groups.")
            
            with action_col:
                st.subheader("User Actions")
                
                # Toggle active status
                is_active = user.get('Status', '').startswith('✅')
                status_action = "Deactivate" if is_active else "Activate"
                
                if st.button(f"{status_action} User", key="toggle_user_status"):
                    result = update_user_status(
                        Config.AUTHENTIK_API_URL,
                        headers,
                        user.get('ID'),
                        not is_active
                    )
                    
                    if result:
                        st.success(f"Successfully {status_action.lower()}d user {user.get('Username')}")
                        time.sleep(1)
                        st.rerun()
                    else:
                        st.error(f"Failed to {status_action.lower()} user {user.get('Username')}")
                
                # Update email
                st.subheader("Update Email")
                new_email = st.text_input("New Email Address", value=user.get('Email', ''), key="new_email")
                
                if st.button("Update Email", key="update_email_btn"):
                    if new_email != user.get('Email', ''):
                        result = update_user_email(
                            Config.AUTHENTIK_API_URL,
                            headers,
                            user.get('ID'),
                            new_email
                        )
                        
                        if result:
                            st.success(f"Successfully updated email for {user.get('Username')}")
                            time.sleep(1)
                            st.rerun()
                        else:
                            st.error(f"Failed to update email for {user.get('Username')}")
                    else:
                        st.info("Email address unchanged")
                
                # Admin privileges
                st.subheader("Admin Privileges")
                
                # Check if user is an admin
                with SessionLocal() as db:
                    try:
                        db_user = db.query(User).filter_by(username=user.get('Username')).first()
                        is_admin = db_user.is_admin if db_user else False
                    except Exception as e:
                        logging.error(f"Error checking admin status: {e}")
                        is_admin = False
                
                if is_admin:
                    if st.button(f"Revoke Admin Privileges", key=f"revoke_admin_detail"):
                        result = revoke_admin_privileges(
                            st.session_state.get("username"),
                            user.get('Username')
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully revoked admin privileges from {user.get('Username')}.")
                            time.sleep(1)
                            st.rerun()
                        else:
                            st.error(f"Failed to revoke admin privileges: {result.get('error')}")
                else:
                    if st.button(f"Grant Admin Privileges", key=f"grant_admin_detail"):
                        result = grant_admin_privileges(
                            st.session_state.get("username"),
                            user.get('Username')
                        )
                        
                        if result.get('success'):
                            st.success(f"Successfully granted admin privileges to {user.get('Username')}.")
                            time.sleep(1)
                            st.rerun()
                        else:
                            st.error(f"Failed to grant admin privileges: {result.get('error')}")
            
            # Create tabs for different user detail sections
            detail_tabs = st.tabs(["User Notes", "Send Email", "Activity"])
            
            # Tab 1: User Notes
            with detail_tabs[0]:
                st.subheader("Moderator Notes")
                
                # Get the user ID from the database
                with SessionLocal() as db:
                    try:
                        db_user = db.query(User).filter_by(username=user.get('Username')).first()
                        if db_user:
                            user_id = db_user.id
                            
                            # Add a new note
                            with st.form("add_note_form"):
                                st.write("Add a new note")
                                note_content = st.text_area("Note Content", key="new_note_content", height=100)
                                submit_note = st.form_submit_button("Add Note")
                                
                                if submit_note and note_content:
                                    result = create_user_note(
                                        db,
                                        user_id,
                                        note_content,
                                        st.session_state.get("username", "unknown")
                                    )
                                    
                                    if result:
                                        st.success(f"Note added for {user.get('Username')}")
                                        # Clear the form
                                        st.session_state["new_note_content"] = ""
                                        time.sleep(1)
                                        st.rerun()
                                    else:
                                        st.error(f"Failed to add note for {user.get('Username')}")
                            
                            # Display existing notes
                            notes = get_user_notes(db, user_id)
                            
                            if notes:
                                st.write(f"### Notes for {user.get('Username')} ({len(notes)})")
                                
                                for i, note in enumerate(notes):
                                    with st.expander(f"Note {i+1} - {note.created_at.strftime('%Y-%m-%d %H:%M')} by {note.created_by}", expanded=i==0):
                                        # Initialize session state for editing
                                        edit_key = f"edit_note_{note.id}"
                                        if edit_key not in st.session_state:
                                            st.session_state[edit_key] = False
                                        
                                        # Display note content or edit form
                                        if st.session_state[edit_key]:
                                            # Edit form
                                            edited_content = st.text_area(
                                                "Edit Note", 
                                                value=note.content, 
                                                key=f"edit_content_{note.id}",
                                                height=100
                                            )
                                            
                                            col1, col2 = st.columns(2)
                                            with col1:
                                                if st.button("Save Changes", key=f"save_note_{note.id}"):
                                                    result = update_user_note(
                                                        db,
                                                        note.id,
                                                        edited_content,
                                                        st.session_state.get("username", "unknown")
                                                    )
                                                    
                                                    if result:
                                                        st.success("Note updated successfully")
                                                        st.session_state[edit_key] = False
                                                        time.sleep(1)
                                                        st.rerun()
                                                    else:
                                                        st.error("Failed to update note")
                                            
                                            with col2:
                                                if st.button("Cancel", key=f"cancel_edit_{note.id}"):
                                                    st.session_state[edit_key] = False
                                                    st.rerun()
                                        else:
                                            # Display note
                                            st.markdown(note.content)
                                            
                                            # Show edit history if available
                                            if note.last_edited_by:
                                                st.caption(f"Last edited by {note.last_edited_by} on {note.updated_at.strftime('%Y-%m-%d %H:%M')}")
                                            
                                            # Edit and delete buttons
                                            col1, col2 = st.columns(2)
                                            with col1:
                                                if st.button("Edit", key=f"edit_btn_{note.id}"):
                                                    st.session_state[edit_key] = True
                                                    st.rerun()
                                            
                                            with col2:
                                                if st.button("Delete", key=f"delete_note_{note.id}"):
                                                    # Confirm deletion
                                                    confirm_key = f"confirm_delete_{note.id}"
                                                    st.session_state[confirm_key] = True
                                                    st.rerun()
                                        
                                        # Handle deletion confirmation
                                        confirm_key = f"confirm_delete_{note.id}"
                                        if st.session_state.get(confirm_key, False):
                                            st.warning("Are you sure you want to delete this note? This action cannot be undone.")
                                            col1, col2 = st.columns(2)
                                            with col1:
                                                if st.button("Yes, Delete", key=f"confirm_yes_{note.id}"):
                                                    result = delete_user_note(
                                                        db,
                                                        note.id,
                                                        st.session_state.get("username", "unknown")
                                                    )
                                                    
                                                    if result:
                                                        st.success("Note deleted successfully")
                                                        st.session_state[confirm_key] = False
                                                        time.sleep(1)
                                                        st.rerun()
                                                    else:
                                                        st.error("Failed to delete note")
                                            
                                            with col2:
                                                if st.button("Cancel", key=f"confirm_no_{note.id}"):
                                                    st.session_state[confirm_key] = False
                                                    st.rerun()
                            else:
                                st.info(f"No notes found for {user.get('Username')}")
                        else:
                            st.error(f"User {user.get('Username')} not found in the database")
                    except Exception as e:
                        logging.error(f"Error loading user notes: {e}")
                        st.error(f"Error loading user notes: {str(e)}")
            
            # Tab 2: Send Email
            with detail_tabs[1]:
                st.subheader("Send Email to User")
                
                # Check if SMTP is configured and active
                if not Config.SMTP_ACTIVE:
                    st.warning("SMTP is not active. Please enable SMTP in the settings to send emails.")
                elif not all([Config.SMTP_SERVER, Config.SMTP_PORT, Config.SMTP_USERNAME, Config.SMTP_PASSWORD, Config.SMTP_FROM_EMAIL]):
                    st.error("SMTP configuration is incomplete. Please check your SMTP settings.")
                else:
                    # Email form
                    with st.form("send_email_form"):
                        # Pre-fill the recipient field with the user's email
                        recipient_email = user.get('Email', '')
                        st.text_input("To", value=recipient_email, disabled=True, key="email_recipient")
                        
                        # Email subject
                        email_subject = st.text_input("Subject", key="email_subject", placeholder="Enter email subject")
                        
                        # Email body
                        email_body = st.text_area("Message", key="email_body", height=200, placeholder="Enter your message here...")
                        
                        # Add HTML checkbox
                        is_html = st.checkbox("Send as HTML", value=True, key="email_is_html")
                        
                        # Submit button
                        submit_email = st.form_submit_button("Send Email")
                        
                        if submit_email:
                            if not email_subject:
                                st.error("Please enter a subject for the email.")
                            elif not email_body:
                                st.error("Please enter a message for the email.")
                            else:
                                try:
                                    # Add admin signature if not already in the email body
                                    admin_username = st.session_state.get("username", "Admin")
                                    signature = f"\n\nSent by {admin_username} from the Admin Dashboard"
                                    
                                    # Format the email body based on HTML setting
                                    if is_html:
                                        # Convert newlines to <br> tags if not already HTML
                                        if not email_body.strip().startswith("<"):
                                            email_body = email_body.replace("\n", "<br>")
                                        
                                        # Add HTML signature
                                        if not email_body.lower().endswith("</body>") and not email_body.lower().endswith("</html>"):
                                            email_body += f"<br><br><em>Sent by {admin_username} from the Admin Dashboard</em>"
                                    else:
                                        # Add plain text signature
                                        email_body += signature
                                    
                                    # Send the email
                                    result = send_email(
                                        to=recipient_email,
                                        subject=email_subject,
                                        body=email_body
                                    )
                                    
                                    if result:
                                        # Log the email action
                                        with SessionLocal() as db:
                                            create_admin_event(
                                                db,
                                                "email_sent",
                                                st.session_state.get("username", "unknown"),
                                                f"Email sent to {user.get('Username')} ({recipient_email}) with subject: {email_subject}"
                                            )
                                        
                                        st.success(f"Email sent successfully to {user.get('Username')} ({recipient_email})")
                                        
                                        # Clear the form fields
                                        st.session_state["email_subject"] = ""
                                        st.session_state["email_body"] = ""
                                    else:
                                        st.error(f"Failed to send email to {recipient_email}. Check SMTP settings and try again.")
                                except Exception as e:
                                    logging.error(f"Error sending email: {str(e)}")
                                    st.error(f"An error occurred while sending the email: {str(e)}")
                    
                    # Show email history (placeholder for future enhancement)
                    with st.expander("Email History", expanded=False):
                        st.info("Email history tracking will be available in a future update.")
            
            # Tab 3: Activity (placeholder for future expansion)
            with detail_tabs[2]:
                st.info("User activity tracking will be available in a future update.")

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
                edited_df = st.data_editor(
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
                    height=400
                )
                
                # Get selected row
                selected_rows = edited_df.get("selected_rows", [])
                
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