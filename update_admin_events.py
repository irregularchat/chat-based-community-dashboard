#!/usr/bin/env python3
"""
Script to update existing admin events with improved formatting and emojis.
This will retroactively apply the new formatting to existing events in the database.
"""

import sys
import os
sys.path.append('.')

from app.db.session import get_db
from app.db.models import AdminEvent
from app.db.operations import _format_admin_event_details
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def update_existing_admin_events():
    """Update existing admin events with improved formatting."""
    
    db = next(get_db())
    try:
        # Get all admin events
        events = db.query(AdminEvent).all()
        logger.info(f"Found {len(events)} admin events to potentially update")
        
        updated_count = 0
        skipped_count = 0
        
        for event in events:
            original_details = event.details
            
            # Apply the new formatting
            formatted_details = _format_admin_event_details(db, event.event_type, original_details)
            
            # If formatting returns None, mark event for deletion (noise events)
            if formatted_details is None:
                logger.info(f"Marking event for deletion: {event.event_type} - {original_details[:50]}...")
                db.delete(event)
                skipped_count += 1
                continue
            
            # If the formatting changed, update the event
            if formatted_details != original_details:
                logger.info(f"Updating event: {original_details[:50]}... -> {formatted_details[:50]}...")
                event.details = formatted_details
                updated_count += 1
        
        # Commit all changes
        db.commit()
        
        logger.info(f"✅ Updated {updated_count} events")
        logger.info(f"🗑️ Deleted {skipped_count} noise events")
        logger.info(f"📊 Total events processed: {len(events)}")
        
    except Exception as e:
        logger.error(f"Error updating admin events: {e}")
        db.rollback()
    finally:
        db.close()

def preview_changes():
    """Preview what changes would be made without actually updating."""
    
    db = next(get_db())
    try:
        # Get all admin events
        events = db.query(AdminEvent).order_by(AdminEvent.timestamp.desc()).limit(20).all()
        logger.info(f"Previewing changes for the latest {len(events)} admin events:")
        
        for event in events:
            original_details = event.details
            formatted_details = _format_admin_event_details(db, event.event_type, original_details)
            
            print(f"\n--- Event Type: {event.event_type} ---")
            print(f"Original: {original_details}")
            
            if formatted_details is None:
                print(f"Action: DELETE (noise event)")
            elif formatted_details != original_details:
                print(f"Updated:  {formatted_details}")
            else:
                print(f"Action: NO CHANGE")
                
    except Exception as e:
        logger.error(f"Error previewing changes: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Update admin events with improved formatting')
    parser.add_argument('--preview', action='store_true', help='Preview changes without applying them')
    parser.add_argument('--apply', action='store_true', help='Apply the changes to the database')
    
    args = parser.parse_args()
    
    if args.preview:
        preview_changes()
    elif args.apply:
        update_existing_admin_events()
    else:
        print("Usage: python update_admin_events.py --preview  (to preview changes)")
        print("       python update_admin_events.py --apply    (to apply changes)") 