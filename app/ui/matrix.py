# app/ui/matrix.py
"""
This module provides a Streamlit interface for managing Matrix messaging.
It allows administrators to send messages to users and rooms, invite users to rooms,
and remove users from rooms. It uses a configured access token to authenticate with Matrix and uses room ids to identify rooms.
"""
import streamlit as st
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any
import os

from app.utils.matrix_actions import (
    send_matrix_message,
    create_matrix_direct_chat,
    invite_to_matrix_room,
    send_matrix_message_to_multiple_rooms,
    get_room_ids_by_category,
    invite_user_to_rooms_by_interests,
    get_all_accessible_rooms,
    get_joined_rooms,
    get_room_name,
    remove_from_matrix_room,
    get_all_accessible_users,
    send_direct_message,
    send_room_message,
    get_direct_message_history_sync
)
from app.db.session import get_db
from app.db.operations import User, AdminEvent, MatrixRoomMember, get_matrix_room_members
from app.utils.config import Config
from app.utils.recommendation import get_entrance_room_users, invite_user_to_recommended_rooms

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def render_matrix_messaging_page():
    """
    Render the Matrix messaging page in the Streamlit UI.
    This page allows administrators to send messages to users and rooms.
    """
    st.title("Matrix Messages and Rooms")
    
    if not Config.MATRIX_ACTIVE:
        st.warning("Matrix integration is not active. Set MATRIX_ACTIVE=True in your .env file to enable Matrix functionality.")
        return
    
    with st.expander("Room Configuration Help", expanded=False):
        st.markdown("""
        ### Matrix Room Configuration
        
        Rooms can be configured in your `.env` file using the `MATRIX_ROOM_IDS_NAME_CATEGORY` variable.
        
        **Format**: `Room Name|Room Category|!roomid:domain.com`
        
        Multiple categories can be specified with commas: `Room Name|Category1,Category2,Category3|!roomid:domain.com`
        
        **Examples**:
        ```
        # Semicolon-separated format:
        MATRIX_ROOM_IDS_NAME_CATEGORY = Tech Chat|Tech|!roomid:domain.com;AI Chat|Tech,AI|!roomid2:domain.com
        
        # Or on separate lines:
        MATRIX_ROOM_IDS_NAME_CATEGORY = Tech Chat|Tech|!roomid:domain.com
          AI Chat|Tech,AI|!roomid2:domain.com
        ```
        
        **Note**: The system will also discover rooms that the bot has access to but aren't explicitly configured.
        These will be labeled as "Uncategorized".
        """)
    
    # Get all rooms, including both configured and accessible
    matrix_rooms = Config.get_all_matrix_rooms()
    
    # Extract all unique categories
    all_categories = set()
    for room in matrix_rooms:
        if 'categories' in room and isinstance(room['categories'], list):
            for category in room['categories']:
                all_categories.add(category.strip())
        elif 'category' in room:
            # Handle comma-separated categories in the category field
            categories = [cat.strip() for cat in room['category'].split(',')]
            for category in categories:
                all_categories.add(category)
    
    # Sort categories
    sorted_categories = sorted(all_categories)
    
    # Create tabs for different messaging options
    tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(["Direct Message", "Room Message", "Bulk Message", "Invite to Rooms", "Remove from Rooms", "Entrance Room Users"])
    
    with tab1:
        st.header("Send Direct Message")
        
        # Initialize Matrix users in session state if not already done
        if 'matrix_users' not in st.session_state:
            st.session_state.matrix_users = []
        
        # Button to fetch Matrix users from entrance room
        col1, col2 = st.columns([1, 3])
        with col1:
            if st.button("🔄 Load Users", key="load_matrix_users"):
                with st.spinner("Loading Matrix users from all accessible rooms..."):
                    try:
                        # Import the function to get users from all accessible rooms
                        fetched_users = await get_all_accessible_users()
                        st.session_state.matrix_users = fetched_users or []
                        if fetched_users:
                            st.success(f"Loaded {len(fetched_users)} Matrix users from all rooms")
                        else:
                            st.warning("No Matrix users found in accessible rooms")
                    except Exception as e:
                        st.error(f"Error loading Matrix users: {str(e)}")
                        logging.error(f"Error loading Matrix users: {str(e)}")
                        st.session_state.matrix_users = []
        
        with col2:
            st.write("*Click 'Load Users' to fetch available Matrix users from all accessible rooms*")
        
        # Matrix User Selection - Multiple Users with efficient selection
        selected_user_ids = []
        
        # Initialize selected users in session state
        if 'selected_dm_users' not in st.session_state:
            st.session_state.selected_dm_users = []
        
        if st.session_state.matrix_users:
            st.write("**Select Matrix Users:**")
            
            # Create two columns for better layout
            col1, col2 = st.columns([2, 1])
            
            with col1:
                # Single user dropdown for adding users one by one
                matrix_user_options = [""] + [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users]
                selected_user = st.selectbox(
                    "Add a user:",
                    options=matrix_user_options,
                    key="dm_user_to_add",
                    help="Select a user to add to your message list"
                )
                
                # Add user button
                if st.button("➕ Add User", disabled=not selected_user):
                    if selected_user and selected_user not in st.session_state.selected_dm_users:
                        st.session_state.selected_dm_users.append(selected_user)
                        st.rerun()
            
            with col2:
                # Quick add all Signal users button
                signal_users = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users if user['user_id'].startswith('@signal_')]
                if signal_users:
                    if st.button(f"📱 Add All Signal Users ({len(signal_users)})"):
                        for signal_user in signal_users:
                            if signal_user not in st.session_state.selected_dm_users:
                                st.session_state.selected_dm_users.append(signal_user)
                        st.rerun()
                
                # Clear all button
                if st.session_state.selected_dm_users:
                    if st.button("🗑️ Clear All"):
                        st.session_state.selected_dm_users = []
                        st.rerun()
            
            # Display selected users with remove buttons
            if st.session_state.selected_dm_users:
                st.write(f"**Selected Users ({len(st.session_state.selected_dm_users)}):**")
                
                # Create a container for the selected users
                users_to_remove = []
                for i, user_option in enumerate(st.session_state.selected_dm_users):
                    col_user, col_remove = st.columns([4, 1])
                    with col_user:
                        user_id = user_option.split("(")[-1].rstrip(")")
                        display_name = user_option.split("(")[0].strip()
                        st.write(f"{i+1}. {display_name} ({user_id})")
                    with col_remove:
                        if st.button("❌", key=f"remove_user_{i}", help=f"Remove {display_name}"):
                            users_to_remove.append(user_option)
                
                # Remove users (do this after the loop to avoid modifying list during iteration)
                if users_to_remove:
                    for user_to_remove in users_to_remove:
                        st.session_state.selected_dm_users.remove(user_to_remove)
                    st.rerun()
                
                # Extract user_ids for sending
                selected_user_ids = []
                for user_option in st.session_state.selected_dm_users:
                    user_id = user_option.split("(")[-1].rstrip(")")
                    selected_user_ids.append(user_id)
        
        # Fallback: Manual input if no users loaded or user wants to enter manually
        if not st.session_state.matrix_users or st.checkbox("Enter Matrix User IDs manually", key="manual_user_input"):
            manual_user_ids = st.text_area(
                "Matrix User IDs (one per line, e.g., @username:domain.com)", 
                key="manual_matrix_user_ids",
                help="Enter Matrix User IDs manually, one per line, if not in the dropdown",
                height=100
            )
            if manual_user_ids and manual_user_ids.strip():
                # Parse multiple user IDs from text area
                manual_ids = [uid.strip() for uid in manual_user_ids.strip().split('\n') if uid.strip()]
                if manual_ids:
                    selected_user_ids.extend(manual_ids)
                    st.info(f"Added {len(manual_ids)} manual user IDs: {', '.join(manual_ids)}")
        
        # Message history is disabled for simplicity (encryption was removed)
        if selected_user_ids:
            st.info("💬 **Message History Disabled**: Message history requires encryption which has been disabled for simplicity. You can still send messages below.")
        

        # Message input and send button
        message = st.text_area("Message", height=150, key="direct_message")
        
        # Add confirmation for multiple users
        send_button_text = "Send Direct Message"
        if len(selected_user_ids) > 1:
            send_button_text = f"Send Message to {len(selected_user_ids)} Users"
        elif len(selected_user_ids) == 1:
            send_button_text = "Send Direct Message"
        
        # Add safety confirmation for multiple users
        confirm_send = True
        if len(selected_user_ids) > 3:  # Require confirmation for more than 3 users
            confirm_send = st.checkbox(
                f"⚠️ I confirm I want to send this message to {len(selected_user_ids)} users",
                key="confirm_bulk_dm"
            )
        
        if st.button(send_button_text, disabled=not confirm_send):
            if selected_user_ids and message:
                # Add no-reply footer to direct messages
                message_with_footer = f"{message}\n\n_NOREPLY: This message was sent from the admin dashboard_"
                
                # Show progress
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                success_count = 0
                failed_users = []
                
                # Loop through all selected users
                for i, user_id in enumerate(selected_user_ids):
                    status_text.text(f"Sending message to {user_id}...")
                    progress_bar.progress((i + 1) / len(selected_user_ids))
                    
                    try:
                        room_id = await create_matrix_direct_chat(user_id)
                        if room_id:
                            success = await send_matrix_message(room_id, message_with_footer)
                            if success:
                                success_count += 1
                            else:
                                failed_users.append(user_id)
                        else:
                            failed_users.append(user_id)
                    except Exception as e:
                        failed_users.append(user_id)
                        logging.error(f"Error sending message to {user_id}: {e}")
                
                # Show final results
                status_text.empty()
                progress_bar.empty()
                
                if success_count > 0:
                    st.success(f"✅ Message sent successfully to {success_count} out of {len(selected_user_ids)} users")
                
                if failed_users:
                    st.error(f"❌ Failed to send message to {len(failed_users)} users:")
                    for failed_user in failed_users:
                        st.write(f"  • {failed_user}")
                
                if success_count == len(selected_user_ids):
                    st.balloons()  # Celebrate if all messages sent successfully!
                    # Clear the selection after successful send
                    st.session_state.selected_dm_users = []
                    
            else:
                st.warning("Please select at least one user and enter a message")
    
    with tab2:
        st.header("Send Room Message")
        
        # Create a dropdown for category selection
        selected_category = st.selectbox("Filter by Category", ["All", *sorted_categories, "None"], key="room_category")
        
        # Filter rooms based on selected category
        filtered_rooms = filter_rooms_by_category(matrix_rooms, [selected_category])
        
        # Create a dropdown with filtered room names and IDs
        room_options = []
        for room in filtered_rooms:
            room_name = room.get('name') or "Unnamed Room"
            room_id = room.get('room_id')
            category = room.get('category', 'Uncategorized')
            
            # Add a marker for unconfigured rooms
            if not room.get('configured', True):
                room_name = f"{room_name} (Discovered)"
                
            room_options.append(f"{room_name} - {room_id}")
        
        selected_room = st.selectbox("Select Room", room_options, key="room_select")
        
        # Extract room ID from selection
        if selected_room:
            room_id = selected_room.split(" - ")[-1]
            message = st.text_area("Message", height=150, key="room_message")
            if st.button("Send Room Message"):
                if message:
                    success = await send_matrix_message(room_id, message)
                    if success:
                        st.success(f"Message sent to room {room_id}")
                    else:
                        st.error(f"Failed to send message to room {room_id}")
                else:
                    st.warning("Please enter a message to send")
    
    with tab3:
        st.header("Send Bulk Message")
        
        # Create multiselect for category selection
        selected_categories = st.multiselect(
            "Select Categories for Bulk Message", 
            ["All", *sorted_categories, "None"], 
            default=["All"],
            key="bulk_categories"
        )
        
        # If no categories are selected, default to "All"
        if not selected_categories:
            selected_categories = ["All"]
        
        # Get rooms in the selected categories
        rooms_in_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
        
        # Display the number of rooms in the selected categories
        category_names = ", ".join(f"'{cat}'" for cat in selected_categories)
        st.info(f"Found {len(rooms_in_categories)} rooms in the selected categories: {category_names}")
        
        # Show the list of rooms that will receive the message
        with st.expander("Show rooms that will receive the message"):
            for room in rooms_in_categories:
                room_name = room.get('name') or "Unnamed Room"
                room_id = room.get('room_id')
                
                # Add a marker for unconfigured rooms
                if not room.get('configured', True):
                    room_name = f"{room_name} (Discovered)"
                    
                st.write(f"• {room_name} - {room_id}")
        
        # Get the room IDs
        room_ids = [room.get('room_id') for room in rooms_in_categories if room.get('room_id')]
        
        message = st.text_area("Message", height=150, key="bulk_message")
        if st.button("Send to All Selected Rooms"):
            if room_ids and message:
                results = await send_matrix_message_to_multiple_rooms(room_ids, message)
                
                # Display results
                success_count = sum(1 for success in results.values() if success)
                st.success(f"Message sent to {success_count} out of {len(room_ids)} rooms in the selected categories")
                
                # Show details for failed rooms
                failed_rooms = [room_id for room_id, success in results.items() if not success]
                if failed_rooms:
                    st.error(f"Failed to send message to {len(failed_rooms)} rooms")
                    with st.expander("Show failed rooms"):
                        for room_id in failed_rooms:
                            st.write(room_id)
            else:
                if not room_ids:
                    st.warning(f"No rooms found in the selected categories")
                else:
                    st.warning("Please enter a message to send")
    
    with tab4:
        st.header("Invite User to Rooms")
        
        user_id = st.text_input("Matrix User ID (e.g., @username:domain.com)", key="invite_user_id")
        
        # Create multiselect for category selection
        selected_categories = st.multiselect(
            "Select Categories for Invitation", 
            ["All", *sorted_categories, "None"], 
            default=["All"],
            key="invite_categories"
        )
        
        # If no categories are selected, default to "All"
        if not selected_categories:
            selected_categories = ["All"]
        
        # Get rooms in the selected categories
        rooms_in_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
        
        # Display the number of rooms in the selected categories
        category_names = ", ".join(f"'{cat}'" for cat in selected_categories)
        st.info(f"Found {len(rooms_in_categories)} rooms in the selected categories: {category_names}")
        
        # Show the list of rooms that the user will be invited to
        with st.expander("Show rooms that the user will be invited to"):
            for room in rooms_in_categories:
                room_name = room.get('name') or "Unnamed Room"
                room_id = room.get('room_id')
                
                # Add a marker for unconfigured rooms
                if not room.get('configured', True):
                    room_name = f"{room_name} (Discovered)"
                    
                st.write(f"• {room_name} - {room_id}")
        
        # Get the room IDs
        room_ids = [room.get('room_id') for room in rooms_in_categories if room.get('room_id')]
        
        # Get username for welcome message
        username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
        
        # Option to send welcome message
        send_welcome = st.checkbox("Send welcome message after inviting", value=True)
        
        if st.button("Invite User to All Selected Rooms"):
            if user_id and room_ids:
                success_count = 0
                for room_id in room_ids:
                    success = await invite_to_matrix_room(room_id, user_id)
                    if success:
                        success_count += 1
                
                if success_count > 0:
                    st.success(f"User invited to {success_count} out of {len(room_ids)} rooms")
                    
                    if send_welcome:
                        # Send welcome message to each room
                        welcome_message = f"Welcome {username} to the room! 👋"
                        for room_id in room_ids:
                            await send_matrix_message(room_id, welcome_message)
                else:
                    st.error("Failed to invite user to any rooms")
            else:
                st.warning("Please enter a user ID and select at least one room")
    
    with tab5:
        st.header("Remove User from Rooms")
        
        user_id = st.text_input("Matrix User ID (e.g., @username:domain.com)", key="remove_user_id")
        
        # Create multiselect for category selection
        selected_categories = st.multiselect(
            "Select Categories for Removal", 
            ["All", *sorted_categories, "None"], 
            default=["All"],
            key="remove_categories"
        )
        
        # If no categories are selected, default to "All"
        if not selected_categories:
            selected_categories = ["All"]
        
        # Get rooms in the selected categories
        rooms_in_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
        
        # Display the number of rooms in the selected categories
        category_names = ", ".join(f"'{cat}'" for cat in selected_categories)
        st.info(f"Found {len(rooms_in_categories)} rooms in the selected categories: {category_names}")
        
        # Show the list of rooms that the user will be removed from
        with st.expander("Show rooms that the user will be removed from"):
            for room in rooms_in_categories:
                room_name = room.get('name') or "Unnamed Room"
                room_id = room.get('room_id')
                
                # Add a marker for unconfigured rooms
                if not room.get('configured', True):
                    room_name = f"{room_name} (Discovered)"
                    
                st.write(f"• {room_name} - {room_id}")
        
        # Get the room IDs
        room_ids = [room.get('room_id') for room in rooms_in_categories if room.get('room_id')]
        
        if st.button("Remove User from All Selected Rooms"):
            if user_id and room_ids:
                success_count = 0
                for room_id in room_ids:
                    success = await remove_from_matrix_room(room_id, user_id)
                    if success:
                        success_count += 1
                
                if success_count > 0:
                    st.success(f"User removed from {success_count} out of {len(room_ids)} rooms")
                else:
                    st.error("Failed to remove user from any rooms")
            else:
                st.warning("Please enter a user ID and select at least one room")
    
    with tab6:
        st.header("Entrance Room Users")
        st.subheader("Connect users from INDOC room with dashboard accounts")
        
        # Get entrance room ID
        entrance_room_id = "!bPROVgpotAcdXGxXUN:irregularchat.com"  # IrregularChat Entry/INDOC
        
        # Button to refresh user list
        if st.button("Refresh Entrance Room Users", key="refresh_entrance_users"):
            st.session_state['entrance_users_refreshed'] = True
        
        # Get users from entrance room
        with st.spinner("Loading entrance room users..."):
            entrance_users = await get_entrance_room_users()
            
        # Display user count
        st.info(f"Found {len(entrance_users)} non-admin users in the entrance room")
        
        # Create a dataframe to display users
        if entrance_users:
            import pandas as pd
            
            # Create dataframe with user information
            users_data = []
            for user in entrance_users:
                user_id = user['user_id']
                display_name = user['display_name']
                username = user_id.split(":")[0].lstrip("@")
                
                users_data.append({
                    "Username": username,
                    "Display Name": display_name,
                    "Matrix ID": user_id
                })
            
            # Convert to dataframe
            df = pd.DataFrame(users_data)
            
            # Display the dataframe
            st.dataframe(df)
            
            # Step 1: Select Matrix user from INDOC
            selected_matrix_user = st.selectbox(
                "Select Matrix user from INDOC:",
                options=[user['user_id'] for user in entrance_users],
                format_func=lambda x: f"{x.split(':')[0].lstrip('@')} ({next((u['display_name'] for u in entrance_users if u['user_id'] == x), '')})"
            )
            
            if selected_matrix_user:
                matrix_username = selected_matrix_user.split(':')[0].lstrip('@')
                matrix_display_name = next((u['display_name'] for u in entrance_users if u['user_id'] == selected_matrix_user), '')
                
                # Step 2: Get dashboard users to connect with
                db = next(get_db())
                dashboard_users = db.query(User).all()
                
                # Create a list of users for selection
                dashboard_user_options = [(user.id, f"{user.first_name} {user.last_name} ({user.username})") for user in dashboard_users]
                
                # Select dashboard user to connect
                selected_dashboard_user = st.selectbox(
                    "Connect to dashboard user:",
                    options=[user[0] for user in dashboard_user_options],
                    format_func=lambda x: next((user[1] for user in dashboard_user_options if user[0] == x), ""),
                    key="dashboard_user_select"
                )
                
                if selected_dashboard_user:
                    # Get selected user details
                    selected_user = next((user for user in dashboard_users if user.id == selected_dashboard_user), None)
                    if selected_user:
                        # Show user details
                        col1, col2 = st.columns(2)
                        with col1:
                            st.subheader("Matrix User")
                            st.write(f"**Username:** {matrix_username}")
                            st.write(f"**Display Name:** {matrix_display_name}")
                            st.write(f"**ID:** {selected_matrix_user}")
                        
                        with col2:
                            st.subheader("Dashboard User")
                            st.write(f"**Username:** {selected_user.username}")
                            st.write(f"**Name:** {selected_user.first_name} {selected_user.last_name}")
                            st.write(f"**Email:** {selected_user.email}")
                            
                            # Extract interests from user attributes
                            interests = ""
                            if hasattr(selected_user, 'attributes') and selected_user.attributes:
                                attrs = selected_user.attributes
                                if isinstance(attrs, dict):
                                    if 'intro' in attrs:
                                        intro = attrs['intro']
                                        if isinstance(intro, dict) and 'interests' in intro:
                                            interests = intro['interests']
                                    elif 'interests' in attrs:
                                        interests = attrs['interests']
                            
                            if interests:
                                st.write(f"**Interests:** {interests}")
                            else:
                                # Input field for interests if not found
                                interests = st.text_input(
                                    "Enter user interests (comma separated):",
                                    key="dashboard_user_interests",
                                    help="Enter interests to match with room categories"
                                )
                        
                        # Connect users and invite to rooms
                        if st.button("Connect User and Invite to Recommended Rooms", key="connect_and_invite_button"):
                            try:
                                # Update user attributes to store connection
                                if not hasattr(selected_user, 'attributes') or not selected_user.attributes:
                                    selected_user.attributes = {}
                                
                                if isinstance(selected_user.attributes, dict):
                                    selected_user.attributes["matrix_user_id"] = selected_matrix_user
                                    db.commit()
                                    st.success(f"Connected {selected_user.username} with Matrix user {matrix_username}")
                                
                                # Invite to recommended rooms if interests provided
                                if interests:
                                    with st.spinner("Finding and inviting to recommended rooms..."):
                                        # Invite user to recommended rooms
                                        room_results = await invite_user_to_recommended_rooms(selected_matrix_user, interests)
                                        
                                        # Create results table
                                        results_data = []
                                        for room_id, room_name, success in room_results:
                                            results_data.append({
                                                "Room Name": room_name,
                                                "Room ID": room_id,
                                                "Invitation Status": "✅ Successful" if success else "❌ Failed"
                                            })
                                        
                                        # Display results
                                        st.subheader("Invitation Results")
                                        results_df = pd.DataFrame(results_data)
                                        st.dataframe(results_df)
                                        
                                        # Success message
                                        successful_invites = sum(1 for _, _, success in room_results if success)
                                        st.success(f"Successfully invited user to {successful_invites} out of {len(room_results)} rooms")
                                else:
                                    st.warning("No interests provided. Could not recommend rooms.")
                            except Exception as e:
                                st.error(f"Error connecting users: {str(e)}")
                                logger.error(f"Error connecting users: {str(e)}")
            
            # Alternative option for just inviting to rooms without connection
            st.markdown("---")
            st.subheader("Or just invite to recommended rooms")
            
            # User selection for recommendations without connecting
            selected_user_for_invite = st.selectbox(
                "Select a Matrix user to invite to rooms:",
                options=[user['user_id'] for user in entrance_users],
                format_func=lambda x: f"{x.split(':')[0].lstrip('@')} ({next((u['display_name'] for u in entrance_users if u['user_id'] == x), '')})",
                key="invite_only_user"
            )
            
            if selected_user_for_invite:
                # Input for interests
                invite_interests = st.text_input(
                    "Enter user interests (comma separated):",
                    key="entrance_user_interests",
                    help="Enter interests to match with room categories"
                )
                
                # Button to recommend and invite
                if st.button("Recommend and Invite to Rooms", key="recommend_rooms_button"):
                    if invite_interests:
                        with st.spinner("Finding and inviting to recommended rooms..."):
                            # Invite user to recommended rooms
                            room_results = await invite_user_to_recommended_rooms(selected_user_for_invite, invite_interests)
                            
                            # Create results table
                            results_data = []
                            for room_id, room_name, success in room_results:
                                results_data.append({
                                    "Room Name": room_name,
                                    "Room ID": room_id,
                                    "Invitation Status": "✅ Successful" if success else "❌ Failed"
                                })
                            
                            # Display results
                            st.subheader("Invitation Results")
                            results_df = pd.DataFrame(results_data)
                            st.dataframe(results_df)
                            
                            # Success message
                            successful_invites = sum(1 for _, _, success in room_results if success)
                            st.success(f"Successfully invited user to {successful_invites} out of {len(room_results)} rooms")
                    else:
                        st.warning("Please enter user interests to match with rooms")
        else:
            st.warning("No non-admin users found in the entrance room")

def display_matrix_chat_messages(messages):
    """Display chat messages in a conversation format."""
    if not messages:
        st.info("No message history found. This could be a new conversation or the room may not exist yet.")
        return
    
    # Check if we have encrypted messages and provide helpful guidance
    encrypted_counts = {}
    for msg in messages:
        status = msg.get('decryption_status', 'unknown')
        if 'encrypted' in status:
            encrypted_counts[status] = encrypted_counts.get(status, 0) + 1
    
    total_encrypted = sum(encrypted_counts.values())
    if total_encrypted > 0:
        st.info(f"🔐 **Message History Found**: {len(messages)} messages total, {total_encrypted} are encrypted")
        
        # Show specific guidance for different encryption statuses
        if encrypted_counts.get('encrypted_historical_signal', 0) > 0:
            st.warning(f"📱 **Signal Bridge Messages**: {encrypted_counts['encrypted_historical_signal']} encrypted Signal messages detected. "
                     f"These were sent before the bot had access to encryption keys. "
                     f"New messages will be readable in real-time.")
        
        if encrypted_counts.get('encrypted_historical', 0) > 0:
            st.warning(f"🔐 **Historical Encrypted Messages**: {encrypted_counts['encrypted_historical']} encrypted Matrix messages detected. "
                     f"These were sent before the bot joined the conversation. "
                     f"New messages will be readable in real-time.")
        
        # Show success for any decrypted messages
        decrypted_count = sum(1 for msg in messages if msg.get('decryption_status') in ['plaintext', 'auto_decrypted', 'manual_decrypted'])
        if decrypted_count > 0:
            st.success(f"✅ **Readable Messages**: {decrypted_count} messages are readable")
        
        # Add helpful note about manual key backup
        with st.expander("🔑 About Message Encryption"):
            st.markdown("""
            **Why are some messages encrypted?**
            - Matrix uses end-to-end encryption for secure messaging
            - Historical messages require the original encryption keys to decrypt
            - The bot can only decrypt messages sent after it joined the conversation
            
            **For Signal Bridge Messages:**
            - Signal messages are always encrypted for security
            - Historical Signal messages cannot be decrypted without the original keys
            - New Signal messages will be readable as they arrive
            
            **Key Recovery Options:**
            - Manual key backup/restore through Matrix client
            - Cross-signing device verification
            - Security key recovery (if configured)
            """)
    
    st.write(f"**Showing {len(messages)} recent messages:**")
    
    # Create a container for the chat messages
    chat_container = st.container()
    
    with chat_container:
        # Display messages in a scrollable format
        for message in messages:
            # Create columns for message layout
            if message.get('is_bot_message', False):
                # Bot message (right-aligned)
                col1, col2 = st.columns([1, 3])
                with col2:
                    st.markdown(f"""
                    <div style="background-color: #e3f2fd; padding: 10px; border-radius: 10px; margin: 5px 0; text-align: right;">
                        <strong>🤖 Bot</strong><br>
                        {message.get('content', '')}
                        <br><small style="color: #666;">{message.get('formatted_time', '')}</small>
                    </div>
                    """, unsafe_allow_html=True)
            else:
                # User message (left-aligned)
                col1, col2 = st.columns([3, 1])
                with col1:
                    # Extract display name from sender
                    sender = message.get('sender', '')
                    display_name = sender.split(':')[0].replace('@', '') if sender else 'User'
                    
                    st.markdown(f"""
                    <div style="background-color: #f5f5f5; padding: 10px; border-radius: 10px; margin: 5px 0;">
                        <strong>👤 {display_name}</strong><br>
                        {message.get('content', '')}
                        <br><small style="color: #666;">{message.get('formatted_time', '')}</small>
                    </div>
                    """, unsafe_allow_html=True)
    
    # Add a separator
    st.markdown("---")

def filter_rooms_by_category(rooms, selected_categories):
    """
    Filter rooms based on the selected categories.
    
    Args:
        rooms: List of room dictionaries
        selected_categories: List of categories to filter by
        
    Returns:
        List[Dict]: Filtered list of rooms
    """
    # If "All" is selected, return all rooms
    if "All" in selected_categories:
        return rooms
    
    filtered_rooms = []
    for room in rooms:
        # Handle "None" category
        if "None" in selected_categories:
            has_category = False
            if 'categories' in room and isinstance(room['categories'], list):
                has_category = len(room['categories']) > 0
            elif 'category' in room:
                has_category = bool(room['category'])
            
            if not has_category:
                filtered_rooms.append(room)
                continue
        
        # Check if any of the selected categories match the room's categories
        for selected_category in selected_categories:
            if selected_category == "None":
                continue  # Already handled above
                
            # Check if the selected category is in the room's categories
            if 'categories' in room and isinstance(room['categories'], list):
                if selected_category in [cat.strip() for cat in room['categories']]:
                    filtered_rooms.append(room)
                    break  # No need to check other categories
            elif 'category' in room:
                # Handle comma-separated categories in the category field
                categories = [cat.strip() for cat in room['category'].split(',')]
                if selected_category in categories:
                    filtered_rooms.append(room)
                    break  # No need to check other categories
    
    return filtered_rooms 