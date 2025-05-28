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
import json

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
    remove_from_matrix_room_async,
    send_direct_message,
    send_room_message,
    get_direct_message_history_sync,
    _send_room_message_with_content_async
)
from app.db.session import get_db
from app.db.operations import User, AdminEvent, MatrixRoomMember, get_matrix_room_members, create_admin_event
from app.db.models import MatrixRoomMembership
from app.utils.config import Config
from app.utils.recommendation import get_entrance_room_users, invite_user_to_recommended_rooms
from app.services.matrix_cache import matrix_cache

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def save_user_categories():
    """Save user categories to JSON file for persistence."""
    try:
        categories_file = "user_categories.json"
        with open(categories_file, 'w') as f:
            json.dump(st.session_state.user_categories, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving user categories: {e}")

# Callback function for the 'Load Users' button
def on_load_users_click():
    logger.info("'Load Users' (on_click) triggered. Attempting to load from cache.")
    st.session_state.load_users_processing = True # Flag to show spinner

async def process_load_users():
    # This function will run after the on_click sets the flag
    if st.session_state.get('load_users_processing', False):
            try:
                db = next(get_db())
                try:
                    logger.info("Calling matrix_cache.get_cached_users() inside process_load_users...")
                    cached_users = matrix_cache.get_cached_users(db)
                    logger.info(f"Retrieved {len(cached_users) if cached_users else 0} users from MatrixUserCache.")
                    
                    if cached_users:
                        logger.info(f"First 3 cached users (process_load_users): {cached_users[:3]}")
                    
                    formatted_users = [
                        {'user_id': user['user_id'], 'display_name': user['display_name']}
                        for user in cached_users
                    ] if cached_users else []
                    
                    st.session_state.matrix_users = formatted_users
                    logger.info(f"Set st.session_state.matrix_users with {len(formatted_users)} users (process_load_users).")

                    if formatted_users:
                        st.success(f"✅ Loaded {len(formatted_users)} Matrix users from cache")
                        st.info("💡 Users are now cached - adding users will be instant!")
                    else:
                        st.warning("No Matrix users found in cache. Please run a manual sync if needed.")
                        logger.warning("No users found in MatrixUserCache via process_load_users.")
                        
                    if not matrix_cache.is_cache_fresh(db, max_age_minutes=30):
                        logger.info("Cache is stale (process_load_users), triggering background_sync.")
                        # Simplified async call for background sync
                        asyncio.create_task(matrix_cache.background_sync(db_session=db, max_age_minutes=30))
                        st.toast("🔄 Cache is stale, background sync triggered.", icon="ℹ️")
                    else:
                        logger.info("Cache is fresh (process_load_users), no background sync triggered.")
                        
                except Exception as e_load:
                    st.error(f"Error loading users from cache (process_load_users): {str(e_load)}")
                    logger.error(f"Error loading users from cache (process_load_users): {str(e_load)}", exc_info=True)
                finally:
                    db.close()
                    logger.info("Database session closed after process_load_users.")
            except Exception as e_main:
                st.error(f"Error in process_load_users logic: {str(e_main)}")
                logger.error(f"Error in process_load_users logic: {str(e_main)}", exc_info=True)
            finally:
                st.session_state.load_users_processing = False # Reset flag
                # No st.rerun() here, let Streamlit handle it naturally after callback

# New callback for the user selection multiselect
def on_user_multiselect_change():
    logger.info("'User Multiselect' (on_change) triggered.")
    # The multiselect's state (dm_users_to_add) becomes the new selected_dm_users list
    st.session_state.selected_dm_users = st.session_state.dm_users_to_add
    logger.info(f"Updated selected_dm_users to {len(st.session_state.selected_dm_users)} users based on multiselect.")

async def render_matrix_messaging_page():
    """
    Render the Matrix messaging page in the Streamlit UI.
    This page allows administrators to send messages to users and rooms.
    """
    st.title("Matrix Messages and Rooms")
    
    if not Config.MATRIX_ACTIVE:
        st.warning("Matrix integration is not active. Set MATRIX_ACTIVE=True in your .env file to enable Matrix functionality.")
        return
    
    # Get all rooms, including both configured and accessible
    # Cache rooms in session state to avoid fetching on every page load
    if 'cached_matrix_rooms' not in st.session_state or st.session_state.get('matrix_rooms_cache_time', 0) < (datetime.now().timestamp() - 300):  # Cache for 5 minutes
        try:
            st.session_state.cached_matrix_rooms = Config.get_all_matrix_rooms()
            st.session_state.matrix_rooms_cache_time = datetime.now().timestamp()
            logger.info(f"Refreshed matrix rooms cache with {len(st.session_state.cached_matrix_rooms)} rooms")
        except Exception as e:
            logger.error(f"Error loading matrix rooms: {e}")
            st.error(f"Error loading matrix rooms: {e}")
            st.session_state.cached_matrix_rooms = []
            st.session_state.matrix_rooms_cache_time = datetime.now().timestamp()
    
    matrix_rooms = st.session_state.cached_matrix_rooms
    
    # Add room cache info and refresh button
    col1, col2, col3 = st.columns([2, 1, 1])
    with col1:
        if 'matrix_rooms_cache_time' in st.session_state:
            cache_age = datetime.now().timestamp() - st.session_state.matrix_rooms_cache_time
            cache_age_str = f"{int(cache_age // 60)}m {int(cache_age % 60)}s ago"
            st.info(f"📋 **{len(matrix_rooms)} rooms cached** (refreshed {cache_age_str})")
        else:
            st.info(f"📋 **{len(matrix_rooms)} rooms loaded**")
    
    with col2:
        if st.button("🔄 Refresh Rooms", help="Force refresh room list from Matrix"):
            try:
                st.session_state.cached_matrix_rooms = Config.get_all_matrix_rooms()
                st.session_state.matrix_rooms_cache_time = datetime.now().timestamp()
                st.success("✅ Room list refreshed!")
                st.rerun()
            except Exception as e:
                logger.error(f"Error refreshing rooms: {e}")
                st.error(f"Error refreshing rooms: {e}")
    
    with col3:
        # Show cache status
        if 'matrix_rooms_cache_time' in st.session_state:
            cache_age = datetime.now().timestamp() - st.session_state.matrix_rooms_cache_time
            if cache_age > 300:  # 5 minutes
                st.warning("⚠️ Cache stale")
            else:
                st.success("✅ Cache fresh")
    
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
        
                **Performance**: Room data is cached for 5 minutes to improve page load speed. Use the "Refresh Rooms" button to force an update.
        """)
    
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
    
    # Call the processing function if the flag is set
    # This needs to be called early in the render, before the button itself typically
    try:
        await process_load_users()
    except Exception as e:
        logger.error(f"Error in process_load_users: {e}")
        # Continue rendering even if this fails
    
    # Create tabs for different messaging options
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["Direct Message", "Room Messaging", "Invite to Rooms", "Remove from Rooms", "Entrance Room Users"])
    
    with tab1:
        st.header("Send Direct Message")
        
        if 'matrix_users' not in st.session_state:
            st.session_state.matrix_users = []
        
        col1, col2, col3 = st.columns([1, 1, 2])
        with col1:
            st.button("🔄 Load Users", key="load_matrix_users_btn", on_click=on_load_users_click)
        
        with col2:
            if st.button("🔄 Manual Sync", key="manual_sync_users", help="Force a full sync of Matrix data"):
                with st.spinner("Running full Matrix sync..."):
                    try:
                        db = next(get_db())
                        try:
                            sync_result = await matrix_cache.full_sync(db, force=True)
                            if sync_result["status"] == "completed":
                                st.success(f"✅ Sync completed! Users: {sync_result['users_synced']}, Rooms: {sync_result['rooms_synced']}")
                                # Reload users after sync
                                cached_users = matrix_cache.get_cached_users(db)
                                st.session_state.matrix_users = [
                                    {
                                        'user_id': user['user_id'],
                                        'display_name': user['display_name']
                                    }
                                    for user in cached_users
                                ]
                            else:
                                st.error(f"Sync failed: {sync_result.get('error', 'Unknown error')}")
                        except Exception as sync_error:
                            logger.error(f"Error during manual sync: {sync_error}")
                            st.error(f"Error during manual sync: {sync_error}")
                        finally:
                            db.close()
                    except Exception as e:
                        st.error(f"Error during manual sync: {str(e)}")
                        logging.error(f"Error during manual sync: {str(e)}")
        
        with col3:
            if st.session_state.matrix_users:
                st.write(f"✅ **{len(st.session_state.matrix_users)} users loaded** - Ready for fast selection!")
            else:
                st.write("*Click 'Load Users' to fetch from cache or 'Manual Sync' to sync from Matrix*")
        
        # Matrix User Selection - Multiple Users with efficient selection
        selected_user_ids = []
        
        # Initialize selected users and user categories in session state
        if 'selected_dm_users' not in st.session_state:
            st.session_state.selected_dm_users = []
        if 'user_categories' not in st.session_state:
            # Load categories from file if it exists
            categories_file = "user_categories.json"
            try:
                if os.path.exists(categories_file):
                    with open(categories_file, 'r') as f:
                        st.session_state.user_categories = json.load(f)
                else:
                    st.session_state.user_categories = {}
            except Exception as e:
                logger.error(f"Error loading user categories: {e}")
                st.session_state.user_categories = {}
        
        if st.session_state.matrix_users:
            # User Categories Section
            if st.session_state.user_categories:
                st.write("**📁 Saved User Categories:**")
                category_col1, category_col2 = st.columns([3, 1])
                
                with category_col1:
                    category_options = [""] + list(st.session_state.user_categories.keys())
                    selected_category = st.selectbox(
                        "Load a saved category:",
                        options=category_options,
                        key="load_category_select",
                        help="Select a saved user category to load all users from that group"
                    )
                
                with category_col2:
                    if st.button("📂 Load Category", disabled=not selected_category):
                        if selected_category in st.session_state.user_categories:
                            # Add all users from the category to selected users
                            category_users = st.session_state.user_categories[selected_category]
                            for user in category_users:
                                if user not in st.session_state.selected_dm_users:
                                    st.session_state.selected_dm_users.append(user)
                            st.success(f"Loaded {len(category_users)} users from '{selected_category}' category")
                            st.rerun()
                
                # Show existing categories with user counts
                with st.expander("📋 View All Categories", expanded=False):
                    for cat_name, cat_users in st.session_state.user_categories.items():
                        col_cat, col_del = st.columns([4, 1])
                        with col_cat:
                            st.write(f"**{cat_name}** ({len(cat_users)} users)")
                            for user in cat_users:
                                display_name = user.split("(")[0].strip()
                                st.write(f"  • {display_name}")
                        with col_del:
                            if st.button("🗑️", key=f"delete_cat_{cat_name}", help=f"Delete '{cat_name}' category"):
                                del st.session_state.user_categories[cat_name]
                                save_user_categories()  # Save to file
                                st.rerun()
                
                st.markdown("---")
            
            # --- New Section: Add Users by Room --- #
            st.write("**🏠 Add Users by Room Membership:**")
            room_select_col1, room_select_col2 = st.columns([3, 1])
            
            with room_select_col1:
                db = next(get_db())
                try:
                    all_cached_rooms = matrix_cache.get_cached_rooms(db)
                    eligible_rooms = [
                        room for room in all_cached_rooms 
                        if room.get('member_count', 0) >= Config.MATRIX_MIN_ROOM_MEMBERS
                    ]
                    room_options = {
                        f"{room.get('name', 'Unnamed Room')} ({room.get('room_id')}) - {room.get('member_count', 0)} members": room.get('room_id') 
                        for room in eligible_rooms
                    }
                    selected_room_display_names = st.multiselect(
                        "Select room(s) to add users from:",
                        options=list(room_options.keys()),
                        key="dm_rooms_to_add_users_from",
                        help=f"Rooms with at least {Config.MATRIX_MIN_ROOM_MEMBERS} members. Users will be added to recipients."
                    )
                finally:
                    db.close()

            with room_select_col2:
                if st.button("➕ Add Users from Selected Rooms", disabled=not selected_room_display_names, key="add_users_from_rooms_btn"):
                    if selected_room_display_names:
                        selected_room_ids_to_add = [room_options[name] for name in selected_room_display_names]
                        db = next(get_db())
                        added_count = 0
                        total_users_from_rooms = 0
                        try:
                            for room_id_to_add in selected_room_ids_to_add:
                                users_in_room = matrix_cache.get_users_in_room(db, room_id_to_add) # Needs this method in MatrixCacheService
                                total_users_from_rooms += len(users_in_room)
                                for user_detail in users_in_room:
                                    user_option = f"{user_detail['display_name']} ({user_detail['user_id']})"
                                    if user_option not in st.session_state.selected_dm_users:
                                        st.session_state.selected_dm_users.append(user_option)
                                        added_count += 1
                            if added_count > 0:
                                st.success(f"✅ Added {added_count} unique users from {len(selected_room_ids_to_add)} selected room(s) (total {total_users_from_rooms} users considered).")
                            else:
                                st.info("No new users added. They might already be in the recipient list or rooms were empty/had no new users.")
                            st.rerun() # To update the main user multiselect and recipient list display
                        finally:
                            db.close()
            st.markdown("---")
            # --- End New Section --- #

            st.write("**Select Matrix Users (Recipients):**")
            
            # Create two columns for better layout
            col1, col2 = st.columns([2, 1])
            
            with col1:
                # Multi-select for adding/removing users directly to/from recipient list
                matrix_user_options = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users]
                
                st.multiselect(
                    f"Select recipients ({len(matrix_user_options)} available):",
                    options=matrix_user_options,
                    key="dm_users_to_add", # This key holds the multiselect's current state
                    default=st.session_state.selected_dm_users, # Initialize with current recipients
                    on_change=on_user_multiselect_change,
                    help="Select/deselect users. The recipient list updates automatically."
                )
                
                # Show current recipient count (derived from selected_dm_users)
                if st.session_state.selected_dm_users:
                    st.info(f"📋 Recipients: {len(st.session_state.selected_dm_users)} users")
                
                # The "Add Selected Users" button is now removed.
                # Logic previously here is handled by on_user_multiselect_change.
            
            with col2:
                # Quick add all Signal users button (from cached data)
                signal_users = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users if user['user_id'].startswith('@signal_')]
                available_signal_users = [user for user in signal_users if user not in st.session_state.selected_dm_users]
                
                if available_signal_users:
                    if st.button(f"📱 Add All Signal Users ({len(available_signal_users)})"):
                        added_count = 0
                        for signal_user in available_signal_users:
                            st.session_state.selected_dm_users.append(signal_user)
                            added_count += 1
                        st.success(f"✅ Added {added_count} Signal users")
                        st.rerun()
                elif signal_users:
                    st.info("📱 All Signal users already selected")
                
                # Clear all button
                if st.session_state.selected_dm_users:
                    if st.button("🗑️ Clear All"):
                        st.session_state.selected_dm_users = []
                        st.success("🗑️ Cleared all selected users")
                        st.rerun()
            
            # Display selected users with remove buttons in a more compact format
            if st.session_state.selected_dm_users:
                st.markdown("---")
                st.write(f"**📋 Selected Users ({len(st.session_state.selected_dm_users)}):**")
                
                # Create a scrollable container for many users
                with st.container():
                    # Show users in a more compact format
                    users_to_remove = []
                    
                    # Group users in rows of 2 for better space utilization
                    for i in range(0, len(st.session_state.selected_dm_users), 2):
                        cols = st.columns([2, 0.3, 2, 0.3])
                        
                        # First user in the row
                        user_option = st.session_state.selected_dm_users[i]
                        user_id = user_option.split("(")[-1].rstrip(")")
                        display_name = user_option.split("(")[0].strip()
                        
                        with cols[0]:
                            st.write(f"{i+1}. **{display_name}**")
                            st.caption(user_id)
                        with cols[1]:
                            if st.button("❌", key=f"remove_user_{i}", help=f"Remove {display_name}"):
                                users_to_remove.append(user_option)
                        
                        # Second user in the row (if exists)
                        if i + 1 < len(st.session_state.selected_dm_users):
                            user_option2 = st.session_state.selected_dm_users[i + 1]
                            user_id2 = user_option2.split("(")[-1].rstrip(")")
                            display_name2 = user_option2.split("(")[0].strip()
                            
                            with cols[2]:
                                st.write(f"{i+2}. **{display_name2}**")
                                st.caption(user_id2)
                            with cols[3]:
                                if st.button("❌", key=f"remove_user_{i+1}", help=f"Remove {display_name2}"):
                                    users_to_remove.append(user_option2)
                
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
                
                # Save as Category Section
                if len(st.session_state.selected_dm_users) >= 2:  # Only show for 2+ users
                    st.markdown("---")
                    st.write("**💾 Save as Category:**")
                    save_col1, save_col2 = st.columns([3, 1])
                    
                    with save_col1:
                        category_name = st.text_input(
                            "Category name:",
                            key="new_category_name",
                            placeholder="e.g., Signal Users, Team Alpha, VIP Members",
                            help="Enter a name for this group of users"
                        )
                    
                    with save_col2:
                        # Check if category exists to show appropriate button text
                        button_text = "💾 Save Category"
                        if category_name and category_name in st.session_state.user_categories:
                            button_text = "🔄 Update Category"
                        
                        if st.button(button_text, disabled=not category_name):
                            if category_name.strip():
                                # Check if category already exists
                                if category_name in st.session_state.user_categories:
                                    # Ask for confirmation to update
                                    if st.button(f"⚠️ Confirm: Update '{category_name}' category?", key="confirm_update"):
                                        st.session_state.user_categories[category_name] = st.session_state.selected_dm_users.copy()
                                        save_user_categories()  # Save to file
                                        st.success(f"✅ Updated '{category_name}' category with {len(st.session_state.selected_dm_users)} users")
                                        st.session_state.new_category_name = ""
                                        st.rerun()
                                    else:
                                        st.warning(f"Category '{category_name}' already exists. Click confirm to update it.")
                                else:
                                    # Save the current selection as a category
                                    st.session_state.user_categories[category_name] = st.session_state.selected_dm_users.copy()
                                    save_user_categories()  # Save to file
                                    st.success(f"✅ Saved {len(st.session_state.selected_dm_users)} users as '{category_name}' category")
                                    # Clear the input
                                    st.session_state.new_category_name = ""
                                    st.rerun()
        
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
                        # Use send_direct_message for direct messages (no notice footer)
                        success, room_id, event_id = send_direct_message(user_id, message)
                        if success:
                            success_count += 1
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
                    
                    # Log the direct messaging action for audit trail
                    try:
                        db = next(get_db())
                        try:
                            # Get actual admin username from session state if available
                            admin_username = st.session_state.get('username', 'dashboard_admin')
                            
                            # Create a single log entry for the bulk direct message action
                            if success_count == 1:
                                # Single user - include display name
                                successful_user_id = [uid for uid in selected_user_ids if uid not in failed_users][0]
                                display_name = successful_user_id.split(":")[0].lstrip("@") if ":" in successful_user_id else successful_user_id.lstrip("@")
                                details = f"Direct messaged {display_name}"
                            else:
                                # Multiple users - just count
                                details = f"Direct messaged {success_count} users"
                            
                            admin_event = AdminEvent(
                                event_type="direct_message",
                                username=admin_username,
                                details=details,
                                timestamp=datetime.utcnow()
                            )
                            db.add(admin_event)
                            db.commit()
                        finally:
                            db.close()
                    except Exception as e:
                        logger.error(f"Error logging direct message admin event: {e}")
                
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
        st.header("🏠 Unified Room Messaging")
        st.markdown("Send messages to individual rooms, multiple rooms, or entire categories with automatic admin notice footer.")
        
        # Room Selection Mode
        st.subheader("📋 Room Selection")
        selection_mode = st.radio(
            "Choose how to select rooms:",
            ["🎯 Individual Rooms", "🏷️ By Categories", "🔀 Mixed Selection"],
            key="room_selection_mode",
            help="Select your preferred method for choosing which rooms will receive the message"
        )
        
        selected_room_ids = []
        selected_room_details = []
        
        if selection_mode == "🎯 Individual Rooms":
            # Individual room selection with search
            st.write("**Select specific rooms:**")
            
            # Search functionality
            search_col1, search_col2 = st.columns([3, 1])
            with search_col1:
                search_term = st.text_input(
                    "🔍 Search rooms by name or ID:",
                    key="room_search_term",
                    placeholder="Type to filter rooms..."
                )
            with search_col2:
                category_filter = st.selectbox(
                    "Filter by category:",
                    ["All Categories"] + sorted_categories,
                    key="individual_room_category_filter"
                )
            
            # Filter rooms based on search and category
            filtered_rooms = matrix_rooms
            if category_filter != "All Categories":
                filtered_rooms = filter_rooms_by_category(filtered_rooms, [category_filter])
            if search_term:
                filtered_rooms = filter_rooms_by_search(filtered_rooms, search_term)
            
            # Create detailed room options
            room_options_map = create_detailed_room_options_map(filtered_rooms)
            
            # Multi-select for individual rooms
            selected_room_displays = st.multiselect(
                f"Select rooms ({len(filtered_rooms)} available):",
                options=list(room_options_map.keys()),
                key="individual_selected_rooms",
                help="Select one or more specific rooms to send the message to"
            )
            
            # Get room IDs and details from selections
            for display_name in selected_room_displays:
                room_id = room_options_map[display_name]
                room_detail = next((r for r in filtered_rooms if r.get('room_id') == room_id), None)
                if room_detail:
                    selected_room_ids.append(room_id)
                    selected_room_details.append(room_detail)
        
        elif selection_mode == "🏷️ By Categories":
            # Category-based selection
            st.write("**Select room categories:**")
            
            selected_categories = st.multiselect(
                "Choose categories:",
                ["All"] + sorted_categories + ["None"],
                default=["All"],
                key="category_selected_categories",
                help="Select categories to include all rooms from those categories"
            )
            
            # If no categories are selected, default to "All"
            if not selected_categories:
                selected_categories = ["All"]
            
            # Get rooms in the selected categories
            rooms_in_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
            selected_room_ids = [room.get('room_id') for room in rooms_in_categories if room.get('room_id')]
            selected_room_details = rooms_in_categories
        
        elif selection_mode == "🔀 Mixed Selection":
            # Mixed selection: both individual rooms and categories
            st.write("**Combine individual rooms and categories:**")
            
            # Category selection
            col1, col2 = st.columns(2)
            with col1:
                st.write("**Categories:**")
                selected_categories = st.multiselect(
                    "Select categories:",
                    sorted_categories + ["None"],
                    key="mixed_selected_categories",
                    help="Select categories to include all their rooms"
                )
            
            with col2:
                st.write("**Individual Rooms:**")
                # Search for individual rooms
                search_term = st.text_input(
                    "🔍 Search rooms:",
                    key="mixed_room_search",
                    placeholder="Filter rooms..."
                )
                
                # Filter rooms for individual selection
                filtered_rooms = matrix_rooms
                if search_term:
                    filtered_rooms = filter_rooms_by_search(filtered_rooms, search_term)
                
                room_options_map = create_detailed_room_options_map(filtered_rooms)
                selected_individual_displays = st.multiselect(
                    f"Select specific rooms ({len(filtered_rooms)} available):",
                    options=list(room_options_map.keys()),
                    key="mixed_individual_rooms",
                    help="Select additional individual rooms"
                )
            
            # Combine selections
            combined_room_ids = set()
            combined_room_details = []
            
            # Add rooms from categories
            if selected_categories:
                rooms_from_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
                for room in rooms_from_categories:
                    room_id = room.get('room_id')
                    if room_id and room_id not in combined_room_ids:
                        combined_room_ids.add(room_id)
                        combined_room_details.append(room)
            
            # Add individual rooms
            for display_name in selected_individual_displays:
                room_id = room_options_map[display_name]
                if room_id not in combined_room_ids:
                    combined_room_ids.add(room_id)
                    room_detail = next((r for r in filtered_rooms if r.get('room_id') == room_id), None)
                    if room_detail:
                        combined_room_details.append(room_detail)
            
            selected_room_ids = list(combined_room_ids)
            selected_room_details = combined_room_details
        
        # Preview Section
        st.markdown("---")
        st.subheader("📋 Message Preview")
        
        if selected_room_ids:
            # Show selected rooms count and details
            st.success(f"✅ **{len(selected_room_ids)} rooms selected**")
            
            # Show room details in an expander
            with st.expander(f"📋 View selected rooms ({len(selected_room_ids)})", expanded=False):
                for i, room in enumerate(selected_room_details, 1):
                    room_name = room.get('name') or "Unnamed Room"
                    room_id = room.get('room_id')
                    category = room.get('category', 'Uncategorized')
                
                    # Add marker for discovered rooms
                    if not room.get('configured', True):
                        room_name = f"{room_name} (Discovered)"
                    
                    st.write(f"{i}. **{room_name}** `{room_id}`")
                    st.caption(f"Category: {category}")
        else:
            st.warning("⚠️ No rooms selected. Please select rooms using the options above.")
        
        # Message Input Section
        st.subheader("✍️ Message Content")
        
        # Show the notice that will be automatically appended
        notice = Config.MATRIX_MESSAGE_NOTICE
        if notice:
            st.info(f"ℹ️ **Auto-appended notice:** {notice}")
        
        message = st.text_area(
            "Enter your message:",
            height=150,
            key="unified_room_message",
            placeholder="Type your message here...\n\nThe admin notice will be automatically appended to the end.",
            help="Enter the message content. The admin notice footer will be automatically added."
        )
        
        # Message preview
        if message:
            with st.expander("👁️ Message Preview", expanded=False):
                preview_message = f"{message}\n\n{notice}" if notice and not message.endswith(notice) else message
                st.code(preview_message, language="")
        
        # Send Button and Results
        st.markdown("---")
        st.subheader("🚀 Send Message")
        
        # Send button with validation
        send_col1, send_col2, send_col3 = st.columns([1, 2, 1])
        with send_col2:
            send_button = st.button(
                f"📤 Send to {len(selected_room_ids)} Room{'s' if len(selected_room_ids) != 1 else ''}",
                disabled=not (selected_room_ids and message),
                key="send_unified_message",
                help="Send the message to all selected rooms with automatic admin notice"
            )
        
        # Handle message sending
        if send_button:
            if selected_room_ids and message:
                with st.spinner(f"Sending message to {len(selected_room_ids)} rooms..."):
                    # Create progress bar
                    progress_bar = st.progress(0)
                    status_text = st.empty()
                    
                    # Send messages
                    try:
                        results = await send_matrix_message_to_multiple_rooms(selected_room_ids, message)
                    except Exception as e:
                        logger.error(f"Error sending messages: {e}")
                        st.error(f"Error sending messages: {e}")
                        results = {room_id: False for room_id in selected_room_ids}
                    
                    # Update progress
                    progress_bar.progress(1.0)
                    status_text.text("Message sending completed!")
                
                # Display results
                success_count = sum(1 for success in results.values() if success)
                failed_count = len(selected_room_ids) - success_count
                
                if success_count == len(selected_room_ids):
                    st.success(f"🎉 Message sent successfully to all {success_count} rooms!")
                    st.balloons()
                elif success_count > 0:
                    st.warning(f"⚠️ Message sent to {success_count} out of {len(selected_room_ids)} rooms. {failed_count} failed.")
                else:
                    st.error(f"❌ Failed to send message to any rooms.")
                    # Check if this might be an SSL issue
                    if failed_count == len(selected_room_ids):
                        st.error("🔒 **SSL/TLS Connection Issue Detected**")
                        st.error("This appears to be a connection issue with the Matrix server. This could be due to:")
                        st.error("• SSL/TLS version compatibility issues")
                        st.error("• Network connectivity problems")
                        st.error("• Matrix server configuration issues")
                        st.info("💡 **Troubleshooting Steps:**")
                        st.info("1. Check the application logs for detailed error messages")
                        st.info("2. Verify Matrix server is accessible")
                        st.info("3. Contact system administrator if the issue persists")
                
                # Show detailed results
                if failed_count > 0:
                    with st.expander(f"❌ Failed Rooms ({failed_count})", expanded=True):
                        failed_rooms = [room_id for room_id, success in results.items() if not success]
                        for room_id in failed_rooms:
                            # Find room name for better display
                            room_detail = next((r for r in selected_room_details if r.get('room_id') == room_id), None)
                            room_name = room_detail.get('name', 'Unknown Room') if room_detail else 'Unknown Room'
                            st.write(f"• **{room_name}** `{room_id}`")
                
                if success_count > 0:
                    with st.expander(f"✅ Successful Rooms ({success_count})", expanded=False):
                        successful_rooms = [room_id for room_id, success in results.items() if success]
                        for room_id in successful_rooms:
                            # Find room name for better display
                            room_detail = next((r for r in selected_room_details if r.get('room_id') == room_id), None)
                            room_name = room_detail.get('name', 'Unknown Room') if room_detail else 'Unknown Room'
                            st.write(f"• **{room_name}** `{room_id}`")
            else:
                if not selected_room_ids:
                    st.error("❌ Please select at least one room.")
                if not message:
                    st.error("❌ Please enter a message to send.")
    
    with tab3:
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
                    try:
                        success = await invite_to_matrix_room(room_id, user_id)
                        if success:
                            success_count += 1
                    except Exception as e:
                        logger.error(f"Error inviting user to room {room_id}: {e}")
                        # Continue with next room
                
                if success_count > 0:
                    st.success(f"User invited to {success_count} out of {len(room_ids)} rooms")
                    
                    if send_welcome:
                        # Send welcome message to each room
                        welcome_message = f"Welcome {username} to the room! 👋"
                        for room_id in room_ids:
                            try:
                                await send_matrix_message(room_id, welcome_message)
                            except Exception as e:
                                logger.error(f"Error sending welcome message to room {room_id}: {e}")
                                # Continue with next room
                else:
                    st.error("Failed to invite user to any rooms")
            else:
                st.warning("Please enter a user ID and select at least one room")
    
    with tab4:
        st.header("🚫 Enhanced User Removal")
        st.subheader("Remove users from rooms with templated messages and audit logging")
        
        # DEVELOPER DOCUMENTATION: Enhanced User Removal Room Selection (Tab 5)
        # ======================================================================
        # This section implements a multi-modal room selection strategy for user removal:
        # 1. By Categories: Users select predefined room categories.
        # 2. Individual Rooms: Users can search and pick specific rooms by name/ID.
        # 3. User Membership Rooms: Rooms are filtered based on where the selected (for removal) users are members.
        #
        # Key Concepts:
        # - Streamlit Session State: Used extensively to manage:
        #   - `st.session_state.room_selection_mode`: Stores the current active mode (e.g., "🏷️ By Categories").
        #   - `st.session_state.individual_selected_room_displays`: Stores the display names of rooms selected in "Individual Rooms" mode.
        #   - `st.session_state.membership_selected_room_displays`: Stores display names for "User Membership Rooms" mode.
        #   - This persistence is crucial for maintaining user selections across Streamlit reruns (e.g., after a button click or widget interaction).
        # - Dynamic `room_ids` Population: The `room_ids` list, which feeds into the downstream removal logic,
        #   is populated based on the active mode and its specific UI elements (multiselects, category pickers).
        # - Helper Functions: `filter_rooms_by_search` and `create_detailed_room_options_map` assist the "Individual Rooms" mode.
        # - Unique Widget Keys: Each interactive widget (radio, multiselect, text_input) has a unique `key` to ensure Streamlit handles its state correctly,
        #   especially important when widgets might be conditionally rendered or their options change.
        #
        # Challenges & Considerations for Future Developers:
        # - State Management: Ensuring that selections persist correctly and that the UI updates reactively to mode changes and new selections can be complex.
        #   Pay close attention to how `st.rerun()` is used and how default values for widgets are tied to session state.
        # - Performance: For large numbers of rooms or users, ensure that filtering and option generation remain performant.
        #   The current implementation relies on caching (`matrix_cache`) for initial data loads.
        # - UI Clarity: Clearly indicating which rooms are selected and why (based on the mode) is important for usability.
        #   The expanders and preview texts aim to achieve this.
        # - `m.mentions` in Matrix messages: During development, it was found that including the `m.mentions` field in the message payload
        #   could sometimes lead to issues. The current implementation relies on the HTML `formatted_body` with `<a>` tags for mentions.
        #   If re-introducing `m.mentions`, thorough testing is advised.
        # - Extensibility: If adding new selection modes, ensure they correctly populate the `room_ids` list and integrate with the existing
        #   session state patterns for selection persistence.

        # Initialize session state for selected removal users
        if 'selected_removal_users' not in st.session_state:
            st.session_state.selected_removal_users = []
        
        # User selection section
        st.subheader("👥 Select Users for Removal")
        
        # Load users from cache if not already loaded
        if not st.session_state.matrix_users:
            col1, col2 = st.columns([1, 1])
            with col1:
                if st.button("🔄 Load Matrix Users from Cache", key="load_users_for_removal"):
                    on_load_users_click()
            with col2:
                if st.session_state.get('load_users_flag', False):
                    with st.spinner("Loading Matrix users from cache..."):
                        await process_load_users()
        
        # User selection interface (similar to direct message)
        if st.session_state.matrix_users:
            # Filter options
            filter_col1, filter_col2 = st.columns(2)
            
            with filter_col1:
                user_filter = st.selectbox(
                    "Filter users:",
                    ["All Users", "Signal Users Only", "Non-Signal Users"],
                    key="removal_user_filter"
                )
            
            with filter_col2:
                search_term = st.text_input(
                    "Search users:",
                    placeholder="Type to search by name or ID...",
                    key="removal_user_search"
                )
            
            # Filter users based on selection
            filtered_users = st.session_state.matrix_users.copy()
            
            if user_filter == "Signal Users Only":
                filtered_users = [user for user in filtered_users if user.get('is_signal_user', False)]
            elif user_filter == "Non-Signal Users":
                filtered_users = [user for user in filtered_users if not user.get('is_signal_user', False)]
            
            # Apply search filter
            if search_term:
                search_lower = search_term.lower()
                filtered_users = [
                    user for user in filtered_users 
                    if search_lower in user.get('display_name', '').lower() or 
                       search_lower in user.get('user_id', '').lower()
                ]
            
            # Create user options for multiselect
            user_options = []
            for user in filtered_users:
                display_name = user.get('display_name', user.get('user_id', '').split(':')[0].lstrip('@'))
                user_id = user.get('user_id', '')
                signal_indicator = " 📱" if user.get('is_signal_user', False) else ""
                user_options.append(f"{display_name}{signal_indicator} ({user_id})")
            
            # Multi-select for users
            selected_users = st.multiselect(
                f"Select users to remove ({len(filtered_users)} available):",
                options=user_options,
                default=st.session_state.selected_removal_users,
                key="removal_user_multiselect",
                help="Select one or more users to remove from rooms"
            )
            
            # Update session state
            st.session_state.selected_removal_users = selected_users
            
            # Display selected users with remove buttons
            if st.session_state.selected_removal_users:
                st.write(f"**Selected Users ({len(st.session_state.selected_removal_users)}):**")
                
                users_to_remove = []
                
                # Display users in a grid (2 per row)
                for i in range(0, len(st.session_state.selected_removal_users), 2):
                    cols = st.columns(4)  # User1, Remove1, User2, Remove2
                    
                    # First user in the row
                    user_option1 = st.session_state.selected_removal_users[i]
                    user_id1 = user_option1.split("(")[-1].rstrip(")")
                    display_name1 = user_option1.split("(")[0].strip()
                    
                    with cols[0]:
                        st.write(f"{i+1}. **{display_name1}**")
                        st.caption(user_id1)
                    with cols[1]:
                        if st.button("❌", key=f"remove_removal_user_{i}", help=f"Remove {display_name1}"):
                            users_to_remove.append(user_option1)
                    
                    # Second user in the row (if exists)
                    if i + 1 < len(st.session_state.selected_removal_users):
                        user_option2 = st.session_state.selected_removal_users[i + 1]
                        user_id2 = user_option2.split("(")[-1].rstrip(")")
                        display_name2 = user_option2.split("(")[0].strip()
                        
                        with cols[2]:
                            st.write(f"{i+2}. **{display_name2}**")
                            st.caption(user_id2)
                        with cols[3]:
                            if st.button("❌", key=f"remove_removal_user_{i+1}", help=f"Remove {display_name2}"):
                                users_to_remove.append(user_option2)
                
                # Remove users (do this after the loop to avoid modifying list during iteration)
                if users_to_remove:
                    for user_to_remove in users_to_remove:
                        st.session_state.selected_removal_users.remove(user_to_remove)
                    st.rerun()
                
                # Extract user_ids for removal
                selected_user_ids = []
                for user_option in st.session_state.selected_removal_users:
                    user_id = user_option.split("(")[-1].rstrip(")")
                    selected_user_ids.append(user_id)
                
                # Display linked dashboard user info for selected users
                if selected_user_ids:
                    st.markdown("---")
                    st.subheader("🔗 Linked Dashboard Users")
                    
                    try:
                        db = next(get_db())
                        try:
                            for user_id in selected_user_ids:
                                username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                
                                # Look for linked dashboard user (fix the field name)
                                dashboard_user = db.query(User).filter(
                                    (User.matrix_username == username) | 
                                    (User.username == username)
                                ).first()
                                
                                if dashboard_user:
                                    with st.expander(f"✅ {username} - Dashboard User Found"):
                                        info_col1, info_col2 = st.columns(2)
                                        with info_col1:
                                            st.write(f"**Name:** {dashboard_user.first_name} {dashboard_user.last_name}")
                                            st.write(f"**Email:** {dashboard_user.email or 'Not set'}")
                                        with info_col2:
                                            st.write(f"**Organization:** {getattr(dashboard_user, 'organization', 'Not set')}")
                                            st.write(f"**Interests:** {getattr(dashboard_user, 'interests', 'Not set')}")
                                else:
                                    st.info(f"⚠️ {username} - No linked dashboard user found")
                        finally:
                            db.close()
                    except Exception as e:
                        st.error(f"Error checking dashboard users: {e}")
        
        # Fallback: Manual input if no users loaded or user wants to enter manually
        if not st.session_state.matrix_users or st.checkbox("Enter Matrix User IDs manually", key="manual_removal_input"):
            manual_user_ids = st.text_area(
                "Matrix User IDs (one per line, e.g., @username:domain.com)", 
                key="manual_removal_user_ids",
                help="Enter Matrix User IDs manually, one per line, if not in the dropdown",
                height=100
            )
            if manual_user_ids and manual_user_ids.strip():
                # Parse multiple user IDs from text area
                manual_ids = [uid.strip() for uid in manual_user_ids.strip().split('\n') if uid.strip()]
                if manual_ids:
                    selected_user_ids = manual_ids
                    st.info(f"Added {len(manual_ids)} manual user IDs: {', '.join(manual_ids)}")
                else:
                    selected_user_ids = []
            else:
                selected_user_ids = []
        elif st.session_state.selected_removal_users:
            # Extract user_ids from selected users
            selected_user_ids = []
            for user_option in st.session_state.selected_removal_users:
                user_id = user_option.split("(")[-1].rstrip(")")
                selected_user_ids.append(user_id)
        else:
            selected_user_ids = []
        
        st.markdown("---")
        
        # Removal reason templates
        st.subheader("📝 Removal Reason & Message")
        
        # Predefined reason templates
        reason_templates = {
            "Unverified": {
                "reason": "User failed verification after safety number change",
                "message": "@{username} is being removed for not verifying themselves after their safety number changed. This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device.\n\nThey are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization."
            },
            "Inactive": {
                "reason": "User inactive for extended period",
                "message": "@{username} is being removed due to inactivity. They have not participated in community discussions for an extended period. They are welcome to rejoin at any time by requesting an invitation."
            },
            "Spam": {
                "reason": "User engaged in spam or inappropriate behavior",
                "message": "@{username} is being removed for violating community guidelines regarding spam or inappropriate content. Please review our community guidelines before requesting to rejoin."
            },
            "Safety Concern": {
                "reason": "Safety or security concern reported",
                "message": "@{username} is being removed due to safety concerns reported by community members. This action is taken to protect the community. They may appeal this decision by contacting moderators."
            },
            "Custom": {
                "reason": "Custom reason",
                "message": "Custom message for @{username}"
            }
        }
        
        selected_template = st.selectbox(
            "Select removal reason template:",
            options=list(reason_templates.keys()),
            help="Choose a predefined template or select 'Custom' to write your own"
        )
        
        # Get the selected template
        template = reason_templates[selected_template]
        
        # Editable reason and message
        removal_reason = st.text_input(
            "Removal reason (for audit log):",
            value=template["reason"],
            help="This will be logged for audit purposes"
        )
        
        # Replace {username} placeholder in message template
        template_message = template["message"]
        if selected_user_ids:
            if len(selected_user_ids) == 1:
                # Single user - try to get display name from selected users
                user_id = selected_user_ids[0]
                display_name = None
                
                # Try to get display name from selected removal users first
                if st.session_state.selected_removal_users:
                    for user_option in st.session_state.selected_removal_users:
                        option_user_id = user_option.split("(")[-1].rstrip(")")
                        # Handle both full Matrix ID and UUID-only matching
                        if option_user_id == user_id:
                            display_name = user_option.split("(")[0].strip()
                            # Remove emoji indicators like 📱 from display name
                            display_name = display_name.replace(" 📱", "").strip()
                            break
                        # Also check if the UUID part matches (for cases where user_id is UUID-only)
                        elif ":" in option_user_id and user_id in option_user_id:
                            display_name = user_option.split("(")[0].strip()
                            # Remove emoji indicators like 📱 from display name
                            display_name = display_name.replace(" 📱", "").strip()
                            break
                        # Also check if the user_id is full Matrix ID and option is UUID-only
                        elif ":" in user_id and option_user_id in user_id:
                            display_name = user_option.split("(")[0].strip()
                            # Remove emoji indicators like 📱 from display name
                            display_name = display_name.replace(" 📱", "").strip()
                            break
                
                # If still no display name, try to get from Matrix cache
                if not display_name:
                    try:
                        db = next(get_db())
                        try:
                            cached_users = matrix_cache.get_cached_users(db)
                            for cached_user in cached_users:
                                cached_user_id = cached_user.get('user_id', '')
                                # Try exact match first
                                if cached_user_id == user_id:
                                    display_name = cached_user.get('display_name', '')
                                    break
                                # Try UUID matching for partial IDs
                                elif ":" in cached_user_id and user_id in cached_user_id:
                                    display_name = cached_user.get('display_name', '')
                                    break
                                elif ":" in user_id and cached_user_id in user_id:
                                    display_name = cached_user.get('display_name', '')
                                    break
                        finally:
                            db.close()
                    except Exception as e:
                        logger.warning(f"Error getting display name from cache for template preview: {e}")
                
                # Final fallback to username
                if not display_name:
                    display_name = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                
                template_message = template_message.replace("{username}", display_name)
                logger.info(f"DEBUG: Template preview using display_name: '{display_name}' for user_id: '{user_id}'")
            else:
                # Multiple users - show preview with placeholder (will be personalized during execution)
                template_message = template_message.replace("{username}", "{username} (will be personalized for each user)")
                st.info("💡 **Note**: The message will be personalized with each user's display name when sent to rooms.")
        
        removal_message = st.text_area(
            "Message to send to rooms (optional):",
            value=template_message,
            height=150,
            help="This message will be sent to each room before removing the user(s). Leave empty to skip messaging."
        )
        
        st.markdown("---")
        
        # Room selection section
        st.subheader("🏠 Select Rooms for Removal")
        
        # Initialize room_selection_mode in session state if it doesn't exist
        # This ensures the mode persists across user interactions and page reruns.
        if 'room_selection_mode' not in st.session_state:
            st.session_state.room_selection_mode = "🏷️ By Categories" # Default mode

        # Add room selection mode radio buttons
        # The `index` is set from session_state to ensure the correct radio button is pre-selected on rerun.
        # A `st.rerun()` is called if the mode changes to update the UI accordingly.
        room_selection_mode = st.radio(
            "Room Selection Mode:",
            ["🏷️ By Categories", "🎯 Individual Rooms", "👥 User Membership Rooms"],
            key="room_selection_mode_radio", 
            index=["🏷️ By Categories", "🎯 Individual Rooms", "👥 User Membership Rooms"].index(st.session_state.room_selection_mode),
            help="Choose how to select rooms for user removal"
        )
        if room_selection_mode != st.session_state.room_selection_mode:
            st.session_state.room_selection_mode = room_selection_mode
            st.rerun() 

        room_ids = [] # Initialize room_ids, this list will be populated based on the selected mode.

        # Mode 1: Select Rooms by Category
        if st.session_state.room_selection_mode == "🏷️ By Categories":
            st.markdown("##### 🏷️ Select Rooms by Category")
            # Uses a multiselect to pick from available categories.
            # `filter_rooms_by_category` (an existing helper) filters the main `matrix_rooms` list.
            selected_categories = st.multiselect(
                "Select Categories for Removal", 
                ["All", *sorted_categories, "None"], 
                default=["All"],
                key="remove_categories_by_category_mode" 
            )
            
            if not selected_categories:
                selected_categories = ["All"]
            
            rooms_in_categories = filter_rooms_by_category(matrix_rooms, selected_categories)
            category_names = ", ".join(f"'{cat}'" for cat in selected_categories)
            st.info(f"Found {len(rooms_in_categories)} rooms in the selected categories: {category_names}")
            
            if rooms_in_categories:
                with st.expander("Show rooms that will be targeted based on categories"):
                    for room in rooms_in_categories:
                        room_name = room.get('name') or "Unnamed Room"
                        r_id = room.get('room_id')
                        configured_marker = "" if room.get('configured', True) else " (Discovered)"
                        st.write(f"• {room_name}{configured_marker} - {r_id}")
            
            room_ids = [room.get('room_id') for room in rooms_in_categories if room.get('room_id')]

        # Mode 2: Select Individual Rooms by Name/ID
        elif st.session_state.room_selection_mode == "🎯 Individual Rooms":
            st.markdown("##### 🎯 Select Individual Rooms by Name/ID")
            # This mode allows fine-grained selection of specific rooms.
            # - Fetches all cached rooms.
            # - Uses `filter_rooms_by_search` to narrow down rooms based on user input.
            # - Uses `create_detailed_room_options_map` to generate display strings for the multiselect,
            #   mapping them back to room_ids.
            # - `st.session_state.individual_selected_room_displays` stores the *display strings* of selected rooms
            #   to maintain selection across reruns, as the `options` for the multiselect can change with search.
            db = next(get_db())
            try:
                all_cached_rooms_for_individual = matrix_cache.get_cached_rooms(db)
                
                room_search = st.text_input(
                    "🔍 Search rooms:",
                    placeholder="Type to filter rooms by name, ID, or category...",
                    key="individual_room_search_filter"
                )
                
                filtered_search_rooms = filter_rooms_by_search(all_cached_rooms_for_individual, room_search)
                
                # Create a mapping from display string to room_id
                detailed_room_options_map = create_detailed_room_options_map(filtered_search_rooms)
                
                # Preserve selection across reruns
                if 'individual_selected_room_displays' not in st.session_state:
                    st.session_state.individual_selected_room_displays = []

                selected_room_displays = st.multiselect(
                    f"Select specific rooms ({len(filtered_search_rooms)} available):",
                    options=list(detailed_room_options_map.keys()),
                    default=st.session_state.individual_selected_room_displays,
                    key="individual_room_multiselect", 
                    help="Select one or more rooms. Search to narrow down the list."
                )
                st.session_state.individual_selected_room_displays = selected_room_displays
                
                room_ids = [detailed_room_options_map[display] for display in selected_room_displays if display in detailed_room_options_map]

                if room_ids:
                    st.success(f"✅ Selected {len(room_ids)} individual rooms.")
                    with st.expander("📋 View Selected Individual Rooms & User Memberships"):
                        for room_display_name in selected_room_displays:
                            r_id = detailed_room_options_map.get(room_display_name)
                            if r_id:
                                room_detail = next((r for r in filtered_search_rooms if r.get('room_id') == r_id), None)
                                room_name_display = room_detail.get('name', 'Unknown Room') if room_detail else room_display_name.split(' (')[0]
                                
                                st.write(f"**{room_name_display}** (`{r_id}`)")
                                if selected_user_ids:
                                    # Check memberships for selected users in this specific room
                                    members_in_room_text = []
                                    non_members_in_room_text = []
                                    db_inner = next(get_db())
                                    try:
                                        for user_id_check in selected_user_ids:
                                            username_check = user_id_check.split(":")[0].lstrip("@") if ":" in user_id_check else user_id_check.lstrip("@")
                                            membership = db_inner.query(MatrixRoomMembership).filter(
                                                MatrixRoomMembership.user_id == user_id_check,
                                                MatrixRoomMembership.room_id == r_id,
                                                MatrixRoomMembership.membership_status == 'join'
                                            ).first()
                                            if membership:
                                                members_in_room_text.append(f"✅ {username_check}")
                                            else:
                                                non_members_in_room_text.append(f"❌ {username_check}")
                                    finally:
                                        db_inner.close()
                                    
                                    if members_in_room_text:
                                        st.write(f"  Users in room: {', '.join(members_in_room_text)}")
                                    if non_members_in_room_text:
                                        st.write(f"  Users NOT in room: {', '.join(non_members_in_room_text)}")
                                else:
                                    st.caption("  (Select users to see their membership status in this room)")
                else:
                    st.info("No individual rooms selected. Use the search and multiselect above.")
            finally:
                db.close()

        # Mode 3: Select Rooms Based on User Membership
        elif st.session_state.room_selection_mode == "👥 User Membership Rooms":
            st.markdown("##### 👥 Select Rooms Based on User Membership")
            # This mode is active only if users have already been selected for removal.
            # - It queries the database for rooms where any of the `selected_user_ids` (for removal) are members.
            # - Similar to "Individual Rooms" mode, it uses a map for display strings and session state
            #   (`st.session_state.membership_selected_room_displays`) to persist multiselect choices.
            if selected_user_ids:
                st.info("💡 Showing rooms where at least one selected user is a member.")
                user_rooms_set = set() # Using a set to store unique room_ids
                db = next(get_db())
                try:
                    for user_id_member_check in selected_user_ids:
                        user_memberships = db.query(MatrixRoomMembership).filter(
                            MatrixRoomMembership.user_id == user_id_member_check,
                            MatrixRoomMembership.membership_status == 'join'
                        ).all()
                        for membership in user_memberships:
                            user_rooms_set.add(membership.room_id)
                finally:
                    db.close()

                available_rooms_for_membership_mode = []
                db = next(get_db())
                try:
                    cached_rooms_for_membership = matrix_cache.get_cached_rooms(db)
                    for room in cached_rooms_for_membership:
                        if room.get('room_id') in user_rooms_set:
                            available_rooms_for_membership_mode.append(room)
                finally:
                    db.close()

                if available_rooms_for_membership_mode:
                    # Filter rooms by minimum member count
                    filtered_membership_rooms = [
                        room for room in available_rooms_for_membership_mode 
                        if room.get('member_count', 0) > Config.MATRIX_MIN_ROOM_MEMBERS
                    ]
                    
                    membership_room_options_map = {} # Maps display name to room_id
                    for room in filtered_membership_rooms:
                        room_name = room.get('name', 'Unnamed Room')
                        r_id = room.get('room_id')
                        member_count = room.get('member_count', 0)
                        
                        users_in_this_room_details = []
                        db_inner = next(get_db())
                        try:
                            for user_id_check in selected_user_ids: # Iterate through *selected_user_ids* for removal
                                membership = db_inner.query(MatrixRoomMembership).filter(
                                    MatrixRoomMembership.user_id == user_id_check,
                                    MatrixRoomMembership.room_id == r_id,
                                    MatrixRoomMembership.membership_status == 'join'
                                ).first()
                                if membership:
                                    username_display = user_id_check.split(":")[0].lstrip("@") if ":" in user_id_check else user_id_check.lstrip("@")
                                    users_in_this_room_details.append(username_display)
                        finally:
                            db_inner.close()
                        
                        users_text = f"Users: {', '.join(users_in_this_room_details)}" if users_in_this_room_details else "No selected users in this room"
                        display_name = f"{room_name} ({member_count} members) - {users_text} [{r_id}]"
                        membership_room_options_map[display_name] = r_id

                    # Preserve selection across reruns
                    if 'membership_selected_room_displays' not in st.session_state:
                        st.session_state.membership_selected_room_displays = []
                    
                    selected_membership_room_displays = st.multiselect(
                        f"Select rooms for removal ({len(filtered_membership_rooms)} available):",
                        options=list(membership_room_options_map.keys()),
                        default=st.session_state.membership_selected_room_displays,
                        key="membership_room_multiselect", 
                        help=f"Only rooms where at least one selected user is a member and with more than {Config.MATRIX_MIN_ROOM_MEMBERS} members are shown."
                    )
                    st.session_state.membership_selected_room_displays = selected_membership_room_displays
                    
                    room_ids = [membership_room_options_map[display] for display in selected_membership_room_displays if display in membership_room_options_map]

                    if room_ids:
                        st.success(f"✅ Selected {len(room_ids)} rooms based on user membership.")
                        with st.expander("📋 View Selected Membership Rooms & Details"):
                            for room_display_name in selected_membership_room_displays:
                                r_id = membership_room_options_map.get(room_display_name)
                                if r_id:
                                    st.write(f"**{room_display_name.split(' [')[0]}** (`{r_id}`)")
                                    # User details already in display name
                    else:
                        st.info("No rooms selected from user membership list.")
                else:
                    st.warning("No rooms found where the selected users are members.")
            else:
                st.warning("Please select users first to see rooms based on their membership.")
        
        st.markdown("---")
        
        # Show actual room memberships for verification - this section should use the `room_ids` from the selected mode
        if selected_user_ids and room_ids: # Ensure both users and rooms are selected before showing this
            st.markdown("---")
            st.subheader("🔍 Verify User Room Memberships")
            
            if st.button("🔍 Check Actual Room Memberships", help="Verify which rooms the selected users are actually in"):
                with st.spinner("Checking actual room memberships from Matrix..."):
                    try:
                        from app.utils.matrix_actions import get_matrix_client, get_joined_rooms_async, get_room_members_async
                        client = await get_matrix_client()
                        if client:
                            try:
                                all_bot_rooms = await get_joined_rooms_async(client)
                                
                                for user_id in selected_user_ids:
                                    username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                    user_actual_rooms = []
                                    
                                    for room_id in all_bot_rooms:
                                        try:
                                            room_members = await get_room_members_async(client, room_id)
                                            if user_id in room_members:
                                                # Get room name
                                                room_name = next((r.get('name', 'Unknown Room') for r in matrix_rooms if r.get('room_id') == room_id), 'Unknown Room')
                                                user_actual_rooms.append((room_id, room_name))
                                        except Exception as room_error:
                                            continue
                                    
                                    with st.expander(f"👤 {username} - Actually in {len(user_actual_rooms)} rooms"):
                                        if user_actual_rooms:
                                            for room_id, room_name in user_actual_rooms:
                                                is_selected = room_id in room_ids
                                                status_icon = "✅" if is_selected else "⚪"
                                                st.write(f"{status_icon} **{room_name}** (`{room_id}`)")
                                                if not is_selected:
                                                    st.caption("   ↳ Not selected for removal")
                                        else:
                                            st.info("User is not in any rooms that the bot can see")
                            finally:
                                await client.close()
                        else:
                            st.error("Failed to get Matrix client for verification")
                    except Exception as e:
                        st.error(f"Error checking room memberships: {e}")
        
        # Confirmation and execution
        st.subheader("⚠️ Confirm Removal")
        
        # Add helpful note about bot permissions
        with st.expander("ℹ️ About Bot Permissions and Room Removal"):
            st.markdown("""
            **Bot Admin Status Requirements:**
            - The bot must have admin/moderator privileges in a room to remove users
            - If removal fails with "Permission denied", the bot may not be an admin in that room
            - You can check and update bot permissions in the Matrix client or room settings
            
            **How User Removal Works:**
            1. **Live Verification**: The system now checks actual room memberships from Matrix (not just local cache)
            2. **Smart Filtering**: Only attempts removal from rooms where the user is actually a member
            3. **Detailed Reporting**: Shows specific reasons for any failed operations
            4. **Cache Refresh**: Automatically updates local cache after successful removals
            
            **Common Failure Reasons:**
            - `Permission denied`: Bot is not admin in the room
            - `User not in room`: User was already removed or never joined
            - `Room not found`: Room may have been deleted or bot lost access
            """)
        
        if selected_user_ids and room_ids:
            user_count = len(selected_user_ids)
            room_count = len(room_ids)
            
            if user_count == 1:
                username = selected_user_ids[0].split(":")[0].lstrip("@") if ":" in selected_user_ids[0] else selected_user_ids[0].lstrip("@")
                st.warning(f"**You are about to remove {username} from {room_count} rooms.**")
            else:
                st.warning(f"**You are about to remove {user_count} users from {room_count} rooms each ({user_count * room_count} total removals).**")
            
            # Show what will happen
            with st.expander("📋 Removal Process Summary"):
                st.write("**The following actions will be performed:**")
                
                # Calculate actual operations based on room memberships
                total_actual_removals = 0
                for user_id in selected_user_ids:
                    db = next(get_db())
                    try:
                        user_memberships = db.query(MatrixRoomMembership).filter(
                            MatrixRoomMembership.user_id == user_id,
                            MatrixRoomMembership.membership_status == 'join'
                        ).all()
                        user_room_ids = [membership.room_id for membership in user_memberships]
                        relevant_room_count = len([room_id for room_id in room_ids if room_id in user_room_ids])
                        total_actual_removals += relevant_room_count
                    finally:
                        db.close()
                
                if removal_message.strip():
                    st.write(f"1. 📤 Send personalized removal message to rooms where users are members ({total_actual_removals} total messages)")
                    st.write(f"2. 🚫 Remove users from rooms where they are actually members ({total_actual_removals} total removals)")
                else:
                    st.write(f"1. 🚫 Remove users from rooms where they are actually members ({total_actual_removals} total removals, no messages will be sent)")
                st.write("3. 📝 Log action in audit trail for each user")
                st.write("4. 📊 Display detailed results with success/failure breakdown")
                
                st.info(f"💡 **Smart Filtering**: Only processing rooms where users are actually members (not all {user_count * room_count} possible combinations)")
                st.info("⏱️ **Rate Limiting**: Small delays are added between operations to prevent Matrix API rate limiting")
                
                # Show selected users
                st.write("**Selected Users:**")
                for user_id in selected_user_ids:
                    username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                    st.write(f"  • {username} ({user_id})")
            
            # Safety confirmation
            if user_count == 1:
                username = selected_user_ids[0].split(":")[0].lstrip("@") if ":" in selected_user_ids[0] else selected_user_ids[0].lstrip("@")
                confirm_text = f"✅ I confirm I want to remove **{username}** from **{room_count} rooms**"
            else:
                confirm_text = f"✅ I confirm I want to remove **{user_count} users** from **{room_count} rooms each** ({user_count * room_count} total removals)"
            
            confirm_removal = st.checkbox(confirm_text, key="confirm_user_removal")
            
            if st.button("🚫 Execute Removal", disabled=not confirm_removal, type="primary"):
                if confirm_removal:
                    # Execute the removal process
                    with st.spinner("Executing removal process..."):
                        progress_bar = st.progress(0)
                        status_text = st.empty()
                        
                        # Calculate total operations dynamically based on actual room memberships
                        total_operations = 0
                        for user_id in selected_user_ids:
                            db = next(get_db())
                            try:
                                user_memberships = db.query(MatrixRoomMembership).filter(
                                    MatrixRoomMembership.user_id == user_id,
                                    MatrixRoomMembership.membership_status == 'join'
                                ).all()
                                user_room_ids = [membership.room_id for membership in user_memberships]
                                relevant_room_count = len([room_id for room_id in room_ids if room_id in user_room_ids])
                                total_operations += relevant_room_count * (2 if removal_message.strip() else 1)
                            finally:
                                db.close()
                        
                        current_operation = 0
                        
                        # Results tracking
                        results = {
                            'messages_sent': 0,
                            'users_removed': 0,
                            'failed_operations': [],
                            'successful_removals': []
                        }
                        
                        # Create a mapping from user_id to display name for mention generation
                        user_id_to_display_name = {}
                        
                        # Debug: Show what's in session state
                        logger.info(f"DEBUG: selected_removal_users = {st.session_state.selected_removal_users}")
                        logger.info(f"DEBUG: selected_user_ids = {selected_user_ids}")
                        
                        # First, try to get display names from selected users list
                        for user_option in st.session_state.selected_removal_users:
                            option_user_id = user_option.split("(")[-1].rstrip(")")
                            display_name = user_option.split("(")[0].strip()
                            # Remove emoji indicators like 📱 from display name
                            display_name = display_name.replace(" 📱", "").strip()
                            user_id_to_display_name[option_user_id] = display_name
                            logger.info(f"DEBUG: Mapped user_id '{option_user_id}' -> display_name '{display_name}'")
                            
                            # Also map the UUID-only version (without domain) for robustness
                            if ":" in option_user_id:
                                uuid_only = option_user_id.split(":")[0].lstrip("@")
                                user_id_to_display_name[uuid_only] = display_name
                                logger.info(f"DEBUG: Also mapped UUID-only '{uuid_only}' -> display_name '{display_name}'")
                        
                        # For any user_ids not in the mapping (e.g., manually entered), try to get from Matrix cache
                        for user_id in selected_user_ids:
                            if user_id not in user_id_to_display_name:
                                # Try to get display name from Matrix cache with flexible matching
                                try:
                                    db = next(get_db())
                                    try:
                                        cached_users = matrix_cache.get_cached_users(db)
                                        found_display_name = None
                                        
                                        for cached_user in cached_users:
                                            cached_user_id = cached_user.get('user_id', '')
                                            # Try exact match first
                                            if cached_user_id == user_id:
                                                found_display_name = cached_user.get('display_name', '')
                                                logger.info(f"DEBUG: Exact match in cache for '{user_id}': '{found_display_name}'")
                                                break
                                            # Try UUID matching for partial IDs
                                            elif ":" in cached_user_id and user_id in cached_user_id:
                                                found_display_name = cached_user.get('display_name', '')
                                                logger.info(f"DEBUG: UUID match in cache for '{user_id}' (found in '{cached_user_id}'): '{found_display_name}'")
                                                break
                                            elif ":" in user_id and cached_user_id in user_id:
                                                found_display_name = cached_user.get('display_name', '')
                                                logger.info(f"DEBUG: Reverse UUID match in cache for '{user_id}' (matches '{cached_user_id}'): '{found_display_name}'")
                                                break
                                        
                                        if found_display_name:
                                            user_id_to_display_name[user_id] = found_display_name
                                        else:
                                            # Fallback to username if not found in cache
                                            fallback_username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                            user_id_to_display_name[user_id] = fallback_username
                                            logger.warning(f"DEBUG: No display name found in cache for '{user_id}', using fallback: '{fallback_username}'")
                                    finally:
                                        db.close()
                                except Exception as e:
                                    logger.warning(f"Error getting display name for {user_id}: {e}")
                                    # Fallback to username
                                    fallback_username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                    user_id_to_display_name[user_id] = fallback_username
                                    logger.warning(f"DEBUG: Exception fallback for '{user_id}': '{fallback_username}'")
                        
                        # Process each user
                        for user_idx, user_id in enumerate(selected_user_ids):
                            username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                            
                            # Get the display name for this user (fallback to username if not found)
                            display_name = user_id_to_display_name.get(user_id, username)
                            
                            # If we didn't find a display name and the user_id doesn't have a domain,
                            # try to construct the full Matrix ID and look it up
                            if display_name == username and ":" not in user_id:
                                # Try to construct full Matrix ID with irregularchat.com domain
                                # Ensure Config.MATRIX_DOMAIN is accessible here or hardcode if necessary for this specific logic
                                matrix_domain = os.environ.get("MATRIX_DOMAIN", "irregularchat.com") # Fallback domain
                                full_user_id = f"@{user_id}:{matrix_domain}" if not user_id.startswith("@") else f"{user_id}:{matrix_domain}"
                                display_name = user_id_to_display_name.get(full_user_id, username)
                                logger.info(f"DEBUG: Tried full Matrix ID '{full_user_id}' -> display_name '{display_name}'")
                            
                            logger.info(f"DEBUG: Processing user_id '{user_id}' -> username '{username}' -> display_name '{display_name}'")
                            
                            # First, get the rooms this user is actually in from Matrix directly
                            user_actual_room_ids = [] # Renamed from user_room_ids to avoid confusion
                            try:
                                # Get user's actual room memberships from Matrix API
                                from app.utils.matrix_actions import get_matrix_client, get_joined_rooms_async
                                client = await get_matrix_client()
                                if client:
                                    try:
                                        # Get all rooms the bot can see
                                        all_bot_rooms = await get_joined_rooms_async(client)
                                        
                                        # For each room, check if the user is actually a member
                                        for r_id_check in all_bot_rooms: # Renamed room_id to r_id_check
                                            try:
                                                # Get room members to check if user is in this room
                                                from app.utils.matrix_actions import get_room_members_async
                                                room_members = await get_room_members_async(client, r_id_check)
                                                if user_id in room_members:
                                                    user_actual_room_ids.append(r_id_check)
                                            except Exception as room_error:
                                                logger.warning(f"Error checking membership for {user_id} in room {r_id_check}: {room_error}")
                                                continue
                                        
                                        logger.info(f"User {username} is actually in {len(user_actual_room_ids)} rooms (verified from Matrix): {user_actual_room_ids}")
                                    finally:
                                        await client.close()
                                else:
                                    logger.error("Failed to get Matrix client for membership verification")
                                    # Fallback to database cache if Matrix client fails
                                    db = next(get_db())
                                    try:
                                        user_memberships = db.query(MatrixRoomMembership).filter(
                                            MatrixRoomMembership.user_id == user_id,
                                            MatrixRoomMembership.membership_status == 'join'
                                        ).all()
                                        user_actual_room_ids = [membership.room_id for membership in user_memberships]
                                        logger.warning(f"Using database fallback: User {username} is in {len(user_actual_room_ids)} rooms from cache")
                                    finally:
                                        db.close()
                            except Exception as membership_error:
                                logger.error(f"Error getting actual room memberships for {user_id}: {membership_error}")
                                # Fallback to database cache
                                db = next(get_db())
                                try:
                                    user_memberships = db.query(MatrixRoomMembership).filter(
                                        MatrixRoomMembership.user_id == user_id,
                                        MatrixRoomMembership.membership_status == 'join'
                                    ).all()
                                    user_actual_room_ids = [membership.room_id for membership in user_memberships]
                                    logger.warning(f"Using database fallback after error: User {username} is in {len(user_actual_room_ids)} rooms from cache")
                                finally:
                                    db.close()
                            
                            # Filter room_ids (from selected mode) to only include rooms the user is actually in
                            relevant_room_ids_for_user = [r_id for r_id in room_ids if r_id in user_actual_room_ids] # Use the globally selected room_ids
                            
                            if not relevant_room_ids_for_user:
                                logger.info(f"User {username} is not in any of the selected rooms (based on current mode and actual membership), skipping.")
                                results['failed_operations'].append(f"User {username}: Not a member of any of the specifically targeted rooms.")
                                continue
                            
                            logger.info(f"Processing {username} for {len(relevant_room_ids_for_user)} relevant rooms out of {len(room_ids)} selected globally")
                            
                            # Add a longer delay between users to give Matrix server more breathing room
                            if user_idx > 0:  # Don't delay before the first user
                                status_text.text(f"Pausing briefly before processing {username}...")
                                await asyncio.sleep(1.0)
                            
                            # Process each relevant room for this user
                            for room_idx, r_id_process in enumerate(relevant_room_ids_for_user): # Renamed room_id to r_id_process
                                # Get room name for logging/display
                                room_info = next((r for r in matrix_rooms if r.get('room_id') == r_id_process), None)
                                room_name_process = room_info.get('name', 'Unknown Room') if room_info else 'Unknown Room'
                                
                                # Step 1: Send personalized message if provided (user is already confirmed to be in this room)
                                if removal_message.strip():
                                    status_text.text(f"Sending removal message for {username} to {room_name_process}...")
                                    try:
                                        from app.utils.matrix_actions import _send_room_message_with_content_async
                                        
                                        # Create Matrix mention using the display name for better user experience
                                        # Include @ in the mention HTML so we don't get double @ when replacing
                                        mention_html = f'<a href="https://matrix.to/#/{user_id}" data-mention-type="user">@{display_name}</a>'
                                        logger.info(f"DEBUG: Created mention_html: '{mention_html}'")
                                        
                                        # The removal_message might already have a specific username from template preview
                                        # We need to replace both {username} placeholder AND any existing username with the correct display name
                                        personalized_message = removal_message
                                        plain_text_body = removal_message
                                        
                                        # First, try to replace {username} placeholder if it exists
                                        if "{username}" in personalized_message:
                                            # For placeholder replacement, we need to replace @{username} with mention_html (which already contains @)
                                            personalized_message = personalized_message.replace("@{username}", mention_html)
                                            plain_text_body = plain_text_body.replace("@{username}", f"@{display_name}")
                                            logger.info(f"DEBUG: Used placeholder replacement")
                                        else:
                                            # If no placeholder, the template preview already replaced it with a username
                                            # We need to replace that username with the correct display name
                                            username_fallback = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                            
                                            # Try multiple replacement strategies
                                            replaced = False
                                            
                                            # Strategy 1: Replace username fallback if it's different from display name
                                            if username_fallback in personalized_message and username_fallback != display_name:
                                                personalized_message = personalized_message.replace(f"@{username_fallback}", mention_html)
                                                plain_text_body = plain_text_body.replace(f"@{username_fallback}", f"@{display_name}")
                                                logger.info(f"DEBUG: Replaced username_fallback '{username_fallback}' with display_name '{display_name}'")
                                                replaced = True
                                            
                                            # Strategy 2: If the message already has the correct display name, just add HTML formatting
                                            elif f"@{display_name}" in personalized_message:
                                                personalized_message = personalized_message.replace(f"@{display_name}", mention_html)
                                                logger.info(f"DEBUG: Added HTML formatting to existing display_name '{display_name}'")
                                                replaced = True
                                            
                                            # Strategy 3: Handle UUID-only user IDs (without @)
                                            elif not replaced and ":" not in user_id:
                                                # For UUID-only IDs, try to replace the UUID directly
                                                if user_id in personalized_message:
                                                    personalized_message = personalized_message.replace(f"@{user_id}", mention_html)
                                                    plain_text_body = plain_text_body.replace(f"@{user_id}", f"@{display_name}")
                                                    logger.info(f"DEBUG: Replaced UUID-only '{user_id}' with display_name '{display_name}'")
                                                    replaced = True
                                            
                                            # Strategy 4: If nothing was replaced, log a warning
                                            if not replaced:
                                                logger.warning(f"DEBUG: No replacement made for user_id '{user_id}', display_name '{display_name}', message: '{personalized_message}'")
                                        
                                        logger.info(f"DEBUG: Created personalized_message: '{personalized_message}'")
                                        logger.info(f"DEBUG: Created plain_text_body: '{plain_text_body}'")
                                        
                                        # Add safety check to ensure message isn't empty after replacement
                                        if personalized_message.strip():
                                            message_content = {
                                                "msgtype": "m.text",
                                                "body": plain_text_body,  # Plain text with display name (@ already in template)
                                                "format": "org.matrix.custom.html",
                                                "formatted_body": personalized_message,
                                                # "m.mentions" was causing issues, removing for now.
                                                # Mentions will still work visually due to HTML.
                                                # "m.mentions": {
                                                #    "user_ids": [user_id]
                                                # }
                                            }
                                            logger.info(f"DEBUG: Final message_content: {message_content}")
                                            
                                            # Use the async version with content
                                            message_success = await _send_room_message_with_content_async(r_id_process, message_content) # Use r_id_process
                                            if message_success:
                                                results['messages_sent'] += 1
                                                logger.info(f"Successfully sent removal message for {username} to {room_name_process}")
                                            else:
                                                results['failed_operations'].append(f"Message for {username} to {room_name_process}: Send failed")
                                                logger.warning(f"Failed to send removal message for {username} to {room_name_process}")
                                        else:
                                            results['failed_operations'].append(f"Message for {username} to {room_name_process}: Empty message after personalization")
                                            logger.warning(f"Empty message after personalization for {username}")
                                            
                                    except Exception as e:
                                        logger.error(f"Error sending message for {user_id} to {r_id_process}: {e}")
                                        results['failed_operations'].append(f"Message for {username} to {room_name_process}: {str(e)}")
                                    
                                    current_operation += 1
                                    progress_bar.progress(min(current_operation / total_operations, 1.0))
                                    
                                    # Small delay after sending message to avoid rate limiting
                                    await asyncio.sleep(0.5)
                                
                                # Step 2: Remove user from room
                                status_text.text(f"Removing {username} from {room_name_process}...")
                                try:
                                    removal_success = await remove_from_matrix_room_async(r_id_process, user_id, removal_reason) # Use r_id_process
                                    if removal_success:
                                        results['users_removed'] += 1
                                        results['successful_removals'].append(f"{username} from {room_name_process}")
                                        logger.info(f"Successfully removed {username} from {room_name_process}")
                                    else:
                                        results['failed_operations'].append(f"Remove {username} from {room_name_process}: Removal failed (user may not be in room or bot lacks permission)")
                                        logger.warning(f"Failed to remove {username} from {room_name_process} - user may not be in room or bot lacks permission")
                                except Exception as e:
                                    logger.error(f"Error removing {user_id} from {r_id_process}: {e}")
                                    # Provide more specific error messages based on common Matrix errors
                                    if "M_FORBIDDEN" in str(e):
                                        if "not in the room" in str(e).lower() or "not a member" in str(e).lower(): # More robust check
                                            results['failed_operations'].append(f"Remove {username} from {room_name_process}: User not in room")
                                        else:
                                            results['failed_operations'].append(f"Remove {username} from {room_name_process}: Permission denied (bot may not be admin)")
                                    elif "M_NOT_FOUND" in str(e):
                                        results['failed_operations'].append(f"Remove {username} from {room_name_process}: Room not found or user not in room")
                                    else:
                                        results['failed_operations'].append(f"Remove {username} from {room_name_process}: {str(e)}")
                                
                                current_operation += 1
                                progress_bar.progress(min(current_operation / total_operations, 1.0))
                                
                                # Small delay after removal to avoid rate limiting
                                await asyncio.sleep(0.5)
                                
                        
                        # Clear progress indicators
                        progress_bar.empty()
                        status_text.empty()
                        
                        # Log the action for audit trail
                        try:
                            db = next(get_db())
                            try:
                                for user_id in selected_user_ids:
                                    # Extract display name from Matrix ID
                                    display_name = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                    
                                    # Get actual admin username from session state if available
                                    admin_username = st.session_state.get('username', 'dashboard_admin')
                                    
                                    # Use the improved create_admin_event function
                                    create_admin_event(
                                        db,
                                        "user_removal",
                                        admin_username,
                                        f"Removed {display_name} from rooms. Reason: {removal_reason}"
                                    )
                                db.commit()
                            finally:
                                db.close()
                        except Exception as e:
                            logger.error(f"Error logging admin event: {e}")
                        
                        # Display results
                        st.markdown("---")
                        st.subheader("📊 Removal Results")
                        
                        # Success summary
                        if results['users_removed'] > 0:
                            st.success(f"✅ **Successfully completed {results['users_removed']} user removals**")
                        
                        if removal_message.strip() and results['messages_sent'] > 0:
                            st.info(f"📤 Removal message sent to {results['messages_sent']} rooms")
                        
                        # Show successful removals
                        if results['successful_removals']:
                            with st.expander(f"✅ Successful Removals ({len(results['successful_removals'])})"):
                                for removal in results['successful_removals']:
                                    st.write(f"  • {removal}")
                        
                        # Show failed operations
                        if results['failed_operations']:
                            st.error(f"❌ **{len(results['failed_operations'])} operations failed:**")
                            with st.expander("Show Failed Operations"):
                                for failure in results['failed_operations']:
                                    st.write(f"  • {failure}")
                        
                        # Celebrate if everything succeeded
                        # Calculate expected removals based on actual room memberships and selected rooms
                        expected_removals = 0
                        for user_id_calc in selected_user_ids:
                            db = next(get_db())
                            try:
                                user_memberships = db.query(MatrixRoomMembership).filter(
                                    MatrixRoomMembership.user_id == user_id_calc,
                                    MatrixRoomMembership.membership_status == 'join'
                                ).all()
                                user_actual_room_ids_calc = [membership.room_id for membership in user_memberships]
                                # Count relevant rooms based on the intersection of globally selected rooms and user's actual rooms
                                relevant_room_count = len([r_id_calc for r_id_calc in room_ids if r_id_calc in user_actual_room_ids_calc])
                                expected_removals += relevant_room_count
                            finally:
                                db.close()
                        
                        if results['users_removed'] == expected_removals and not results['failed_operations'] and expected_removals > 0:
                            st.balloons()  # Celebrate complete success
                            st.success("🎉 **All removals completed successfully!**")
                        elif results['users_removed'] > 0 :
                            st.success(f"✅ **Completed {results['users_removed']} out of {expected_removals} expected removals**")
                        elif expected_removals == 0 and not results['failed_operations']:
                            st.info("No removal operations were expected or performed based on current selections and memberships.")

                        # Force refresh Matrix cache to reflect the removals
                        if results['users_removed'] > 0:
                            try:
                                st.info("🔄 Refreshing Matrix cache to reflect the changes...")
                                db = next(get_db())
                                try:
                                    # Trigger a background sync to update the cache
                                    sync_result = await matrix_cache.background_sync(db_session=db, max_age_minutes=0)  # Force immediate sync
                                    if sync_result:
                                        st.success("✅ Matrix cache refreshed successfully")
                                    else:
                                        st.warning("⚠️ Cache refresh completed with some issues")
                                finally:
                                    db.close()
                            except Exception as cache_error:
                                st.warning(f"⚠️ Could not refresh cache: {cache_error}")
                                logger.warning(f"Error refreshing cache after user removal: {cache_error}")
                        
                        # Reset form
                        st.session_state.selected_removal_users = []
                        # Note: confirm_user_removal checkbox will reset automatically on next page load
                        
        else:
            if not selected_user_ids:
                st.warning("Please select at least one Matrix user to remove")
            elif not room_ids:
                st.warning("No rooms found in selected categories")
    
    with tab5:
        st.header("Entrance Room Users")
        st.subheader("Connect users from INDOC room with dashboard accounts")
        
        # Get entrance room ID from config (using welcome room as entrance room)
        entrance_room_id = Config.MATRIX_WELCOME_ROOM_ID
        
        if not entrance_room_id:
            st.warning("⚠️ MATRIX_WELCOME_ROOM_ID not configured. Please set this in your .env file to use the entrance room features.")
            return
        
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
    Filter rooms based on the selected categories and minimum member count.
    
    Args:
        rooms: List of room dictionaries
        selected_categories: List of categories to filter by
        
    Returns:
        List[Dict]: Filtered list of rooms with sufficient members
    """
    
    # First filter by minimum member count
    rooms_with_sufficient_members = [
        room for room in rooms 
        if room.get('member_count', 0) > Config.MATRIX_MIN_ROOM_MEMBERS
    ]
    
    # If "All" is selected, return all rooms with sufficient members
    if "All" in selected_categories:
        return rooms_with_sufficient_members
    
    filtered_rooms = []
    for room in rooms_with_sufficient_members:
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

def filter_rooms_by_search(rooms: List[Dict[str, Any]], search_term: str) -> List[Dict[str, Any]]:
    """Filter rooms based on search term in name, ID, or categories, and minimum member count.
    
    Used in the "Individual Rooms" selection mode of the user removal tab.
    The search is case-insensitive and checks against room name, room ID, and
    a comma-separated string of its categories. Also filters out rooms with
    insufficient members.

    Args:
        rooms: A list of room dictionaries from `matrix_cache.get_cached_rooms()`.
        search_term: The string to search for.

    Returns:
        A list of room dictionaries that match the search term and have sufficient members.
    """
    
    # First filter by minimum member count
    rooms_with_sufficient_members = [
        room for room in rooms 
        if room.get('member_count', 0) > Config.MATRIX_MIN_ROOM_MEMBERS
    ]
    
    if not search_term:
        return rooms_with_sufficient_members
    
    search_lower = search_term.lower()
    filtered = []
    
    for room in rooms_with_sufficient_members:
        room_name = room.get('name', '').lower()
        room_id_val = room.get('room_id', '').lower()
        
        # Ensure categories are strings and handle if 'categories' key is missing or not a list
        raw_categories = room.get('categories', [])
        category_list = []
        if isinstance(raw_categories, list):
            for cat in raw_categories:
                if isinstance(cat, str):
                    category_list.append(cat)
        
        category_text = ', '.join(category_list).lower()
        
        if (search_lower in room_name or 
            search_lower in room_id_val or 
            (category_text and search_lower in category_text)):
            filtered.append(room)
    
    return filtered

def create_detailed_room_options_map(rooms: List[Dict[str, Any]]) -> Dict[str, str]:
    """Create a mapping of detailed room display strings to room_ids with member count filtering.

    This function generates user-friendly display strings for rooms, including name,
    categories, member count, and room ID. These display strings are used as options
    in a Streamlit multiselect widget for the "Individual Rooms" selection mode.
    The map allows easy retrieval of the `room_id` from the selected display string.
    The room ID is included in the display string to ensure uniqueness if room names clash.
    Only includes rooms with more than the minimum required members.

    Args:
        rooms: A list of room dictionaries (typically filtered by search).

    Returns:
        A dictionary where keys are detailed display strings (e.g., 
        "Room Name (Categories: Cat1, Cat2) - X members [!room_id:domain.com]")
        and values are the corresponding room_ids.
    """
    
    options_map = {}
    for room in rooms:
        # Skip rooms with insufficient members
        member_count = room.get('member_count', 0)
        if member_count <= Config.MATRIX_MIN_ROOM_MEMBERS:
            continue
            
        room_name = room.get('name', 'Unnamed Room')
        room_id_val = room.get('room_id', '')
        
        raw_categories = room.get('categories', [])
        category_list = []
        if isinstance(raw_categories, list):
            for cat in raw_categories:
                if isinstance(cat, str):
                    category_list.append(cat)
        
        category_display = f"Categories: {', '.join(category_list)}" if category_list else "No categories"
        
        # Ensure room_id is part of the display string to make it unique if names clash
        display_option = f"{room_name} ({category_display}) - {member_count} members [{room_id_val}]"
        if room_id_val: # Only add if room_id is valid
             options_map[display_option] = room_id_val
    return options_map