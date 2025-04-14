"""
Matrix Room Recommendation System

This module provides functions to:
1. Scrape non-admin users from a specified entrance room
2. Match user interests with available Matrix rooms using GPT
3. Generate personalized room recommendations
"""

import asyncio
import logging
from typing import List, Dict, Any, Tuple, Optional, Union
import re
import traceback

from app.utils.matrix_actions import (
    get_room_members_async,
    get_matrix_client,
    invite_to_matrix_room,
    get_all_accessible_rooms
)
from app.utils.config import Config
from app.utils.gpt_call import gpt_call, gpt_check_api
from app.db.session import get_db
from app.db.operations import get_matrix_room_members, update_matrix_room_members

# Set up logging
logger = logging.getLogger(__name__)

# Define the entrance room ID
ENTRANCE_ROOM_ID = "!bPROVgpotAcdXGxXUN:irregularchat.com"  # IrregularChat Actions/INDOC

async def get_entrance_room_users() -> List[Dict[str, Any]]:
    """
    Get all users from the entrance room.
    
    Returns:
        List[Dict[str, Any]]: List of user dictionaries with user_id and display_name
    """
    try:
        # Get Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to get Matrix client")
            return []
        
        try:
            # Get room members
            members_dict = await get_room_members_async(client, ENTRANCE_ROOM_ID)
            
            # Get all users, but mark admins accordingly
            bot_user_id = Config.MATRIX_BOT_USERNAME
            admin_usernames = Config.ADMIN_USERNAMES
            
            # Process all users
            room_users = []
            for user_id, details in members_dict.items():
                # Skip the bot itself
                if user_id == bot_user_id:
                    continue
                
                # Get the display name or use localpart as fallback
                localpart = user_id.split(":")[0].lstrip("@")
                display_name = details.get('display_name', localpart)
                
                # Check if user is an admin
                is_admin = localpart in admin_usernames
                
                # Add user to the list
                room_users.append({
                    "user_id": user_id,
                    "display_name": display_name,
                    "is_admin": is_admin
                })
            
            logger.info(f"Found {len(room_users)} users in entrance room")
            return room_users
        finally:
            # Close the client
            await client.close()
    except Exception as e:
        logger.error(f"Error getting entrance room users: {e}")
        return []

async def get_room_categories() -> List[str]:
    """
    Get all unique room categories.
    
    Returns:
        List[str]: List of unique category names
    """
    # Get all rooms
    all_rooms = await get_all_accessible_rooms_with_details()
    
    # Extract unique categories
    all_categories = set()
    for room in all_rooms:
        if "categories" in room and isinstance(room["categories"], list):
            for category in room["categories"]:
                all_categories.add(category.lower())
        elif "category" in room:
            all_categories.add(room["category"].lower())
    
    return sorted(list(all_categories))

async def get_all_accessible_rooms_with_details() -> List[Dict[str, Any]]:
    """
    Get all accessible rooms with details including categories.
    
    Returns:
        List[Dict[str, Any]]: List of room dictionaries with details
    """
    # Get all accessible rooms
    matrix_rooms = Config.get_all_matrix_rooms()
    
    # If the function returned empty, use get_matrix_rooms as fallback
    if not matrix_rooms:
        matrix_rooms = Config.get_matrix_rooms()
    
    return matrix_rooms

async def match_interests_with_rooms(interests: Union[str, List[str]]) -> List[Dict[str, Any]]:
    """
    Match user interests with available rooms using pattern matching.
    
    Args:
        interests: User interests as a string or list of strings
        
    Returns:
        List[Dict[str, Any]]: List of recommended room dictionaries
    """
    # Get all rooms
    all_rooms = await get_all_accessible_rooms_with_details()
    
    # Extract interest keywords
    if isinstance(interests, str):
        interest_keywords = [kw.strip().lower() for kw in interests.split(',')]
    else:
        interest_keywords = [kw.strip().lower() for kw in interests]
    
    # Match rooms with interests
    matched_rooms = []
    for room in all_rooms:
        room_name = room.get("name", "").lower()
        room_categories = []
        
        # Extract categories in various formats
        if "categories" in room and isinstance(room["categories"], list):
            room_categories = [cat.lower() for cat in room["categories"]]
        elif "category" in room:
            room_categories = [room["category"].lower()]
        
        # Check if any interest keyword matches the room name or categories
        for keyword in interest_keywords:
            if (keyword in room_name or 
                any(keyword in cat for cat in room_categories)):
                matched_rooms.append(room)
                break
    
    return matched_rooms

async def gpt_recommend_rooms(user_id: str, interests: Union[str, List[str]]) -> List[Tuple[str, str]]:
    """
    Use GPT to recommend rooms based on user interests.
    
    Args:
        user_id: Matrix user ID
        interests: User interests as a string or list of strings
        
    Returns:
        List[Tuple[str, str]]: List of (room_id, room_name) tuples
    """
    try:
        # Check if OpenAI API is available
        if not gpt_check_api():
            logger.warning("OpenAI API not available, falling back to pattern matching")
            matched_rooms = await match_interests_with_rooms(interests)
            return [(room.get("room_id", ""), room.get("name", "")) 
                    for room in matched_rooms if room.get("room_id")]
        
        # Get all rooms with their categories
        all_rooms = await get_all_accessible_rooms_with_details()
        
        # Format room data for GPT prompt
        room_data = []
        for room in all_rooms:
            room_id = room.get("room_id", "")
            room_name = room.get("name", "")
            
            if not room_id or not room_name:
                continue
                
            # Get categories
            if "categories" in room and isinstance(room["categories"], list):
                categories = ", ".join(room["categories"])
            else:
                categories = room.get("category", "")
            
            room_data.append(f"Room: {room_name}\nID: {room_id}\nCategories: {categories}")
        
        # Create the GPT prompt
        # Convert interests to string if it's a list
        interests_str = ", ".join(interests) if isinstance(interests, list) else interests
        interests_line = "User Interests: " + interests_str
        
        # Join room data manually
        rooms_text = "Available Rooms:"
        for rd in room_data:
            rooms_text += "\n\n" + rd
        
        # Format for JSON example (regular string, not f-string)
        json_format = '''[
  {"room_id": "room-id", "reason": "brief reason for recommendation"}
]'''
        
        # Create the full prompt
        prompt = f"""Given a user's interests, recommend the most relevant Matrix chat rooms.

{interests_line}

{rooms_text}

Return a JSON array of room recommendations in format:
{json_format}
Only include the most relevant rooms (maximum 5) and provide a brief reason for each.
"""
        
        # Call GPT
        response = gpt_call(prompt, model="gpt-4o-mini")
        
        # Parse the response
        # Looking for JSON-like content: [{...}, {...}]
        json_pattern = r'\[\s*{.*}\s*\]'
        json_match = re.search(json_pattern, response, re.DOTALL)
        
        if json_match:
            import json
            try:
                # Extract and parse the JSON part
                json_str = json_match.group(0)
                recommendations = json.loads(json_str)
                
                # Format the result
                result = []
                for rec in recommendations:
                    room_id = rec.get("room_id", "")
                    # Find the room name from our data
                    room_name = ""
                    for room in all_rooms:
                        if room.get("room_id") == room_id:
                            room_name = room.get("name", "")
                            break
                    
                    if room_id and room_name:
                        result.append((room_id, room_name))
                
                return result
            except json.JSONDecodeError:
                logger.error("Failed to parse GPT response as JSON")
        
        # Fallback to pattern matching if GPT parsing fails
        logger.warning("Could not parse GPT response, falling back to pattern matching")
        matched_rooms = await match_interests_with_rooms(interests)
        return [(room.get("room_id", ""), room.get("name", "")) 
                for room in matched_rooms if room.get("room_id")]
        
    except Exception as e:
        logger.error(f"Error using GPT for room recommendations: {e}")
        # Fallback to pattern matching
        matched_rooms = await match_interests_with_rooms(interests)
        return [(room.get("room_id", ""), room.get("name", "")) 
                for room in matched_rooms if room.get("room_id")]

async def invite_user_to_recommended_rooms(user_id: str, interests: str) -> List[Tuple[str, str, bool]]:
    """
    Invite a user to recommended rooms based on their interests.
    
    Args:
        user_id: Matrix user ID
        interests: User interests as a string
        
    Returns:
        List[Tuple[str, str, bool]]: List of (room_id, room_name, success) tuples
    """
    # Initialize results list
    results = []
    
    # Skip checking if user is in entrance room - we assume they are already there
    # since this is a user from the INDOC room
    
    # Get recommended rooms from GPT
    recommended_rooms = await gpt_recommend_rooms(user_id, interests)
    
    # Invite to recommended rooms
    for room_id, room_name in recommended_rooms:
        if not room_id:
            continue
            
        # Skip the entrance room (users are already there)
        if room_id == ENTRANCE_ROOM_ID:
            continue
            
        success = await invite_to_matrix_room(room_id, user_id)
        results.append((room_id, room_name, success))
    
    return results

# Synchronous version for convenience
def invite_user_to_recommended_rooms_sync(user_id: str, interests: str) -> List[Tuple[str, str, bool]]:
    """
    Synchronous wrapper for inviting a user to recommended rooms.
    
    Args:
        user_id: Matrix user ID
        interests: User interests as a string
        
    Returns:
        List[Tuple[str, str, bool]]: List of (room_id, room_name, success) tuples
    """
    # Set up event loop
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    # Run the async function
    result = loop.run_until_complete(invite_user_to_recommended_rooms(user_id, interests))
    return result

# Add a more robust synchronous wrapper for get_entrance_room_users
def get_entrance_room_users_sync() -> List[Dict[str, Any]]:
    """
    Robust synchronous wrapper for getting entrance room users.
    Uses nest_asyncio to handle event loop conflicts with Streamlit.
    
    Returns:
        List[Dict[str, Any]]: List of user dictionaries with user_id and display_name
    """
    import nest_asyncio
    
    try:
        # Apply nest_asyncio to patch the current event loop
        nest_asyncio.apply()
        
        # Get or create event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # If there's no event loop, create a new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Handle the case when the loop is already running
        if loop.is_running():
            # Create a future in the existing loop
            future = asyncio.ensure_future(get_entrance_room_users(), loop=loop)
            # Wait for it to complete
            while not future.done():
                loop._run_once()
            # Get the result
            return future.result()
        else:
            # Standard approach if loop is not running
            return loop.run_until_complete(get_entrance_room_users())
    except Exception as e:
        logger.error(f"Error fetching Matrix users (sync wrapper): {str(e)}")
        logger.error(traceback.format_exc())
        return [] 

def get_room_recommendations_sync(user_id: str, interests: str) -> List[Dict[str, Any]]:
    """
    Synchronous wrapper for match_interests_with_rooms.
    
    Args:
        user_id: Matrix user ID (not used in current implementation)
        interests: User interests as a string
        
    Returns:
        List[Dict[str, Any]]: List of recommended room dictionaries
    """
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(match_interests_with_rooms(interests))
    except Exception as e:
        logger.error(f"Error getting room recommendations: {e}")
        return []
    finally:
        loop.close() 