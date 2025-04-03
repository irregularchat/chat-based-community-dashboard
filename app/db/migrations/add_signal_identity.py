"""
Migration script to add the signal_identity column to the users table.
"""
from sqlalchemy import Column, String, text
import logging
from app.db.database import engine

def migrate():
    """
    Run the migration to add the signal_identity column.
    """
    try:
        # Check if column exists first to avoid errors
        with engine.connect() as conn:
            try:
                # Check if column exists using text() for parameterized query
                check_query = text("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='signal_identity'")
                result = conn.execute(check_query)
                if result.fetchone():
                    logging.info("Column signal_identity already exists in users table.")
                    return True
                
                # Add the column if it doesn't exist
                alter_query = text("ALTER TABLE users ADD COLUMN IF NOT EXISTS signal_identity VARCHAR")
                conn.execute(alter_query)
                conn.commit()
                logging.info("Successfully added signal_identity column to users table.")
                return True
            except Exception as inner_e:
                logging.error(f"Error in signal_identity migration query: {inner_e}")
                # Try a different approach with direct SQL
                try:
                    # Simpler ALTER TABLE approach
                    conn.execute(text("ALTER TABLE users ADD COLUMN signal_identity VARCHAR"))
                    conn.commit()
                    logging.info("Successfully added signal_identity column using fallback method.")
                    return True
                except Exception as fallback_e:
                    logging.error(f"Fallback method also failed: {fallback_e}")
                    return False
    except Exception as e:
        logging.error(f"Error adding signal_identity column to users table: {e}")
        return False

if __name__ == "__main__":
    migrate() 