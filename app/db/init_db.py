from db.database import engine, Base, SessionLocal
from db.operations import User, AdminEvent, sync_user_data
from sqlalchemy import inspect
import logging
from utils.config import Config
from auth.api import list_users
from datetime import datetime, timedelta

def should_sync_users(db: SessionLocal) -> bool:
    """
    Determine if we need to sync users based solely on:
    1. No sync record found.
    2. Last sync was more than 6 hours ago.
    """
    try:
        # Check latest 'system_sync' event timestamp
        last_sync = (
            db.query(AdminEvent)
              .filter(AdminEvent.event_type == 'system_sync')
              .order_by(AdminEvent.timestamp.desc())
              .first()
        )

        # If no record or last sync was more than 6 hours ago -> True
        if not last_sync or (datetime.now() - last_sync.timestamp) > timedelta(hours=6):
            return True

        return False
    except Exception as e:
        logging.error(f"Error checking sync status: {e}")
        # Decide if you want to sync if an error occurs
        return False

def init_db():
    """Initialize database tables and sync with Authentik users if needed."""
    try:
        # Ensure models are registered with Base.metadata
        from db.operations import User, AdminEvent

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
            # Check if we need to sync (now only a 6-hour interval)
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
                logging.info("User sync is not needed at this time")

        except Exception as e:
            logging.error(f"Error during database initialization: {e}")
            raise
        finally:
            db.close()

    except Exception as e:
        logging.error(f"Error initializing database: {e}")
        raise 