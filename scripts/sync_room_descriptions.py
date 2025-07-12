#!/usr/bin/env python3
"""
Matrix Room Description Sync Script

This script fetches room descriptions from the Matrix API using configured room IDs
and stores them in the database for fast room recommendations without repeated API calls.

Usage:
    python scripts/sync_room_descriptions.py
"""

import asyncio
import logging
import os
import sys
from typing import Dict, List, Optional

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils.config import Config
from app.utils.matrix_actions import get_matrix_client
from app.db.session import get_db
from app.db.models import MatrixRoom
from sqlalchemy.orm import Session
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class RoomDescriptionSyncer:
    """Handles syncing room descriptions from Matrix API to database."""
    
    def __init__(self):
        self.client = None
        self.db: Optional[Session] = None
        
    async def initialize(self):
        """Initialize Matrix client and database connection."""
        try:
            self.client = await get_matrix_client()
            if not self.client:
                raise Exception("Failed to get Matrix client")
            
            self.db = next(get_db())
            logger.info("Initialized Matrix client and database connection")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize: {e}")
            return False
    
    def get_configured_rooms(self) -> Dict[str, Dict[str, str]]:
        """Extract room IDs and metadata from environment configuration."""
        rooms = {}
        
        try:
            # Get configured rooms from environment variables
            configured_rooms = Config.get_configured_rooms()
            
            for room_data in configured_rooms:
                room_id = room_data.get('room_id')
                if room_id and room_id.startswith('!') and ':' in room_id:
                    rooms[room_id] = {
                        'name': room_data.get('name', ''),
                        'categories': room_data.get('categories', []),
                        'description': room_data.get('description', ''),
                        'env_key': room_data.get('env_key', '')
                    }
            
            logger.info(f"Found {len(rooms)} configured rooms")
            return rooms
            
        except Exception as e:
            logger.error(f"Error parsing configured rooms: {e}")
            return {}
    
    async def fetch_room_info(self, room_id: str) -> Optional[Dict[str, str]]:
        """Fetch room information from Matrix API."""
        try:
            # Get room state events
            room_state = await self.client.room_get_state(room_id)
            
            if hasattr(room_state, 'transport_response') and room_state.transport_response.status != 200:
                logger.warning(f"Failed to get state for room {room_id}: {room_state}")
                return None
            
            room_info = {
                'name': '',
                'topic': '',
                'canonical_alias': '',
                'member_count': 0
            }
            
            # Parse state events
            if hasattr(room_state, 'events'):
                for event in room_state.events:
                    if event['type'] == 'm.room.name':
                        room_info['name'] = event.get('content', {}).get('name', '')
                    elif event['type'] == 'm.room.topic':
                        room_info['topic'] = event.get('content', {}).get('topic', '')
                    elif event['type'] == 'm.room.canonical_alias':
                        room_info['canonical_alias'] = event.get('content', {}).get('alias', '')
            
            # Get member count
            try:
                members_response = await self.client.joined_members(room_id)
                if hasattr(members_response, 'members'):
                    room_info['member_count'] = len(members_response.members)
            except Exception as e:
                logger.warning(f"Could not get member count for {room_id}: {e}")
            
            logger.info(f"Fetched info for room {room_id}: {room_info['name']}")
            return room_info
            
        except Exception as e:
            logger.error(f"Error fetching room info for {room_id}: {e}")
            return None
    
    def store_room_info(self, room_id: str, room_info: Dict[str, str], configured_data: Dict[str, str]):
        """Store or update room information in database."""
        try:
            # Check if room already exists
            existing_room = self.db.query(MatrixRoom).filter(MatrixRoom.room_id == room_id).first()
            
            if existing_room:
                # Update existing room
                existing_room.name = room_info.get('name') or configured_data.get('name', '')
                existing_room.display_name = configured_data.get('name', '') or room_info.get('name', '')
                existing_room.topic = room_info.get('topic') or configured_data.get('description', '')
                existing_room.canonical_alias = room_info.get('canonical_alias', '')
                existing_room.member_count = room_info.get('member_count', 0)
                existing_room.last_synced = datetime.utcnow()
                existing_room.updated_at = datetime.utcnow()
                
                logger.info(f"Updated room {room_id} in database")
            else:
                # Create new room
                new_room = MatrixRoom(
                    room_id=room_id,
                    name=room_info.get('name') or configured_data.get('name', ''),
                    display_name=configured_data.get('name', '') or room_info.get('name', ''),
                    topic=room_info.get('topic') or configured_data.get('description', ''),
                    canonical_alias=room_info.get('canonical_alias', ''),
                    member_count=room_info.get('member_count', 0),
                    room_type='public',  # Assume public for configured rooms
                    is_direct=False,
                    last_synced=datetime.utcnow()
                )
                
                self.db.add(new_room)
                logger.info(f"Created new room {room_id} in database")
            
            self.db.commit()
            
        except Exception as e:
            logger.error(f"Error storing room info for {room_id}: {e}")
            self.db.rollback()
    
    async def sync_all_rooms(self):
        """Sync all configured rooms with Matrix API."""
        configured_rooms = self.get_configured_rooms()
        
        if not configured_rooms:
            logger.warning("No configured rooms found")
            return
        
        success_count = 0
        error_count = 0
        
        for room_id, configured_data in configured_rooms.items():
            try:
                logger.info(f"Syncing room: {room_id} ({configured_data.get('name', 'Unknown')})")
                
                # Fetch room info from Matrix API
                room_info = await self.fetch_room_info(room_id)
                
                if room_info:
                    # Store in database
                    self.store_room_info(room_id, room_info, configured_data)
                    success_count += 1
                else:
                    # Store configured data even if API fetch failed
                    self.store_room_info(room_id, {}, configured_data)
                    error_count += 1
                    logger.warning(f"Used configured data for {room_id} due to API fetch failure")
                
            except Exception as e:
                logger.error(f"Error syncing room {room_id}: {e}")
                error_count += 1
        
        logger.info(f"Room sync completed. Success: {success_count}, Errors: {error_count}")
    
    async def cleanup(self):
        """Clean up resources."""
        if self.client:
            await self.client.close()
        if self.db:
            self.db.close()

async def main():
    """Main function to run the room description sync."""
    syncer = RoomDescriptionSyncer()
    
    try:
        logger.info("Starting Matrix room description sync...")
        
        # Initialize
        if not await syncer.initialize():
            logger.error("Failed to initialize syncer")
            return 1
        
        # Sync all rooms
        await syncer.sync_all_rooms()
        
        logger.info("Room description sync completed successfully")
        return 0
        
    except Exception as e:
        logger.error(f"Room sync failed: {e}")
        return 1
        
    finally:
        await syncer.cleanup()

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)