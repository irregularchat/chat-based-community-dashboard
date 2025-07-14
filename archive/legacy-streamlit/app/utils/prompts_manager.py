"""
This module provides functions for managing prompts.
It includes functions for loading, saving, and managing prompts with room/category associations.
"""
import os
import json
import logging
from typing import Dict, List, Any, Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_prompts() -> Dict[str, Any]:
    """
    Load prompts from a JSON file.
    
    Returns:
        Dict[str, Any]: Dictionary of prompts with their metadata
    """
    try:
        prompts_path = os.path.join(os.getcwd(), 'app', 'data', 'prompts.json')
        if os.path.exists(prompts_path):
            with open(prompts_path, 'r') as f:
                prompts = json.load(f)
                
                # Ensure the required fields exist
                if "prompts" not in prompts:
                    prompts["prompts"] = []
                if "room_associations" not in prompts:
                    prompts["room_associations"] = {}
                if "category_associations" not in prompts:
                    prompts["category_associations"] = {}
                    
                return prompts
        else:
            # Default prompts
            return {
                "prompts": [
                    {
                        "id": "welcome_1",
                        "name": "Standard Welcome",
                        "content": "Welcome to our community, {name}! We're glad to have you here.",
                        "description": "Standard welcome message for new members",
                        "tags": ["welcome", "general"]
                    },
                    {
                        "id": "rules_1",
                        "name": "Community Rules",
                        "content": "Please remember our community rules:\n1. Be respectful\n2. No spam\n3. Stay on topic",
                        "description": "Basic community rules reminder",
                        "tags": ["rules", "moderation"]
                    }
                ],
                "room_associations": {},
                "category_associations": {}
            }
    except Exception as e:
        logger.error(f"Error loading prompts: {e}")
        return {
            "prompts": [],
            "room_associations": {},
            "category_associations": {}
        }

def save_prompts(prompts: Dict[str, Any]) -> bool:
    """
    Save prompts to a JSON file.
    
    Args:
        prompts: Dictionary of prompts with their metadata
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create the data directory path
        data_dir = os.path.join(os.getcwd(), 'app', 'data')
        prompts_path = os.path.join(data_dir, 'prompts.json')
        
        # Log what we're about to do
        logger.info(f"Saving prompts to {prompts_path}")
        
        # Make sure the directory exists
        try:
            os.makedirs(data_dir, exist_ok=True)
            logger.info(f"Ensured data directory exists: {data_dir}")
        except Exception as e:
            logger.error(f"Failed to create data directory: {e}")
            return False
        
        # Write the prompts to the file
        try:
            with open(prompts_path, 'w') as f:
                json.dump(prompts, f, indent=2)
            logger.info("Successfully saved prompts")
            return True
        except Exception as e:
            logger.error(f"Error writing to prompts file: {e}")
            return False
    except Exception as e:
        logger.error(f"Error saving prompts: {e}")
        return False

def add_or_update_prompt(prompts: Dict[str, Any], prompt_id: str, name: str, content: str, 
                         description: str = "", tags: List[str] = None) -> Dict[str, Any]:
    """
    Add or update a prompt in the prompts dictionary.
    
    Args:
        prompts: Dictionary of prompts
        prompt_id: Unique identifier for the prompt
        name: Name of the prompt
        content: Content of the prompt
        description: Description of the prompt
        tags: List of tags for the prompt
        
    Returns:
        Dict[str, Any]: Updated prompts dictionary
    """
    if tags is None:
        tags = []
    
    # Check if the prompt already exists
    prompt_exists = False
    for i, prompt in enumerate(prompts["prompts"]):
        if prompt["id"] == prompt_id:
            # Update existing prompt
            prompts["prompts"][i] = {
                "id": prompt_id,
                "name": name,
                "content": content,
                "description": description,
                "tags": tags
            }
            prompt_exists = True
            break
    
    if not prompt_exists:
        # Add new prompt
        prompts["prompts"].append({
            "id": prompt_id,
            "name": name,
            "content": content,
            "description": description,
            "tags": tags
        })
    
    return prompts

def delete_prompt(prompts: Dict[str, Any], prompt_id: str) -> Dict[str, Any]:
    """
    Delete a prompt from the prompts dictionary.
    
    Args:
        prompts: Dictionary of prompts
        prompt_id: Unique identifier for the prompt to delete
        
    Returns:
        Dict[str, Any]: Updated prompts dictionary
    """
    # Remove the prompt
    prompts["prompts"] = [p for p in prompts["prompts"] if p["id"] != prompt_id]
    
    # Remove any associations
    if prompt_id in prompts["room_associations"]:
        del prompts["room_associations"][prompt_id]
    
    if prompt_id in prompts["category_associations"]:
        del prompts["category_associations"][prompt_id]
    
    return prompts

def associate_prompt_with_room(prompts: Dict[str, Any], prompt_id: str, room_id: str) -> Dict[str, Any]:
    """
    Associate a prompt with a room.
    
    Args:
        prompts: Dictionary of prompts
        prompt_id: Unique identifier for the prompt
        room_id: ID of the room to associate with
        
    Returns:
        Dict[str, Any]: Updated prompts dictionary
    """
    # Ensure the prompt exists
    prompt_exists = any(p["id"] == prompt_id for p in prompts["prompts"])
    if not prompt_exists:
        logger.error(f"Cannot associate prompt {prompt_id} with room {room_id}: Prompt does not exist")
        return prompts
    
    # Add the association
    prompts["room_associations"][room_id] = prompt_id
    
    return prompts

def associate_prompt_with_category(prompts: Dict[str, Any], prompt_id: str, category: str) -> Dict[str, Any]:
    """
    Associate a prompt with a category.
    
    Args:
        prompts: Dictionary of prompts
        prompt_id: Unique identifier for the prompt
        category: Category to associate with
        
    Returns:
        Dict[str, Any]: Updated prompts dictionary
    """
    # Ensure the prompt exists
    prompt_exists = any(p["id"] == prompt_id for p in prompts["prompts"])
    if not prompt_exists:
        logger.error(f"Cannot associate prompt {prompt_id} with category {category}: Prompt does not exist")
        return prompts
    
    # Add the association
    prompts["category_associations"][category] = prompt_id
    
    return prompts

def get_prompt_for_room(prompts: Dict[str, Any], room_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the prompt associated with a room.
    
    Args:
        prompts: Dictionary of prompts
        room_id: ID of the room
        
    Returns:
        Optional[Dict[str, Any]]: The prompt dictionary or None if not found
    """
    prompt_id = prompts["room_associations"].get(room_id)
    if not prompt_id:
        return None
    
    for prompt in prompts["prompts"]:
        if prompt["id"] == prompt_id:
            return prompt
    
    return None

def get_prompt_for_category(prompts: Dict[str, Any], category: str) -> Optional[Dict[str, Any]]:
    """
    Get the prompt associated with a category.
    
    Args:
        prompts: Dictionary of prompts
        category: Category name
        
    Returns:
        Optional[Dict[str, Any]]: The prompt dictionary or None if not found
    """
    prompt_id = prompts["category_associations"].get(category)
    if not prompt_id:
        return None
    
    for prompt in prompts["prompts"]:
        if prompt["id"] == prompt_id:
            return prompt
    
    return None

def get_prompt_by_id(prompts: Dict[str, Any], prompt_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a prompt by its ID.
    
    Args:
        prompts: Dictionary of prompts
        prompt_id: ID of the prompt
        
    Returns:
        Optional[Dict[str, Any]]: The prompt dictionary or None if not found
    """
    for prompt in prompts["prompts"]:
        if prompt["id"] == prompt_id:
            return prompt
    
    return None 