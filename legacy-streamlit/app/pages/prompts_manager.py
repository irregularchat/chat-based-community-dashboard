import streamlit as st
import os
import json
import logging
import uuid
from typing import Dict, List, Any, Optional
from utils.prompts_manager import (
    load_prompts, 
    save_prompts, 
    add_or_update_prompt, 
    delete_prompt,
    associate_prompt_with_room,
    associate_prompt_with_category,
    get_prompt_by_id
)
from utils.matrix_actions import merge_room_data
from utils.config import Config
from app.ui.common import display_useful_links, display_login_button

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def render_prompts_manager():
    """Main function to render the prompts manager page"""
    # Add authentication protection directly in the page
    if not st.session_state.get('is_authenticated', False):
        st.title("Authentication Required")
        st.warning("You must log in to access the Prompts Manager.")
        display_login_button(location="main")
        return
    
    st.title("Prompts Manager")
    
    # Display Useful Links in the sidebar
    display_useful_links()
    
    # Load prompts
    prompts_data = load_prompts()
    
    # Load rooms and categories
    all_rooms = merge_room_data()
    all_categories = set()
    for room in all_rooms:
        if 'categories' in room:
            all_categories.update(room['categories'])
    
    # Create prompt form
    st.header("Create or Edit Prompt")
    
    # Initialize form values
    if 'editing_prompt' in st.session_state:
        prompt = st.session_state['editing_prompt']
        prompt_id = prompt['id']
        name = prompt['name']
        content = prompt['content']
        description = prompt['description']
        tags = ", ".join(prompt['tags'])
    else:
        prompt_id = f"prompt_{uuid.uuid4().hex[:8]}"
        name = ""
        content = ""
        description = ""
        tags = ""
    
    # Form fields
    col1, col2 = st.columns([2, 1])
    
    with col1:
        name = st.text_input("Prompt Name", value=name)
        description = st.text_input("Description", value=description)
        content = st.text_area("Content", value=content, height=150, help="You can use placeholders like {name}, {username}, {mention}, etc.")
        tags = st.text_input("Tags (comma-separated)", value=tags)
        
        # Option to mark as general welcome prompt
        is_general_welcome = st.checkbox("Mark as General Welcome Prompt", 
                                        value="general_welcome" in tags.split(",") if tags else False,
                                        help="This prompt will be used as a fallback when no room or category-specific prompt is found")
    
    with col2:
        st.subheader("Associate With")
        
        # Room association
        st.write("**Room Association:**")
        room_options = ["-- None --"] + [f"{room.get('name', 'Unknown')} - {room.get('room_id')}" for room in all_rooms if 'room_id' in room]
        selected_room = st.selectbox("Select Room", room_options, key="room_association")
        
        # Category association
        st.write("**Category Association:**")
        category_options = ["-- None --"] + sorted(list(all_categories))
        selected_category = st.selectbox("Select Category", category_options, key="category_association")
        
        # Placeholders explanation
        st.markdown("### Available Placeholders:")
        st.markdown("- `{name}`: User's name")
        st.markdown("- `{username}`: Username")
        st.markdown("- `{user_id}`: Full Matrix ID")
        st.markdown("- `{mention}`: Matrix mention")
    
    # Save button
    col1, col2, col3 = st.columns([1, 1, 1])
    with col1:
        if st.button("Save Prompt & Associations"):
            if name and content:
                # Process tags
                tags_list = [tag.strip() for tag in tags.split(",") if tag.strip()]
                
                # Add general_welcome tag if checked
                if is_general_welcome and "general_welcome" not in tags_list:
                    tags_list.append("general_welcome")
                # Remove general_welcome tag if unchecked
                elif not is_general_welcome and "general_welcome" in tags_list:
                    tags_list.remove("general_welcome")
                
                # Add or update the prompt
                prompts_data = add_or_update_prompt(
                    prompts_data, 
                    prompt_id, 
                    name, 
                    content, 
                    description, 
                    tags_list
                )
                
                # Handle room association
                if selected_room != "-- None --":
                    room_name, room_id = selected_room.rsplit(" - ", 1)
                    prompts_data = associate_prompt_with_room(prompts_data, prompt_id, room_id)
                
                # Handle category association
                if selected_category != "-- None --":
                    prompts_data = associate_prompt_with_category(prompts_data, prompt_id, selected_category)
                
                # Save to file
                if save_prompts(prompts_data):
                    if 'editing_prompt' in st.session_state:
                        st.success(f"Prompt '{name}' updated successfully with associations!")
                        st.session_state.pop('editing_prompt', None)
                    else:
                        st.success(f"Prompt '{name}' added successfully with associations!")
                    st.rerun()
                else:
                    st.error("Failed to save prompt. Please check the logs for details.")
            else:
                st.error("Name and content are required fields.")
    
    with col2:
        if 'editing_prompt' in st.session_state and st.button("Cancel Editing"):
            st.session_state.pop('editing_prompt', None)
            st.rerun()
    
    with col3:
        if 'editing_prompt' in st.session_state and st.button("Clear Associations"):
            # Remove all associations for this prompt
            prompt_id = st.session_state['editing_prompt']['id']
            
            # Remove room associations
            for room_id, associated_prompt_id in list(prompts_data["room_associations"].items()):
                if associated_prompt_id == prompt_id:
                    del prompts_data["room_associations"][room_id]
            
            # Remove category associations
            for category, associated_prompt_id in list(prompts_data["category_associations"].items()):
                if associated_prompt_id == prompt_id:
                    del prompts_data["category_associations"][category]
            
            if save_prompts(prompts_data):
                st.success("Associations cleared successfully!")
                st.rerun()
            else:
                st.error("Failed to clear associations. Please check the logs for details.")
    
    # Display existing prompts with their associations
    st.markdown("---")
    st.header("Existing Prompts")
    
    if not prompts_data["prompts"]:
        st.info("No prompts have been created yet. Use the form above to add a new prompt.")
    else:
        # Create a table of prompts and their associations
        prompt_table_data = []
        
        for prompt in prompts_data["prompts"]:
            # Find room associations
            associated_rooms = []
            for room_id, associated_prompt_id in prompts_data["room_associations"].items():
                if associated_prompt_id == prompt["id"]:
                    # Find room name
                    room_name = "Unknown Room"
                    for room in all_rooms:
                        if room.get("room_id") == room_id:
                            room_name = room.get("name", "Unknown Room")
                            break
                    associated_rooms.append(f"{room_name} ({room_id})")
            
            # Find category associations
            associated_categories = []
            for category, associated_prompt_id in prompts_data["category_associations"].items():
                if associated_prompt_id == prompt["id"]:
                    associated_categories.append(category)
            
            # Add to table data
            prompt_table_data.append({
                "id": prompt["id"],
                "name": prompt["name"],
                "description": prompt["description"],
                "tags": ", ".join(prompt["tags"]),
                "rooms": ", ".join(associated_rooms) if associated_rooms else "None",
                "categories": ", ".join(associated_categories) if associated_categories else "None"
            })
        
        # Display the table
        st.dataframe(
            prompt_table_data,
            column_config={
                "id": "ID",
                "name": "Name",
                "description": "Description",
                "tags": "Tags",
                "rooms": "Associated Rooms",
                "categories": "Associated Categories"
            },
            hide_index=True
        )
        
        # Display each prompt with edit/delete options
        for i, prompt in enumerate(prompts_data["prompts"]):
            with st.expander(f"{prompt['name']} (ID: {prompt['id']})"):
                # Prompt details
                st.write(f"**Description:** {prompt['description']}")
                st.text_area("Content", value=prompt['content'], key=f"view_prompt_{i}", disabled=True, height=150)
                st.write(f"**Tags:** {', '.join(prompt['tags'])}")
                
                # Room associations
                associated_rooms = []
                for room_id, associated_prompt_id in prompts_data["room_associations"].items():
                    if associated_prompt_id == prompt["id"]:
                        # Find room name
                        room_name = "Unknown Room"
                        for room in all_rooms:
                            if room.get("room_id") == room_id:
                                room_name = room.get("name", "Unknown Room")
                                break
                        associated_rooms.append(f"{room_name} ({room_id})")
                
                if associated_rooms:
                    st.write("**Associated Rooms:**")
                    for room in associated_rooms:
                        st.write(f"- {room}")
                else:
                    st.write("**Associated Rooms:** None")
                
                # Category associations
                associated_categories = []
                for category, associated_prompt_id in prompts_data["category_associations"].items():
                    if associated_prompt_id == prompt["id"]:
                        associated_categories.append(category)
                
                if associated_categories:
                    st.write("**Associated Categories:**")
                    for category in associated_categories:
                        st.write(f"- {category}")
                else:
                    st.write("**Associated Categories:** None")
                
                # Edit and Delete buttons
                col1, col2 = st.columns(2)
                with col1:
                    if st.button("Edit", key=f"edit_prompt_{i}"):
                        st.session_state['editing_prompt'] = prompt
                        st.rerun()
                with col2:
                    if st.button("Delete", key=f"delete_prompt_{i}"):
                        if st.session_state.get('confirm_delete') == prompt['id']:
                            # User has confirmed deletion
                            prompts_data = delete_prompt(prompts_data, prompt['id'])
                            if save_prompts(prompts_data):
                                st.success(f"Prompt '{prompt['name']}' deleted successfully!")
                                st.session_state.pop('confirm_delete', None)
                                st.rerun()
                            else:
                                st.error("Failed to delete prompt. Please check the logs for details.")
                        else:
                            # Ask for confirmation
                            st.session_state['confirm_delete'] = prompt['id']
                            st.warning(f"Are you sure you want to delete '{prompt['name']}'? Click Delete again to confirm.")

# Main execution
render_prompts_manager() 