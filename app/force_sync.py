#!/usr/bin/env python3
"""
Standalone script to force synchronization of users from Authentik to the local database.
Run this script directly to perform a full sync regardless of the last sync time.

Usage:
    python -m app.force_sync [--incremental]

Options:
    --incremental    Perform an incremental sync (only changed users)
"""

import os
import sys
import logging
from datetime import datetime, timedelta
import asyncio
import json
import aiohttp
import time
import streamlit as st
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.auth.api import list_users, get_users_modified_since
from app.db.database import SessionLocal, get_db
from app.db.operations import User, AdminEvent, sync_user_data_incremental
from app.utils.config import Config

def force_sync(incremental=False):
    """
    Force synchronization of users from Authentik to the local database.
    
    Args:
        incremental: If True, only sync users that have changed since the last sync
    """
    logging.info(f"Starting {'incremental' if incremental else 'full'} user synchronization...")
    
    # Create a database session
    db = SessionLocal()
    try:
        # Get the current user count
        initial_count = db.query(User).count()
        logging.info(f"Initial user count in local database: {initial_count}")
        
        # Set up headers for API requests
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        if incremental:
            # Get the last sync timestamp
            last_sync = (
                db.query(AdminEvent)
                  .filter(AdminEvent.event_type == 'system_sync')
                  .order_by(AdminEvent.timestamp.desc())
                  .first()
            )
            
            if not last_sync:
                logging.warning("No previous sync found. Performing full sync instead.")
                incremental = False
            else:
                logging.info(f"Getting users modified since {last_sync.timestamp}...")
                # Get users modified since the last sync
                authentik_users = get_users_modified_since(
                    Config.AUTHENTIK_API_URL, 
                    headers, 
                    last_sync.timestamp
                )
                
                if not authentik_users:
                    logging.info("No modified users found since last sync.")
                    # Still record a sync event to update the timestamp
                    sync_event = AdminEvent(
                        timestamp=datetime.now(),
                        event_type='system_sync',
                        username='system',
                        details='No modified users found since last sync'
                    )
                    db.add(sync_event)
                    db.commit()
                    return
        
        # If not incremental or no last sync found, get all users
        if not incremental:
            logging.info("Fetching all users from Authentik...")
            authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
        
        if not authentik_users:
            logging.error("No users fetched from Authentik API")
            return
            
        total_users = len(authentik_users)
        logging.info(f"Fetched {total_users} users from Authentik API")
        
        # Use the incremental sync function
        success = sync_user_data_incremental(db, authentik_users, full_sync=not incremental)
        
        if success:
            # Record sync event
            sync_event = AdminEvent(
                timestamp=datetime.now(),
                event_type='system_sync',
                username='system',
                details=f'{"Incremental" if incremental else "Full"} sync completed successfully'
            )
            db.add(sync_event)
            db.commit()
            
            # Verify the sync worked
            final_count = db.query(User).count()
            logging.info(f"Final user count in local database: {final_count}")
            logging.info(f"Change in user count: {final_count - initial_count}")
            logging.info(f"{'Incremental' if incremental else 'Full'} user synchronization completed successfully")
        else:
            logging.error(f"{'Incremental' if incremental else 'Full'} sync failed")
        
    except Exception as e:
        logging.error(f"Error during forced user synchronization: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Force synchronization of users from Authentik to the local database.')
    parser.add_argument('--incremental', action='store_true', help='Perform an incremental sync (only changed users)')
    args = parser.parse_args()
    
    force_sync(incremental=args.incremental) 