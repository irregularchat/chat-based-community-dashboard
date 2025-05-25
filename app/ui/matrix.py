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
        # Direct message UI
        user_id = st.text_input("Matrix User ID (e.g., @username:domain.com)")
        
        # Display message history if user ID is provided
        if user_id and user_id.strip():
            display_matrix_message_history(user_id.strip())
        
        message = st.text_area("Message", height=150, key="direct_message")
        if st.button("Send Direct Message"):
            if user_id and message:
                room_id = await create_matrix_direct_chat(user_id)
                if room_id:
                    success = await send_matrix_message(room_id, message)
                    if success:
                        st.success(f"Message sent to {user_id}")
                        # Clear cached message history to force refresh
                        if f'matrix_message_history_{user_id.strip()}' in st.session_state:
                            del st.session_state[f'matrix_message_history_{user_id.strip()}']
                    else:
                        st.error(f"Failed to send message to {user_id}")
                else:
                    st.error(f"Failed to create direct chat with {user_id}")
            else:
                st.warning("Please enter both a user ID and a message")
    
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

def display_matrix_message_history(user_id):
    """Display the message history for a direct message conversation."""
    st.subheader("💬 Conversation History")
    
    # Create a button to load/refresh message history
    col1, col2 = st.columns([1, 4])
    with col1:
        if st.button("🔄 Load History", key=f"load_matrix_history_{user_id}"):
            st.session_state[f'loading_matrix_history_{user_id}'] = True
            st.session_state[f'matrix_message_history_{user_id}'] = None  # Reset to ensure fresh data
            st.rerun()
    
    with col2:
        st.write("*Click 'Load History' to view recent messages*")
    
    # Handle loading message history in background
    if st.session_state.get(f'loading_matrix_history_{user_id}', False):
        import threading
        
        if f'matrix_message_history_{user_id}' not in st.session_state or st.session_state[f'matrix_message_history_{user_id}'] is None:
            # Define the function to run in the background
            def load_history():
                try:
                    # Get message history using the sync wrapper
                    st.session_state[f'matrix_message_history_{user_id}'] = get_direct_message_history_sync(user_id, limit=20)
                    
                except Exception as e:
                    st.session_state[f'matrix_history_error_{user_id}'] = str(e)
                    logging.error(f"Error loading message history: {str(e)}", exc_info=True)
                finally:
                    st.session_state[f'loading_matrix_history_{user_id}'] = False
            
            # Start the background thread
            thread = threading.Thread(target=load_history)
            thread.start()
            st.info("Loading conversation history, please wait...")
            st.rerun()
            
        # Check if we have history or an error
        if f'matrix_history_error_{user_id}' in st.session_state:
            st.error(f"Error loading message history: {st.session_state[f'matrix_history_error_{user_id}']}")
            del st.session_state[f'matrix_history_error_{user_id}']
            st.session_state[f'loading_matrix_history_{user_id}'] = False
        
        if f'matrix_message_history_{user_id}' in st.session_state:
            st.session_state[f'loading_matrix_history_{user_id}'] = False
            display_matrix_chat_messages(st.session_state[f'matrix_message_history_{user_id}'])
        else:
            st.info("Loading conversation history...")
    else:
        # Display cached history if available
        if f'matrix_message_history_{user_id}' in st.session_state and st.session_state[f'matrix_message_history_{user_id}'] is not None:
            display_matrix_chat_messages(st.session_state[f'matrix_message_history_{user_id}'])
        else:
            st.info("Click 'Load History' to view recent messages with this user")

def display_matrix_chat_messages(messages):
    """Display chat messages in a conversation format."""
    if not messages:
        st.info("No message history found. This could be a new conversation or the room may not exist yet.")
        return
    
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