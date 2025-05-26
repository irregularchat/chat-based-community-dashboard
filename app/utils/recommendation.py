"""
Matrix Room Recommendation System

This module provides functions to:
1. Scrape non-admin users from a specified entrance room
2. Match user interests with available Matrix rooms using GPT
3. Generate personalized room recommendations
"""

import asyncio
import json
import logging
import os
import random
import re
import traceback
import time
from typing import List, Dict, Any, Tuple, Optional, Union

from app.utils.matrix_actions import (
    get_matrix_client,
    invite_to_matrix_room,
    get_all_accessible_rooms
)
from app.utils.config import Config
from app.utils.gpt_call import gpt_call, gpt_check_api
from app.db.session import get_db
from app.db.models import MatrixUser, MatrixRoomMembership
from app.services.matrix_cache import matrix_cache

# Set up logging
logger = logging.getLogger(__name__)

# Define the entrance room ID
# Import Config to get entrance room ID from environment
from app.utils.config import Config

async def get_entrance_room_users() -> List[Dict[str, Any]]:
    """
    Get all users from the entrance room (welcome room) using the database cache.
    
    Returns:
        List[Dict[str, Any]]: List of user dictionaries with user_id and display_name
    """
    db = next(get_db())
    try:
        # Get entrance room ID from config (using welcome room as entrance room)
        entrance_room_id = Config.MATRIX_WELCOME_ROOM_ID
        if not entrance_room_id:
            logger.error("MATRIX_WELCOME_ROOM_ID not configured")
            return []
        
        # Query memberships for the entrance room
        memberships = db.query(MatrixRoomMembership).filter(
            MatrixRoomMembership.room_id == entrance_room_id
        ).all()

        if not memberships:
            logger.info(f"No members found in entrance room ({entrance_room_id}) cache.")
            return []
        
        user_ids_in_room = [m.user_id for m in memberships]
        
        # Fetch user details for these users from MatrixUser table
        users_in_room_details = db.query(MatrixUser).filter(
            MatrixUser.user_id.in_(user_ids_in_room)
        ).all()

        bot_user_id = Config.MATRIX_BOT_USERNAME
        admin_usernames_config = Config.ADMIN_USERNAMES
        admin_localparts = [name.split(':')[0].lstrip('@') for name in admin_usernames_config if isinstance(name, str)]
            
        room_users = []
        for user_detail in users_in_room_details:
            # Skip the bot itself
            if user_detail.user_id == bot_user_id:
                continue
                
            localpart = user_detail.user_id.split(":")[0].lstrip("@")
            is_admin = localpart in admin_localparts
                
            room_users.append({
                "user_id": user_detail.user_id,
                "display_name": user_detail.display_name or localpart,
                "is_admin": is_admin
            })
            
        logger.info(f"Found {len(room_users)} users in entrance room from cache")
        return room_users
    except Exception as e:
        logger.error(f"Error getting entrance room users from cache: {e}\\n{traceback.format_exc()}")
        return []
    finally:
        db.close()

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
    Prioritizes the main database cache, then config, then live API calls.
    Uses a short-term in-memory cache (_room_cache) for immediate repeat calls.
    """
    global _room_cache, _room_cache_time
    
    current_time = time.time()
    if globals().get('_room_cache') is not None and current_time - globals().get('_room_cache_time', 0) < 60: # 60s short-term cache
        logger.debug(f"Using short-term in-memory cached room list ({len(_room_cache)} rooms) for recommendations.")
        return _room_cache
    
    db = next(get_db())
    try:
        # 1. Try main persistent DB cache via MatrixCacheService
        # Check if the main cache is reasonably fresh (e.g., last successful sync within ~10-15 mins)
        # We use a slightly longer tolerance here than the UI's direct "is_cache_fresh" for triggering a new sync,
        # as this function is about providing *any* reasonable list for recommendations.
        if matrix_cache.is_cache_fresh(db, max_age_minutes=15):
            cached_db_rooms = matrix_cache.get_cached_rooms(db) # This is synchronous
            if cached_db_rooms:
                logger.info(f"Using main DB cache ({len(cached_db_rooms)} rooms) for get_all_accessible_rooms_with_details.")
                
                # Augment with category info from config
                configured_rooms_map = {
                    room_conf.get('room_id'): room_conf 
                    for room_conf in Config.get_all_matrix_rooms() # Reads from .env
                }
                
                detailed_rooms = []
                for room_from_db_cache in cached_db_rooms:
                    room_id = room_from_db_cache.get('room_id')
                    details = room_from_db_cache.copy() # Start with DB cache data (name, topic, member_count etc)
                    
                    config_data = configured_rooms_map.get(room_id)
                    if config_data:
                        details['categories'] = config_data.get('categories')
                        details['category'] = config_data.get('category') # Support old field
                        details['configured'] = True
                        # Potentially overwrite name/topic from config if desired, though DB cache should be more up-to-date for those.
                        # For now, let's assume DB cache name/topic are preferred if they exist.
                        if not details.get('name') and config_data.get('name'):
                            details['name'] = config_data.get('name')
                        if not details.get('display_name') and config_data.get('name'): # Ensure display_name if name from config
                            details['display_name'] = config_data.get('name')
                    else:
                        details['categories'] = []
                        details['category'] = None
                        details['configured'] = False
                    detailed_rooms.append(details)
                
                globals()['_room_cache'] = detailed_rooms
                globals()['_room_cache_time'] = current_time
                return detailed_rooms
            else:
                logger.info("Main DB cache (MatrixRoom table) is fresh but returned no rooms. Proceeding to fallback.")
        else:
            logger.info("Main DB cache is stale or not fresh enough (max_age_minutes=15). Proceeding to fallback for recommendations list.")

        # 2. Fallback: Original logic (Config files, then live Matrix API)
        logger.debug("Falling back to config/API for get_all_accessible_rooms_with_details.")
        matrix_rooms_from_config = Config.get_all_matrix_rooms()
        if not matrix_rooms_from_config:
            logger.info("No rooms from Config.get_all_matrix_rooms() in fallback, using get_matrix_rooms().")
            matrix_rooms_from_config = Config.get_matrix_rooms()
        
        if matrix_rooms_from_config:
            logger.debug(f"Using {len(matrix_rooms_from_config)} rooms from config for recommendations as part of fallback.")
            globals()['_room_cache'] = matrix_rooms_from_config
            globals()['_room_cache_time'] = current_time
            return matrix_rooms_from_config
            
        logger.info("No rooms found in config files during fallback, trying live Matrix API for recommendations list.")
        try:
            from app.utils.matrix_actions import get_all_accessible_rooms # This is the API call
            
            api_future = asyncio.ensure_future(get_all_accessible_rooms()) # This calls matrix_actions version
            matrix_rooms_from_api = await asyncio.wait_for(api_future, timeout=10.0) # Increased timeout slightly
            
            if matrix_rooms_from_api:
                logger.info(f"Fetched {len(matrix_rooms_from_api)} rooms from live Matrix API for recommendations list.")
                # Note: These rooms from API already have details like name, topic, member_count
                # We might still want to augment with categories if they match configured rooms.
                configured_rooms_map = {
                    room_conf.get('room_id'): room_conf 
                    for room_conf in Config.get_all_matrix_rooms()
                }
                api_rooms_detailed = []
                for room_from_api in matrix_rooms_from_api:
                    details = room_from_api.copy()
                    config_data = configured_rooms_map.get(details.get('room_id'))
                    if config_data:
                        details['categories'] = config_data.get('categories')
                        details['category'] = config_data.get('category')
                        details['configured'] = True
                    else:
                        details['categories'] = []
                        details['category'] = None
                        details['configured'] = False
                    api_rooms_detailed.append(details)

                globals()['_room_cache'] = api_rooms_detailed
                globals()['_room_cache_time'] = current_time
                return api_rooms_detailed
        except asyncio.TimeoutError:
            logger.error("Timeout getting rooms from live Matrix API during fallback for recommendations list.")
        except Exception as e_api:
            logger.error(f"Error getting rooms from live Matrix API during fallback for recommendations list: {e_api}")
        
        logger.warning("Could not get rooms from any source for recommendations list, returning empty list.")
        globals()['_room_cache'] = []
        globals()['_room_cache_time'] = current_time
        return []
    except Exception as e_main:
        logger.error(f"Major error in get_all_accessible_rooms_with_details: {e_main}", exc_info=True)
        return []
    finally:
        db.close()

async def match_interests_with_rooms(interests: Union[str, List[str]]) -> List[Dict[str, Any]]:
    """
    Match user interests with available rooms using pattern matching.
    
    Args:
        interests: User interests as a string or list of strings
        
    Returns:
        List[Dict[str, Any]]: List of recommended room dictionaries
    """
    try:
        # Get all rooms with timeout protection
        try:
            # Set a timeout for getting rooms to prevent hanging
            all_rooms_future = asyncio.ensure_future(get_all_accessible_rooms_with_details())
            all_rooms = await asyncio.wait_for(all_rooms_future, timeout=5.0)
            
            # Quick validation of result
            if not isinstance(all_rooms, list):
                logger.warning(f"get_all_accessible_rooms_with_details returned non-list: {type(all_rooms)}")
                all_rooms = []
        except asyncio.TimeoutError:
            logger.error("Timeout while fetching rooms list")
            all_rooms = []
        except Exception as e:
            logger.error(f"Error fetching rooms: {e}")
            all_rooms = []
        
        # Handle None or empty interests
        if not interests:
            # Return some default rooms or an empty list
            logger.info("No interests provided, returning all available rooms as recommendations")
            return all_rooms or []  # Ensure we return an empty list if all_rooms is None
        
        # Extract interest keywords with robust error handling
        interest_keywords = []
        expanded_keywords = []
        try:
            if isinstance(interests, str):
                interest_keywords = [kw.strip().lower() for kw in interests.split(',') if kw and kw.strip()]
                # Add individual words as well
                for phrase in interest_keywords:
                    expanded_keywords.extend([word.strip() for word in phrase.split() if word.strip()])
            else:
                # Enhanced check for None or non-string list elements
                if interests is None:
                    interest_keywords = []
                elif isinstance(interests, list):
                    interest_keywords = [kw.strip().lower() for kw in interests if kw and isinstance(kw, str) and hasattr(kw, 'strip')]
                    # Add individual words as well
                    for phrase in interest_keywords:
                        expanded_keywords.extend([word.strip() for word in phrase.split() if word.strip()])
                else:
                    # If interests is neither string nor list, convert to string and try again
                    logger.warning(f"Unexpected interests type: {type(interests)}. Converting to string.")
                    interest_str = str(interests)
                    interest_keywords = [kw.strip().lower() for kw in interest_str.split(',') if kw and kw.strip()]
                    # Add individual words as well
                    for phrase in interest_keywords:
                        expanded_keywords.extend([word.strip() for word in phrase.split() if word.strip()])
        except Exception as e:
            logger.error(f"Error processing interests: {e}")
            interest_keywords = []
            expanded_keywords = []
            
        # Combine original keywords and expanded words, removing duplicates
        all_keywords = list(set(interest_keywords + expanded_keywords))
        
        # Add related keywords for common interests
        recommendation_keyword_expansions = {
            # General interests
            "outdoor": ["nature", "hiking", "camping", "adventure", "outdoors", "trek", "wilderness", 
                       "outside", "backpacking", "mountain", "climbing", "trail", "hiking", "biking", 
                       "fishing", "kayaking", "canoeing", "rafting", "skiing", "snowboarding", "shooting", "guns", "firearms", "firearm safety", "firearm training"],
            
            # Tech category
            "tech": ["general tech", "hardware", "software", "development", "computer", "programming", "coding", "technology"],
            "hardware": ["electronics", "raspberry pi", "arduino", "microcontroller", "circuit", "pcb", "computer hardware", "tech hardware"],
            "rf": ["signals", "ew", "electronic warfare", "radio", "sdr", "software defined radio", "dragonos", "ham", "amateur radio"],
            "ai": ["artificial intelligence", "machine learning", "ml", "data science", "neural networks", "deep learning", "nlp", "gpt", "tech ai", "ai/ml", "ml/ai"],
            "unmanned": ["drone", "robotics", "uav", "unmanned aerial vehicle", "counter drone", "counter uav", "c-uas", "cuas", "unmanned systems", "drones & robotics", "counter unmanned systems"],
            "fabrication": ["3d printing", "cnc", "manufacturing", "maker", "diy", "printing", "additive manufacturing", "tech fabrication"],
            "security": ["cybersecurity", "cyber", "infosec", "information security", "red team", "blue team", "purple team", "pentest", "penetration testing", "purple teaming"],
            "certification": ["cert", "certs", "certifications", "tech certification", "exam", "training certification"],
            "fullstack": ["web development", "web dev", "software development", "ctf", "capture the flag", "full stack development", "full-stack", "developer"],
            "space": ["astronomy", "spacex", "nasa", "satellite", "mars", "moon", "rocket", "spacecraft", "space chat", "space exploration"],
            
            # Information & Research
            "influence": ["psyop", "psychological operations", "information operations", "information warfare", "psyops", "military information", "iwar", "influence chat", "information warfare", "influence operations"],
            "research": ["academic", "science", "analysis", "intelligence analysis", "studies", "white paper", "research chat", "information research"],
            
            # Miscellaneous
            "business": ["entrepreneurship", "startup", "finance", "investing", "career", "professional", "business chat"],
            "debate": ["discussion", "philosophy", "politics", "rhetoric", "argument", "critical thinking", "debate group", "debate chat"],
            "spanish": ["español", "language", "linguistics", "bilingual", "language learning", "spanish chat"],
            "offtopic": ["general", "random", "misc", "off-topic", "off topic", "casual", "general chat"],
            "outdoor_misc": ["hiking", "camping", "climbing", "outdoor activities", "outdoor group", "outdoors"],
            
            # Locations
            "location": ["fort liberty", "flnc", "national capital region", "ncr", "knoxville", "tampa", "texas", "central texas", "fort liberty group", "ncr group", "knoxville group", "tampa group", "central texas group"]
        }
        
        expanded_set = set(all_keywords)
        for keyword in all_keywords.copy():
            for base_word, expansions in recommendation_keyword_expansions.items():
                if base_word in keyword:
                    expanded_set.update(expansions)
        
        # Update the keywords list with expanded terms
        all_keywords = list(expanded_set)
        
        logger.info(f"User interests expanded to keywords: {all_keywords}")
        
        # If we still have no valid keywords after filtering, return all rooms
        if not all_keywords:
            logger.info("No valid interest keywords found, returning all available rooms")
            return all_rooms or []  # Ensure we return an empty list if all_rooms is None
        
        # Match rooms with interests - use more efficient algorithm to avoid O(n²) complexity
        matched_rooms = []
        
        # Ensure all_rooms is iterable
        if not all_rooms:
            logger.warning("No rooms available to match interests against")
            return []
        
        # Limit the number of rooms to process to avoid excessive computation
        max_rooms_to_process = min(len(all_rooms), 100)  # Process at most 100 rooms
        rooms_to_process = all_rooms[:max_rooms_to_process]
        
        # Process each room with proper error handling
        for room in rooms_to_process:
            # Ensure room is a valid dictionary
            if not isinstance(room, dict):
                logger.warning(f"Skipping invalid room object: {room}")
                continue
                
            room_name = ""
            room_topic = ""
            room_categories = []
            
            # Safely get room name
            if room.get("name") is not None:
                try:
                    room_name = room.get("name", "").lower()
                except (AttributeError, TypeError):
                    logger.warning(f"Could not process room name: {room.get('name')}")
                    room_name = ""
            else:
                room_name = ""
            
            # Safely get room topic
            if room.get("topic") is not None:
                try:
                    room_topic = room.get("topic", "").lower()
                except (AttributeError, TypeError):
                    logger.warning(f"Could not process room topic: {room.get('topic')}")
                    room_topic = ""
            else:
                room_topic = ""
            
            # Extract categories in various formats with proper error handling
            try:
                if "categories" in room and isinstance(room["categories"], list):
                    room_categories = [cat.lower() for cat in room["categories"] if cat and hasattr(cat, 'lower')]
                elif "category" in room and room["category"]:
                    if hasattr(room["category"], 'lower'):
                        room_categories = [room["category"].lower()]
            except Exception as e:
                logger.warning(f"Error extracting categories for room {room.get('name', 'Unknown')}: {e}")
                room_categories = []
            
            # Check for keyword matches more efficiently
            try:
                # Create a single string for easier text matching instead of looping through keywords
                room_text = f"{room_name} {room_topic} {' '.join(room_categories)}".lower()
                
                # Check if any interest keyword is in the room text
                if any(keyword in room_text for keyword in all_keywords):
                    matched_rooms.append(room)
                    logger.info(f"Matched room: {room_name} based on expanded keywords")
                    
                    # Add a match score to help with sorting (higher is better)
                    match_score = 0
                    
                    # Check for exact category matches - give these higher priority
                    if any(category.lower() in all_keywords for category in room_categories):
                        match_score += 10
                        
                    # Check for name matches - these are also important
                    if any(keyword in room_name.lower() for keyword in all_keywords):
                        match_score += 5
                        
                    # Add score based on number of matching keywords
                    match_score += sum(1 for keyword in all_keywords if keyword in room_text)
                    
                    # Store match score with the room
                    room['match_score'] = match_score
            except Exception as e:
                logger.warning(f"Error matching interests for room {room.get('name', 'Unknown')}: {e}")
                continue
        
        # If no matches found, return a few default rooms rather than nothing
        if not matched_rooms and all_rooms:
            logger.info("No matched rooms found, returning a subset of all rooms")
            # Return a sample of rooms (up to 5) as a fallback
            try:
                # Limit to first 5 rooms to avoid randomization overhead
                return all_rooms[:min(5, len(all_rooms))]
            except (ValueError, TypeError) as e:
                logger.warning(f"Error sampling rooms: {e}. Returning all available rooms.")
                return all_rooms
        
        # Sort matched rooms by match score
        if matched_rooms:
            matched_rooms.sort(key=lambda r: r.get('match_score', 0), reverse=True)
        
        # Check if we need to prioritize outdoor-related rooms based on interests
        has_outdoor_interest = False
        outdoor_keywords = ["outdoor", "outdoors", "nature", "hiking", "adventure", "outside", 
                           "wilderness", "backpacking", "mountain", "trail"]
                           
        # Check if any interest keywords are related to outdoor activities
        for keyword in all_keywords:
            if any(outdoor_term in keyword for outdoor_term in outdoor_keywords):
                has_outdoor_interest = True
                logger.info(f"User has outdoor interests based on keyword: {keyword}")
                break
                
        # If user has outdoor interests, ensure outdoor rooms are prioritized
        if has_outdoor_interest and matched_rooms:
            # Move rooms with outdoor keywords to the front of the list
            outdoor_rooms = []
            other_rooms = []
            
            for room in matched_rooms:
                # Safely get and handle room name and topic
                if room is None:
                    continue
                    
                try:
                    # Get room name safely with triple-check against None
                    room_name = ""
                    if room.get("name") is not None:
                        room_name = str(room.get("name", "")).lower()
                        
                    # Get room topic safely with triple-check against None
                    room_topic = ""
                    if room.get("topic") is not None:
                        room_topic = str(room.get("topic", "")).lower()
                    
                    # Check if room is outdoor-related
                    if any(kw in room_name or kw in room_topic for kw in outdoor_keywords):
                        outdoor_rooms.append(room)
                        logger.info(f"Prioritizing outdoor room: {room.get('name')}")
                    else:
                        other_rooms.append(room)
                except (AttributeError, TypeError) as e:
                    logger.warning(f"Error processing room for outdoor prioritization: {e}")
                    # Skip this room but continue processing others
                    continue
            
            # Reorder matched rooms with outdoor rooms first
            matched_rooms = outdoor_rooms + other_rooms
        
        # Limit number of returned rooms to avoid overwhelming the UI
        max_recommendations = 10  # Limit to 10 recommended rooms
        if len(matched_rooms) > max_recommendations:
            logger.info(f"Limiting recommendations from {len(matched_rooms)} to {max_recommendations} rooms")
            return matched_rooms[:max_recommendations]
            
        return matched_rooms
    except Exception as e:
        logger.error(f"Unexpected error in match_interests_with_rooms: {e}")
        logger.error(traceback.format_exc())
        return []  # Return empty list instead of propagating exception

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
        entrance_room_id = Config.MATRIX_WELCOME_ROOM_ID
        if room_id == entrance_room_id:
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
    # Defensive check for None parameters
    if user_id is None:
        logger.error("Cannot invite user: user_id is None")
        return []
        
    if interests is None:
        logger.warning("Interests is None, using empty string")
        interests = ""
        
    try:
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
    except Exception as e:
        logger.error(f"Error in invite_user_to_recommended_rooms_sync: {str(e)}")
        logger.error(traceback.format_exc())
        return []
    finally:
        if 'loop' in locals() and not loop.is_closed():
            loop.close()

# Add a more robust synchronous wrapper for get_entrance_room_users
def get_entrance_room_users_sync() -> List[Dict[str, Any]]:
    """
    Synchronous wrapper for get_entrance_room_users.
    Gets users from the entrance room (welcome room).
    """
    logger.debug("Running get_entrance_room_users_sync")
    try:
        # Since the async version now uses DB directly, we can also make this sync.
        db = next(get_db())
        try:
            # Get entrance room ID from config (using welcome room as entrance room)
            entrance_room_id = Config.MATRIX_WELCOME_ROOM_ID
            if not entrance_room_id:
                logger.error("MATRIX_WELCOME_ROOM_ID not configured (sync)")
                return []
                
            memberships = db.query(MatrixRoomMembership).filter(
                MatrixRoomMembership.room_id == entrance_room_id
            ).all()

            if not memberships:
                logger.info(f"No members found in entrance room ({entrance_room_id}) cache (sync).")
                return []

            user_ids_in_room = [m.user_id for m in memberships]
            
            users_in_room_details = db.query(MatrixUser).filter(
                MatrixUser.user_id.in_(user_ids_in_room)
            ).all()

            bot_user_id = Config.MATRIX_BOT_USERNAME
            admin_usernames_config = Config.ADMIN_USERNAMES
            admin_localparts = [name.split(':')[0].lstrip('@') for name in admin_usernames_config if isinstance(name, str)]

            room_users = []
            for user_detail in users_in_room_details:
                if user_detail.user_id == bot_user_id:
                    continue
                
                localpart = user_detail.user_id.split(":")[0].lstrip("@")
                is_admin = localpart in admin_localparts
                
                room_users.append({
                    "user_id": user_detail.user_id,
                    "display_name": user_detail.display_name or localpart,
                    "is_admin": is_admin
                })
                
            logger.info(f"Found {len(room_users)} users in entrance room from cache (sync)")
            return room_users
        except Exception as e:
            logger.error(f"Error getting entrance room users from cache (sync): {e}\\n{traceback.format_exc()}")
            return []
    except Exception as e:
        # This outer try-except is to catch potential issues with get_db() itself
        logger.error(f"Critical error in get_entrance_room_users_sync: {e}\\n{traceback.format_exc()}")
        return []
    finally:
        if 'db' in locals() and db: # Ensure db is defined and not None
            db.close()

def get_room_recommendations_sync(user_id: str, interests: str) -> List[Dict[str, Any]]:
    """
    Synchronous wrapper for match_interests_with_rooms.
    
    Args:
        user_id: Matrix user ID (not used in current implementation)
        interests: User interests as a string
        
    Returns:
        List[Dict[str, Any]]: List of recommended room dictionaries
    """
    # Define a thread-local event loop storage
    import threading
    thread_local = threading.local()
    
    try:
        # Handle None input parameters
        if user_id is None:
            logger.warning("user_id parameter is None, using empty string")
            user_id = ""
            
        # Defensive check for interests being None
        if interests is None:
            logger.warning("Interests parameter is None, using empty string")
            interests = ""
            
        # Log the values for debugging
        logger.info(f"Getting room recommendations for user_id: {user_id}, interests: {interests}")
        
        # Use thread-local storage for event loop to avoid interference between threads
        if not hasattr(thread_local, 'loop') or thread_local.loop.is_closed():
            thread_local.loop = asyncio.new_event_loop()
            
        # Create a timeout mechanism
        timeout_seconds = 15  # Increase timeout from 7 to 15 seconds for async operation
        
        # Run the async match_interests_with_rooms function with timeout
        try:
            asyncio.set_event_loop(thread_local.loop)
            task = asyncio.ensure_future(match_interests_with_rooms(interests), loop=thread_local.loop)
            
            # Set timeout for the task
            try:
                result = thread_local.loop.run_until_complete(
                    asyncio.wait_for(task, timeout=timeout_seconds)
                )
                logger.info(f"Room recommendation completed successfully with {len(result) if result else 0} results")
            except asyncio.TimeoutError:
                # Handle timeout explicitly
                logger.error(f"Async operation timed out after {timeout_seconds} seconds")
                if not task.done():
                    # Try to cancel the task
                    task.cancel()
                    try:
                        # Wait a short time for cancellation to complete
                        thread_local.loop.run_until_complete(asyncio.sleep(0.1))
                    except (asyncio.CancelledError, Exception):
                        pass
                return []  # Return empty list on timeout
            
            # Ensure result is a list
            if result is None:
                logger.warning("match_interests_with_rooms returned None, returning empty list")
                return []
                
            return result
        except Exception as e:
            logger.error(f"Error in async execution: {e}")
            logger.error(traceback.format_exc())
            return []
    except Exception as e:
        logger.error(f"Error getting room recommendations: {e}")
        logger.error(traceback.format_exc())
        # Return empty list instead of None when errors occur
        return []
    finally:
        # Clean up resources
        try:
            # Only close the loop if it exists and is not already closed
            if hasattr(thread_local, 'loop') and not thread_local.loop.is_closed():
                # Run loop cleanup
                pending = asyncio.all_tasks(thread_local.loop)
                if pending:
                    logger.warning(f"Cancelling {len(pending)} pending tasks")
                    for task in pending:
                        task.cancel()
                    # Allow tasks time to respond to cancellation
                    try:
                        thread_local.loop.run_until_complete(asyncio.sleep(0.1))
                    except (asyncio.CancelledError, Exception):
                        pass
                
                # IMPORTANT: Only close the loop if we created it and it's not currently running
                # This prevents the "Cannot close a running event loop" error
                if not thread_local.loop.is_running():
                    thread_local.loop.close()
                    logger.debug("Closed thread-local event loop")
                else:
                    logger.debug("Loop is still running, skipping close")
        except Exception as cleanup_error:
            logger.error(f"Error during event loop cleanup: {cleanup_error}")
            # Continue with function return despite cleanup errors

# Add a function to send welcome message to a Matrix user and invite them to recommended rooms
async def send_welcome_and_invite_to_rooms(matrix_user_id: str, interests: str, welcome_message: str) -> Dict[str, Any]:
    """
    Send a welcome message to a Matrix user and invite them to recommended rooms.
    
    Args:
        matrix_user_id: Matrix user ID
        interests: User interests as a string
        welcome_message: Welcome message to send to the user
        
    Returns:
        Dict[str, Any]: Results including message status and room invitations
    """
    result = {
        "message_sent": False,
        "rooms_invited": [],
        "errors": []
    }
    
    try:
        # Import here to avoid circular imports
        from app.utils.matrix_actions import send_matrix_message
        
        # Step 1: Send welcome message
        try:
            # Create a direct chat and send welcome message
            success = await send_matrix_message(matrix_user_id, welcome_message)
            result["message_sent"] = success
            if not success:
                result["errors"].append("Failed to send welcome message")
        except Exception as e:
            logger.error(f"Error sending welcome message to Matrix user: {e}")
            result["errors"].append(f"Error sending welcome message: {str(e)}")
            
        # Step 2: Get room recommendations based on interests
        try:
            recommended_rooms = await match_interests_with_rooms(interests)
            
            # Step 3: Invite user to recommended rooms
            for room in recommended_rooms:
                room_id = room.get("room_id")
                if not room_id:
                    continue
                    
                room_name = room.get("name", "Unknown room")
                try:
                    from app.utils.matrix_actions import invite_to_matrix_room
                    success = await invite_to_matrix_room(room_id, matrix_user_id)
                    result["rooms_invited"].append({
                        "room_id": room_id,
                        "room_name": room_name,
                        "success": success
                    })
                except Exception as room_error:
                    logger.error(f"Error inviting to room {room_name}: {room_error}")
                    result["errors"].append(f"Error inviting to {room_name}: {str(room_error)}")
                    
        except Exception as e:
            logger.error(f"Error getting room recommendations: {e}")
            result["errors"].append(f"Error getting room recommendations: {str(e)}")
            
        return result
    except Exception as e:
        logger.error(f"Error in send_welcome_and_invite_to_rooms: {e}")
        logger.error(traceback.format_exc())
        result["errors"].append(f"Unexpected error: {str(e)}")
        return result

# Synchronous wrapper for the welcome message and room invitation function
def send_welcome_and_invite_to_rooms_sync(matrix_user_id: str, interests: str, welcome_message: str) -> Dict[str, Any]:
    """
    Synchronous wrapper for sending welcome message and inviting to rooms.
    
    Args:
        matrix_user_id: Matrix user ID
        interests: User interests as a string
        welcome_message: Welcome message to send to the user
        
    Returns:
        Dict[str, Any]: Results including message status and room invitations
    """
    try:
        import nest_asyncio
        nest_asyncio.apply()
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(send_welcome_and_invite_to_rooms(matrix_user_id, interests, welcome_message))
    except Exception as e:
        logger.error(f"Error in send_welcome_and_invite_to_rooms_sync: {e}")
        logger.error(traceback.format_exc())
        return {
            "message_sent": False,
            "rooms_invited": [],
            "errors": [f"Sync wrapper error: {str(e)}"]
        }
    finally:
        if 'loop' in locals() and not loop.is_closed():
            loop.close()