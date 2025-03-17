from app.db.database import engine, Base, SessionLocal
import requests
from app.db.operations import User, AdminEvent, sync_user_data, sync_user_data_incremental, MatrixRoomMember
from sqlalchemy import inspect
import logging
from app.utils.config import Config
from app.auth.api import list_users, session, get_last_modified_timestamp, get_users_modified_since
from datetime import datetime, timedelta
import streamlit as st

def should_sync_users(db: SessionLocal) -> bool:
    """
    Determine if we need to sync users based on:
    1. No sync record found.
    2. Last sync was more than 6 hours ago.
    3. Recent modifications in Authentik (checked via last_updated timestamp).
    """
    try:
        # Check if sync is already in progress
        if 'sync_in_progress' in st.session_state and st.session_state['sync_in_progress']:
            logging.info("Sync already in progress, skipping check")
            return False
            
        # Check if we've checked for changes recently (within the last hour)
        if 'last_change_check' in st.session_state:
            time_since_check = datetime.now() - st.session_state['last_change_check']
            if time_since_check < timedelta(hours=1):
                logging.info(f"Change check performed recently ({time_since_check.total_seconds()/60:.1f} minutes ago), skipping")
                return False
        
        # Update the last change check time
        st.session_state['last_change_check'] = datetime.now()
        
        # Check latest 'system_sync' event timestamp
        last_sync = (
            db.query(AdminEvent)
              .filter(AdminEvent.event_type == 'system_sync')
              .order_by(AdminEvent.timestamp.desc())
              .first()
        )

        # If no record or last sync was more than 6 hours ago -> True
        if not last_sync:
            logging.info("No previous sync found, full sync needed")
            return True
            
        # Check if last sync was more than 6 hours ago
        time_since_sync = datetime.now() - last_sync.timestamp
        if time_since_sync > timedelta(hours=6):
            logging.info(f"Last sync was {time_since_sync.total_seconds()/3600:.1f} hours ago, sync needed")
            return True
            
        logging.info(f"Last sync was {time_since_sync.total_seconds()/3600:.1f} hours ago, no sync needed")
        return False
            
    except Exception as e:
        logging.error(f"Error checking sync status: {e}")
        return False

def init_db():
    """Initialize the database by creating all tables"""
    Base.metadata.create_all(bind=engine)

    try:
        # Ensure models are registered with Base.metadata
        from app.db.operations import User, AdminEvent

        # Check if required tables exist; create them if not
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()
        required_tables = ['users', 'admin_events']

        if not all(table in existing_tables for table in required_tables):
            logging.info("Creating database tables...")
            Base.metadata.create_all(bind=engine)
            logging.info("Database tables created successfully")

        # Create a database session
        db = SessionLocal()
        try:
            # Check if we need to sync
            if should_sync_users(db):
                # Set sync in progress flag
                st.session_state['sync_in_progress'] = True
                
                logging.info("Starting user sync process...")
                headers = {
                    'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                    'Content-Type': 'application/json'
                }

                try:
                    # Check if this is the first sync or a full sync is needed
                    last_sync = (
                        db.query(AdminEvent)
                          .filter(AdminEvent.event_type == 'system_sync')
                          .order_by(AdminEvent.timestamp.desc())
                          .first()
                    )
                    
                    # Determine if we need a full sync or incremental sync
                    if not last_sync or (datetime.now() - last_sync.timestamp) > timedelta(hours=24):
                        # Full sync needed
                        logging.info("Performing full sync (first sync or more than 24 hours since last full sync)")
                        authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
                        
                        if authentik_users:
                            logging.info(f"Fetched {len(authentik_users)} users from Authentik API")
                            
                            # Use the incremental sync with full_sync=True
                            success = sync_user_data_incremental(db, authentik_users, full_sync=True)
                            
                            if success:
                                # Record sync event
                                sync_event = AdminEvent(
                                    timestamp=datetime.now(),
                                    event_type='system_sync',
                                    username='system',
                                    description=f'Full sync of {len(authentik_users)} users from Authentik'
                                )
                                db.add(sync_event)
                                db.commit()
                                
                                logging.info(f"Successfully completed full sync of {len(authentik_users)} users from Authentik")
                            else:
                                logging.error("Full sync failed")
                        else:
                            logging.warning("No users fetched from Authentik API for full sync")
                    else:
                        # Incremental sync - only get users modified since last sync
                        logging.info(f"Performing incremental sync (last sync: {last_sync.timestamp})")
                        
                        # Get users modified since the last sync
                        modified_users = get_users_modified_since(
                            Config.AUTHENTIK_API_URL, 
                            headers, 
                            last_sync.timestamp
                        )
                        
                        if modified_users:
                            logging.info(f"Fetched {len(modified_users)} modified users from Authentik API")
                            
                            # Use the incremental sync with full_sync=False
                            success = sync_user_data_incremental(db, modified_users, full_sync=False)
                            
                            if success:
                                # Record sync event
                                sync_event = AdminEvent(
                                    timestamp=datetime.now(),
                                    event_type='system_sync',
                                    username='system',
                                    description=f'Incremental sync of {len(modified_users)} modified users from Authentik'
                                )
                                db.add(sync_event)
                                db.commit()
                                
                                logging.info(f"Successfully completed incremental sync of {len(modified_users)} modified users from Authentik")
                            else:
                                logging.error("Incremental sync failed")
                        else:
                            logging.info("No modified users found since last sync")
                            
                            # Still record a sync event to update the timestamp
                            sync_event = AdminEvent(
                                timestamp=datetime.now(),
                                event_type='system_sync',
                                username='system',
                                description='No modified users found since last sync'
                            )
                            db.add(sync_event)
                            db.commit()
                    
                    # Verify the sync worked
                    local_count = db.query(User).count()
                    logging.info(f"Local database now has {local_count} users")
                    
                except Exception as e:
                    logging.error(f"Error during user sync: {e}")
                    db.rollback()
                finally:
                    # Clear sync in progress flag
                    st.session_state['sync_in_progress'] = False
            else:
                logging.info("User sync is not needed at this time")

        except Exception as e:
            logging.error(f"Error during database initialization: {e}")
            db.rollback()
            # Clear sync in progress flag in case of error
            if 'sync_in_progress' in st.session_state:
                st.session_state['sync_in_progress'] = False
        finally:
            db.close()

    except Exception as e:
        logging.error(f"Error initializing database: {e}")
        # Clear sync in progress flag in case of error
        if 'sync_in_progress' in st.session_state:
            st.session_state['sync_in_progress'] = False 