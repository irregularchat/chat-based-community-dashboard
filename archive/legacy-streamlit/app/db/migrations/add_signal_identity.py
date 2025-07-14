# Migration to add signal identity fields
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)

def migrate(db):
    """
    Add signal identity fields to the users table if they don't exist.
    This migration adds support for Signal usernames and identity fields.
    """
    try:
        # Check if signal_username column exists
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'signal_username'
        """))
        
        if not result.fetchone():
            # Add signal_username column
            db.execute(text("ALTER TABLE users ADD COLUMN signal_username VARCHAR(255)"))
            logger.info("Added signal_username column to users table")
        
        # Check if signal_identity column exists
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'signal_identity'
        """))
        
        if not result.fetchone():
            # Add signal_identity column
            db.execute(text("ALTER TABLE users ADD COLUMN signal_identity TEXT"))
            logger.info("Added signal_identity column to users table")
        
        db.commit()
        logger.info("Signal identity migration completed successfully")
        return True
    except Exception as e:
        logger.error(f"Error in signal identity migration: {str(e)}")
        db.rollback()
        return False 