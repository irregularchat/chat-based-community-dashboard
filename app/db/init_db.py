from app.db.database import engine, Base, SessionLocal
import requests
from app.db.operations import User, AdminEvent, sync_user_data, sync_user_data_incremental, MatrixRoomMember
from sqlalchemy import inspect
import logging
from app.utils.config import Config
from app.auth.api import list_users, session, get_last_modified_timestamp, get_users_modified_since
from datetime import datetime, timedelta
import streamlit as st
from app.auth.admin import init_admin_users

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

def create_admin_event(db, event_type, username, details):
    """Helper function to create admin events"""
    event = AdminEvent(
        timestamp=datetime.now(),
        event_type=event_type,
        username=username,
        details=details
    )
    db.add(event)
    db.commit()
    return event

def create_default_admin_user(db):
    """
    Create the default admin user if it doesn't exist.
    This ensures there's always at least one admin account for first-time setup.
    
    Args:
        db: Database session
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Check if default admin user exists
        default_username = Config.DEFAULT_ADMIN_USERNAME
        default_password = Config.DEFAULT_ADMIN_PASSWORD
        
        if not default_username or not default_password:
            logging.warning("Default admin credentials not configured, skipping default admin creation")
            return False
            
        # Check if user already exists in database
        existing_user = db.query(User).filter(User.username == default_username).first()
        if existing_user:
            logging.info(f"Default admin user '{default_username}' already exists")
            
            # Ensure the user has admin privileges
            if not existing_user.is_admin:
                existing_user.is_admin = True
                db.commit()
                logging.info(f"Updated '{default_username}' to have admin privileges")
                
            return True
            
        # User doesn't exist, check if we can create it in Authentik
        if not Config.AUTHENTIK_API_TOKEN or not Config.AUTHENTIK_API_URL:
            logging.warning("Authentik API not configured, cannot create default admin user")
            return False
            
        # Create the user in Authentik
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        user_data = {
            'username': default_username,
            'name': 'Default Admin',
            'password': default_password,
            'path': 0,  # Standard users group
            'groups': [Config.MAIN_GROUP_ID] if Config.MAIN_GROUP_ID else []
        }
        
        logging.info(f"Creating default admin user: {default_username}")
        
        user_url = f"{Config.AUTHENTIK_API_URL}/core/users/"
        response = requests.post(user_url, json=user_data, headers=headers)
        
        if response.status_code == 201:
            user_id = response.json().get('pk')
            
            # Create user in local database
            db_user = User(
                username=default_username,
                email=f"{default_username}@{Config.BASE_DOMAIN}" if Config.BASE_DOMAIN else None,
                first_name='Default',
                last_name='Admin',
                is_active=True,
                is_admin=True,
                authentik_id=user_id
            )
            db.add(db_user)
            db.commit()
            
            logging.info(f"Default admin user '{default_username}' created successfully")
            
            # Log the admin creation
            create_admin_event(
                db, 
                "admin_created", 
                "system", 
                f"Default admin user '{default_username}' created during initialization"
            )
            
            return True
        else:
            error_message = f"Error: {response.status_code}"
            try:
                error_data = response.json()
                error_message = "\n".join([f"{k}: {', '.join(v)}" for k, v in error_data.items() if isinstance(v, list)])
            except:
                pass
            
            logging.error(f"Failed to create default admin user: {error_message}")
            return False
            
    except Exception as e:
        logging.error(f"Error creating default admin user: {e}")
        return False

def init_db():
    """Initialize the database by creating all tables"""
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
        
        # Run database migrations
        try:
            logging.info("Running database migrations...")
            from app.db.migrations.add_signal_identity import migrate as add_signal_identity_migration
            add_signal_identity_migration()
            logging.info("Database migrations completed")
        except Exception as e:
            logging.error(f"Error running database migrations: {e}")

        # Create a database session
        db = SessionLocal()
        try:
            # Create default admin user if needed
            try:
                logging.info("Checking for default admin user...")
                create_default_admin_user(db)
            except Exception as e:
                logging.error(f"Error checking/creating default admin user: {e}")
            
            # Initialize admin users from configuration
            try:
                logging.info("Initializing admin users from configuration...")
                init_admin_users()
                logging.info("Admin users initialized successfully")
            except Exception as e:
                logging.error(f"Error initializing admin users: {e}")

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
                                    details=f'Full sync of {len(authentik_users)} users from Authentik'
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
                                    details=f'Incremental sync of {len(modified_users)} modified users from Authentik'
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
                                details='No modified users found since last sync'
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