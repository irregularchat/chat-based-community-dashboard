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
    send_room_message
)
from app.db.session import get_db
from app.db.operations import User, AdminEvent, MatrixRoomMember, get_matrix_room_members
from app.utils.config import Config

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
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["Direct Message", "Room Message", "Bulk Message", "Invite to Rooms", "Remove from Rooms"])
    
    with tab1:
        st.header("Send Direct Message")
        # Direct message UI
        user_id = st.text_input("Matrix User ID (e.g., @username:domain.com)")
        message = st.text_area("Message", height=150, key="direct_message")
        if st.button("Send Direct Message"):
            if user_id and message:
                room_id = await create_matrix_direct_chat(user_id)
                if room_id:
                    success = await send_matrix_message(room_id, message)
                    if success:
                        st.success(f"Message sent to {user_id}")
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