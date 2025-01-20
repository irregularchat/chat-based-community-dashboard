from db.database import engine, Base, SessionLocal
from db.operations import User, AdminEvent, sync_user_data
from sqlalchemy import inspect, MetaData, func
import logging
import requests
from utils.config import Config
from auth.api import list_users
from datetime import datetime, timedelta

def should_sync_users(db: SessionLocal) -> bool:
    """
    Determine if we need to sync users based on:
    1. Last sync time (stored in admin_events)
    2. User count difference
    """
    try:
        # Check last sync time from admin_events
        last_sync = db.query(AdminEvent)\
            .filter(AdminEvent.event_type == 'system_sync')\
            .order_by(AdminEvent.timestamp.desc())\
            .first()
        
        # If no sync record or last sync was more than 6 hours ago
        if not last_sync or \
           (datetime.now() - last_sync.timestamp) > timedelta(hours=6):
            return True

        # Get local user count
        local_count = db.query(func.count(User.id)).scalar()
        
        # Get Authentik user count
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
        authentik_count = len(authentik_users) if authentik_users else 0
        
        # If counts differ significantly (more than 10% difference)
        if abs(local_count - authentik_count) > (local_count * 0.10):
            return True
            
        return False
    except Exception as e:
        logging.error(f"Error checking sync status: {e}")
        # Only sync on error if there's no recent sync
        if not last_sync or \
           (datetime.now() - last_sync.timestamp) > timedelta(hours=12):
            return True
        return False

def init_db():
    """Initialize database tables and sync with Authentik users if needed"""
    try:
        # Ensure models are registered with Base.metadata
        from db.operations import User, AdminEvent
        
        # Create inspector and check/create tables
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
            # Check if sync is needed
            if should_sync_users(db):
                logging.info("Starting user sync process...")
                headers = {
                    'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                    'Content-Type': 'application/json'
                }
                
                authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
                
                if authentik_users:
                    # Sync users
                    sync_user_data(db, authentik_users)
                    
                    # Record sync event
                    sync_event = AdminEvent(
                        timestamp=datetime.now(),
                        event_type='system_sync',
                        username='system',
                        description=f'Synced {len(authentik_users)} users from Authentik'
                    )
                    db.add(sync_event)
                    db.commit()
                    
                    logging.info(f"Successfully synced {len(authentik_users)} users from Authentik")
                else:
                    logging.warning("No users fetched from Authentik API")
            else:
                logging.info("User sync not needed at this time")
                
        except Exception as e:
            logging.error(f"Error during database initialization: {e}")
            raise
        finally:
            db.close()
            
    except Exception as e:
        logging.error(f"Error initializing database: {e}")
        raise 