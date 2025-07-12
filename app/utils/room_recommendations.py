"""
Room Recommendations Utility

Separates configured .env rooms from general room search functionality
for improved user creation workflow.
"""

import logging
from typing import List, Dict, Any, Optional
from app.utils.config import Config

logger = logging.getLogger(__name__)

def get_configured_room_recommendations(interests: str = "") -> List[Dict[str, Any]]:
    """
    Get room recommendations from configured .env rooms only.
    These are the primary Signal groups that should be auto-recommended.
    
    Args:
        interests: User interests for matching (optional)
        
    Returns:
        List of configured room dictionaries with recommendation scores
    """
    try:
        configured_rooms = Config.get_configured_rooms()
        
        if not configured_rooms:
            logger.warning("No configured rooms found in .env")
            return []
        
        logger.info(f"Found {len(configured_rooms)} configured rooms from Config.get_configured_rooms()")
        
        # Convert to recommendation format with all configured rooms
        recommendations = []
        
        for i, room in enumerate(configured_rooms):
            try:
                # Safely get room data with proper fallbacks
                room_id = room.get('room_id', '')
                room_name = room.get('name', room.get('room_id', 'Unknown Room'))
                room_description = room.get('description', '')
                room_categories = room.get('categories', [])
                
                # Skip rooms without essential data
                if not room_id:
                    logger.warning(f"Skipping room {i} with no room_id: {room}")
                    continue
                    
                room_data = {
                    'room_id': room_id,
                    'name': room_name,
                    'description': room_description,
                    'topic': room_description,
                    'categories': room_categories,
                    'configured': True,
                    'auto_recommend': True,  # These should be auto-checked
                    'match_score': 100,  # High score for configured rooms
                    'source': 'configured'
                }
            except Exception as room_error:
                logger.error(f"Error processing room {i}: {room_error}")
                logger.error(f"Room data: {room}")
                continue
            
            # Add category keywords for better display
            if room.get('categories'):
                categories_config = Config.get_configured_categories()
                category_keywords = []
                for cat_name in room['categories']:
                    for cat_id, cat_config in categories_config.items():
                        if cat_config['display_name'] == cat_name:
                            category_keywords.extend(cat_config['keywords'][:3])  # Top 3 keywords
                room_data['category_keywords'] = category_keywords
            
            recommendations.append(room_data)
        
        # Sort by name for consistent display
        recommendations.sort(key=lambda r: r['name'])
        
        logger.info(f"Loaded {len(recommendations)} configured room recommendations")
        return recommendations
        
    except Exception as e:
        logger.error(f"Error getting configured room recommendations: {e}")
        return []

def get_non_configured_rooms_search(search_query: str, category: str = None) -> List[Dict[str, Any]]:
    """
    Search for rooms beyond the configured .env rooms.
    This is for manual discovery of additional rooms.
    
    Args:
        search_query: Search terms
        category: Optional category filter
        
    Returns:
        List of room dictionaries from database/API (excluding configured rooms)
    """
    try:
        from app.db.session import get_db
        from app.db.models import MatrixRoom
        
        # Get configured room IDs to exclude
        configured_rooms = Config.get_configured_rooms()
        configured_room_ids = {room.get('room_id') for room in configured_rooms if room.get('room_id')}
        
        search_results = []
        
        # Search database for non-configured rooms
        db = next(get_db())
        try:
            search_keywords = [kw.strip().lower() for kw in search_query.split(',') if kw.strip()]
            
            if search_keywords:
                for keyword in search_keywords:
                    if len(keyword) > 2:  # Only use keywords with reasonable length
                        # Search in room name, topic, or description
                        matching_rooms = db.query(MatrixRoom).filter(
                            db.or_(
                                MatrixRoom.name.ilike(f"%{keyword}%"),
                                MatrixRoom.topic.ilike(f"%{keyword}%")
                            )
                        ).filter(
                            ~MatrixRoom.room_id.in_(configured_room_ids)  # Exclude configured rooms
                        ).filter(
                            MatrixRoom.member_count > Config.MATRIX_MIN_ROOM_MEMBERS  # Only active rooms
                        ).all()
                        
                        # Add to results
                        for room in matching_rooms:
                            if room.room_id not in [r['room_id'] for r in search_results]:  # Avoid duplicates
                                search_results.append({
                                    'room_id': room.room_id,
                                    'name': room.name or room.room_id,
                                    'topic': room.topic or "",
                                    'description': room.topic or "",
                                    'member_count': room.member_count,
                                    'configured': False,
                                    'auto_recommend': False,
                                    'match_score': 50,  # Lower score for non-configured
                                    'source': 'database'
                                })
            
            logger.info(f"Found {len(search_results)} non-configured rooms for search: {search_query}")
            return search_results[:20]  # Limit to top 20 results
            
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Error searching non-configured rooms: {e}")
        return []

def format_room_for_display(room: Dict[str, Any], is_configured: bool = False) -> Dict[str, Any]:
    """
    Format a room dictionary for consistent UI display.
    
    Args:
        room: Room dictionary
        is_configured: Whether this is a configured room
        
    Returns:
        Formatted room dictionary
    """
    return {
        'room_id': room.get('room_id', ''),
        'name': room.get('name', f"Room {room.get('room_id', 'Unknown')}"),
        'description': room.get('description', room.get('topic', '')),
        'categories': room.get('categories', []),
        'member_count': room.get('member_count', 0),
        'configured': is_configured,
        'auto_recommend': is_configured,  # Auto-check configured rooms
        'match_score': room.get('match_score', 0),
        'source': room.get('source', 'unknown')
    }

def get_smart_room_selections(configured_rooms: List[Dict[str, Any]], content: str) -> set:
    """
    Intelligently select rooms based on user content (introduction + interests + organization).
    
    Args:
        configured_rooms: List of configured room dictionaries
        content: Combined user content (introduction, interests, organization) in lowercase
        
    Returns:
        Set of room keys that should be selected
    """
    try:
        selected_room_keys = set()
        
        if not content.strip():
            return selected_room_keys
        
        # Define keyword mappings for better matching
        keyword_expansions = {
            # Technology keywords
            'ai': ['artificial intelligence', 'machine learning', 'ml', 'neural', 'deep learning', 'chatgpt', 'llm'],
            'cybersecurity': ['security', 'infosec', 'cyber', 'penetration', 'pentest', 'hacking', 'malware', 'vulnerability'],
            'technology': ['tech', 'software', 'programming', 'coding', 'development', 'engineer', 'developer'],
            'rf': ['radio frequency', 'electronic warfare', 'ew', 'signals', 'sdr', 'spectrum', 'electromagnetic'],
            'drone': ['unmanned', 'uas', 'uav', 'autonomous', 'robotics', 'quadcopter'],
            'fabrication': ['3d printing', 'manufacturing', 'maker', 'cnc', 'prototyping', 'workshop'],
            
            # Professional keywords  
            'business': ['entrepreneur', 'startup', 'management', 'finance', 'corporate', 'sales', 'marketing'],
            'certification': ['cert', 'training', 'education', 'study', 'exam', 'cissp', 'ccna', 'comptia'],
            
            # Location keywords
            'fort bragg': ['bragg', 'fayetteville', 'nc', 'north carolina'],
            'fort campbell': ['campbell', 'kentucky', 'ky', 'clarksville'],
            'dc': ['washington', 'national capital', 'ncr', 'dmv', 'virginia', 'maryland'],
            'tampa': ['florida', 'fl', 'bay area'],
            
            # Social/General keywords
            'outdoor': ['hiking', 'camping', 'nature', 'adventure', 'climbing', 'hunting', 'fishing'],
            'spanish': ['hispanic', 'latino', 'mexico', 'spain', 'latin america'],
            'gaming': ['game', 'video game', 'esports', 'modern warfare', 'call of duty'],
            'debate': ['discussion', 'politics', 'philosophy', 'argument', 'opinion'],
            
            # Information/Research keywords
            'research': ['academic', 'analysis', 'intelligence', 'analyst', 'study', 'investigation'],
            'iwar': ['information warfare', 'psyop', 'influence', 'propaganda', 'cognitive'],
        }
        
        # Create expanded content by adding synonyms
        expanded_content = content
        for keyword, synonyms in keyword_expansions.items():
            for synonym in synonyms:
                if synonym in content:
                    expanded_content += f" {keyword}"
        
        # Score each room based on keyword matches
        room_scores = []
        
        for room in configured_rooms:
            score = 0
            room_key = f"config_room_{room['room_id']}"
            
            # Get room keywords from name, description, categories
            room_keywords = []
            
            # Add room name keywords
            room_name = room.get('name', '').lower()
            room_keywords.append(room_name)
            
            # Add description keywords
            room_desc = room.get('description', '').lower()
            room_keywords.append(room_desc)
            
            # Add category keywords
            for category in room.get('categories', []):
                room_keywords.append(category.lower())
            
            # Add configured category keywords if available
            category_keywords = room.get('category_keywords', [])
            room_keywords.extend([kw.lower() for kw in category_keywords])
            
            # Combine all room keywords into searchable text
            room_text = ' '.join(room_keywords)
            
            # Score based on keyword matches
            for keyword in keyword_expansions.keys():
                if keyword in expanded_content:
                    # Direct keyword match in room text
                    if keyword in room_text:
                        score += 10
                    
                    # Synonym matches
                    for synonym in keyword_expansions[keyword]:
                        if synonym in room_text:
                            score += 5
            
            # Additional direct text matching for specific terms
            content_words = expanded_content.split()
            for word in content_words:
                if len(word) > 3 and word in room_text:  # Only check substantial words
                    score += 2
            
            # Bonus points for exact category matches
            for category in room.get('categories', []):
                if category.lower() in expanded_content:
                    score += 15
            
            if score > 0:
                room_scores.append((room_key, score, room.get('name', 'Unknown')))
        
        # Sort by score and select top rooms
        room_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Select rooms with score > threshold or top 8 rooms, whichever is smaller
        threshold = 5
        selected_rooms = [room for room in room_scores if room[1] >= threshold]
        
        # Limit to top 8 recommendations to avoid overwhelming the user
        selected_rooms = selected_rooms[:8]
        
        selected_room_keys = {room[0] for room in selected_rooms}
        
        if selected_rooms:
            logger.info(f"Smart room selection found {len(selected_rooms)} recommendations:")
            for room_key, score, name in selected_rooms:
                logger.info(f"  - {name} (score: {score})")
        
        return selected_room_keys
        
    except Exception as e:
        logger.error(f"Error in smart room selection: {e}")
        return set()

def get_category_options() -> List[str]:
    """
    Get available category options for filtering.
    
    Returns:
        List of category names
    """
    try:
        categories_config = Config.get_configured_categories()
        category_names = [cat_config['display_name'] for cat_config in categories_config.values()]
        return sorted(category_names)
    except Exception as e:
        logger.error(f"Error getting category options: {e}")
        return []