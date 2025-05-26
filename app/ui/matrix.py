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
from app.db.operations import User, AdminEvent, MatrixRoomMember, get_matrix_room_members
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
        with st.spinner("Loading Matrix users from cache..."):
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
        st.session_state.cached_matrix_rooms = Config.get_all_matrix_rooms()
        st.session_state.matrix_rooms_cache_time = datetime.now().timestamp()
        logger.info(f"Refreshed matrix rooms cache with {len(st.session_state.cached_matrix_rooms)} rooms")
    
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
            st.session_state.cached_matrix_rooms = Config.get_all_matrix_rooms()
            st.session_state.matrix_rooms_cache_time = datetime.now().timestamp()
            st.success("✅ Room list refreshed!")
            st.rerun()
    
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
    await process_load_users()
    
    # Create tabs for different messaging options
    tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(["Direct Message", "Room Message", "Bulk Message", "Invite to Rooms", "Remove from Rooms", "Entrance Room Users"])
    
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
                # Add no-reply footer to direct messages
                message_with_footer = f"{message}\\n\\n__NOREPLY: This message was sent from the admin dashboard__"
                
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
        st.header("🚫 Enhanced User Removal")
        st.subheader("Remove users from rooms with templated messages and audit logging")
        
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
                # Single user - replace with specific username
                username = selected_user_ids[0].split(":")[0].lstrip("@") if ":" in selected_user_ids[0] else selected_user_ids[0].lstrip("@")
                template_message = template_message.replace("{username}", username)
            else:
                # Multiple users - show preview with placeholder (will be personalized during execution)
                template_message = template_message.replace("{username}", "{username} (will be personalized for each user)")
                st.info("💡 **Note**: The message will be personalized with each user's username when sent to rooms.")
        
        removal_message = st.text_area(
            "Message to send to rooms (optional):",
            value=template_message,
            height=150,
            help="This message will be sent to each room before removing the user(s). Leave empty to skip messaging."
        )
        
        st.markdown("---")
        
        # Room selection section
        st.subheader("🏠 Select Rooms for Removal")
        
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
        
        room_ids = []
        
        # If "All" is selected, use category-based filtering
        if "All" in selected_categories:
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
        
        else:
            # "All" is not selected - show specific room selection
            st.info("💡 **Specific Room Selection**: Since 'All' is not selected, choose specific rooms below.")
            
            # Get rooms that the selected users are actually in
            if selected_user_ids:
                # Get all rooms where at least one selected user is a member
                user_rooms = set()
                db = next(get_db())
                try:
                    for user_id in selected_user_ids:
                        user_memberships = db.query(MatrixRoomMembership).filter(
                            MatrixRoomMembership.user_id == user_id,
                            MatrixRoomMembership.membership_status == 'join'
                        ).all()
                        for membership in user_memberships:
                            user_rooms.add(membership.room_id)
                finally:
                    db.close()
                
                # Get room details from cache for the rooms users are in
                available_rooms = []
                db = next(get_db())
                try:
                    cached_rooms = matrix_cache.get_cached_rooms(db)
                    
                    for room in cached_rooms:
                        if room.get('room_id') in user_rooms:
                            available_rooms.append(room)
                finally:
                    db.close()
                
                if available_rooms:
                    # Create room options for multiselect
                    room_options = {}
                    for room in available_rooms:
                        room_name = room.get('name', 'Unnamed Room')
                        room_id = room.get('room_id')
                        member_count = room.get('member_count', 0)
                        
                        # Show which users are in this room
                        users_in_room = []
                        db = next(get_db())
                        try:
                            for user_id in selected_user_ids:
                                user_memberships = db.query(MatrixRoomMembership).filter(
                                    MatrixRoomMembership.user_id == user_id,
                                    MatrixRoomMembership.room_id == room_id,
                                    MatrixRoomMembership.membership_status == 'join'
                                ).first()
                                if user_memberships:
                                    username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                    users_in_room.append(username)
                        finally:
                            db.close()
                        
                        users_text = ", ".join(users_in_room) if users_in_room else "None"
                        display_name = f"{room_name} ({member_count} members) - Users: {users_text}"
                        room_options[display_name] = room_id
                    
                    # Multi-select for specific rooms
                    selected_room_names = st.multiselect(
                        f"Select specific rooms to remove users from ({len(available_rooms)} available):",
                        options=list(room_options.keys()),
                        key="specific_removal_rooms",
                        help="Only rooms where at least one selected user is a member are shown"
                    )
                    
                    # Get selected room IDs
                    room_ids = [room_options[name] for name in selected_room_names]
                    
                    if selected_room_names:
                        st.success(f"✅ Selected {len(room_ids)} specific rooms for removal")
                        
                        # Show selected rooms with user details
                        with st.expander("📋 Selected Rooms and User Memberships"):
                            for room_name in selected_room_names:
                                room_id = room_options[room_name]
                                st.write(f"**{room_name.split(' (')[0]}** (`{room_id}`)")
                                
                                # Show which selected users are in this room
                                db = next(get_db())
                                try:
                                    for user_id in selected_user_ids:
                                        user_memberships = db.query(MatrixRoomMembership).filter(
                                            MatrixRoomMembership.user_id == user_id,
                                            MatrixRoomMembership.room_id == room_id,
                                            MatrixRoomMembership.membership_status == 'join'
                                        ).first()
                                        username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                                        if user_memberships:
                                            st.write(f"  ✅ {username} (will be removed)")
                                        else:
                                            st.write(f"  ❌ {username} (not in room)")
                                finally:
                                    db.close()
                    else:
                        st.warning("Please select at least one room for removal")
                        
                else:
                    st.warning("No rooms found where the selected users are members")
                    
            else:
                st.warning("Please select users first to see available rooms")
        
        st.markdown("---")
        
        # Show actual room memberships for verification
        if selected_user_ids:
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
                        
                        # Process each user
                        for user_idx, user_id in enumerate(selected_user_ids):
                            username = user_id.split(":")[0].lstrip("@") if ":" in user_id else user_id.lstrip("@")
                            
                            # First, get the rooms this user is actually in from Matrix directly
                            user_room_ids = []
                            try:
                                # Get user's actual room memberships from Matrix API
                                from app.utils.matrix_actions import get_matrix_client, get_joined_rooms_async
                                client = await get_matrix_client()
                                if client:
                                    try:
                                        # Get all rooms the bot can see
                                        all_bot_rooms = await get_joined_rooms_async(client)
                                        
                                        # For each room, check if the user is actually a member
                                        for room_id in all_bot_rooms:
                                            try:
                                                # Get room members to check if user is in this room
                                                from app.utils.matrix_actions import get_room_members_async
                                                room_members = await get_room_members_async(client, room_id)
                                                if user_id in room_members:
                                                    user_room_ids.append(room_id)
                                            except Exception as room_error:
                                                logger.warning(f"Error checking membership for {user_id} in room {room_id}: {room_error}")
                                                continue
                                        
                                        logger.info(f"User {username} is actually in {len(user_room_ids)} rooms (verified from Matrix): {user_room_ids}")
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
                                        user_room_ids = [membership.room_id for membership in user_memberships]
                                        logger.warning(f"Using database fallback: User {username} is in {len(user_room_ids)} rooms from cache")
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
                                    user_room_ids = [membership.room_id for membership in user_memberships]
                                    logger.warning(f"Using database fallback after error: User {username} is in {len(user_room_ids)} rooms from cache")
                                finally:
                                    db.close()
                            
                            # Filter room_ids to only include rooms the user is actually in
                            relevant_room_ids = [room_id for room_id in room_ids if room_id in user_room_ids]
                            
                            if not relevant_room_ids:
                                logger.info(f"User {username} is not in any of the selected rooms, skipping")
                                results['failed_operations'].append(f"User {username}: Not in any selected rooms")
                                continue
                            
                            logger.info(f"Processing {username} for {len(relevant_room_ids)} relevant rooms out of {len(room_ids)} selected")
                            
                            # Add a longer delay between users to give Matrix server more breathing room
                            if user_idx > 0:  # Don't delay before the first user
                                status_text.text(f"Pausing briefly before processing {username}...")
                                await asyncio.sleep(1.0)
                            
                            # Process each relevant room for this user
                            for room_idx, room_id in enumerate(relevant_room_ids):
                                room_name = next((r.get('name', 'Unknown Room') for r in rooms_in_categories if r.get('room_id') == room_id), 'Unknown Room')
                                
                                # Step 1: Send personalized message if provided (user is already confirmed to be in this room)
                                if removal_message.strip():
                                    status_text.text(f"Sending removal message for {username} to {room_name}...")
                                    try:
                                        from app.utils.matrix_actions import _send_room_message_with_content_async
                                        
                                        # Create HTML mention link for the user
                                        mention_html = f'<a href="https://matrix.to/#/{user_id}">{username}</a>'
                                        
                                        # Create personalized message with HTML mention
                                        personalized_message = removal_message.replace("{username}", mention_html)
                                        
                                        # Add safety check to ensure message isn't empty after replacement
                                        if personalized_message.strip():
                                            # Create message content with HTML formatting
                                            message_content = {
                                                "msgtype": "m.text",
                                                "body": removal_message.replace("{username}", username),  # Plain text fallback
                                                "format": "org.matrix.custom.html",
                                                "formatted_body": personalized_message
                                            }
                                            
                                            # Use the async version with content
                                            message_success = await _send_room_message_with_content_async(room_id, message_content)
                                            if message_success:
                                                results['messages_sent'] += 1
                                                logger.info(f"Successfully sent removal message for {username} to {room_name}")
                                            else:
                                                results['failed_operations'].append(f"Message for {username} to {room_name}: Send failed")
                                                logger.warning(f"Failed to send removal message for {username} to {room_name}")
                                        else:
                                            results['failed_operations'].append(f"Message for {username} to {room_name}: Empty message after personalization")
                                            logger.warning(f"Empty message after personalization for {username}")
                                            
                                    except Exception as e:
                                        logger.error(f"Error sending message for {user_id} to {room_id}: {e}")
                                        results['failed_operations'].append(f"Message for {username} to {room_name}: {str(e)}")
                                    
                                    current_operation += 1
                                    progress_bar.progress(min(current_operation / total_operations, 1.0))
                                    
                                    # Small delay after sending message to avoid rate limiting
                                    await asyncio.sleep(0.5)
                                
                                # Step 2: Remove user from room
                                status_text.text(f"Removing {username} from {room_name}...")
                                try:
                                    removal_success = await remove_from_matrix_room_async(room_id, user_id, removal_reason)
                                    if removal_success:
                                        results['users_removed'] += 1
                                        results['successful_removals'].append(f"{username} from {room_name}")
                                        logger.info(f"Successfully removed {username} from {room_name}")
                                    else:
                                        results['failed_operations'].append(f"Remove {username} from {room_name}: Removal failed (user may not be in room)")
                                        logger.warning(f"Failed to remove {username} from {room_name} - user may not be in room")
                                except Exception as e:
                                    logger.error(f"Error removing {user_id} from {room_id}: {e}")
                                    # Provide more specific error messages based on common Matrix errors
                                    if "M_FORBIDDEN" in str(e):
                                        if "not in the room" in str(e):
                                            results['failed_operations'].append(f"Remove {username} from {room_name}: User not in room")
                                        else:
                                            results['failed_operations'].append(f"Remove {username} from {room_name}: Permission denied")
                                    elif "M_NOT_FOUND" in str(e):
                                        results['failed_operations'].append(f"Remove {username} from {room_name}: Room not found")
                                    else:
                                        results['failed_operations'].append(f"Remove {username} from {room_name}: {str(e)}")
                                
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
                                    
                                    admin_event = AdminEvent(
                                        event_type="user_removal",
                                        username=admin_username,
                                        details=f"Removed {display_name} from rooms. Reason: {removal_reason}",
                                        timestamp=datetime.utcnow()
                                    )
                                    db.add(admin_event)
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
                        # Calculate expected removals based on actual room memberships
                        expected_removals = 0
                        for user_id in selected_user_ids:
                            db = next(get_db())
                            try:
                                user_memberships = db.query(MatrixRoomMembership).filter(
                                    MatrixRoomMembership.user_id == user_id,
                                    MatrixRoomMembership.membership_status == 'join'
                                ).all()
                                user_room_ids = [membership.room_id for membership in user_memberships]
                                relevant_room_count = len([room_id for room_id in room_ids if room_id in user_room_ids])
                                expected_removals += relevant_room_count
                            finally:
                                db.close()
                        
                        if results['users_removed'] == expected_removals and not results['failed_operations']:
                            st.balloons()  # Celebrate complete success
                            st.success("🎉 **All removals completed successfully!**")
                        elif results['users_removed'] > 0:
                            st.success(f"✅ **Completed {results['users_removed']} out of {expected_removals} expected removals**")
                        
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