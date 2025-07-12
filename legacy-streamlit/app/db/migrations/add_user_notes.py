"""Add user notes table

This migration adds the user_notes table to store moderator notes about users.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, inspect
from sqlalchemy.sql import text
import logging
from datetime import datetime

# Import Base from your application
from app.db.database import Base

# Define the revision identifiers
revision = 'add_user_notes'
down_revision = None  # Set to the previous migration if applicable

def upgrade():
    """
    Create the user_notes table.
    """
    from sqlalchemy import MetaData, Table, Column, Integer, String, Text, DateTime, ForeignKey
    from sqlalchemy.sql import text
    from app.db.database import engine
    
    try:
        # Check if the table already exists
        inspector = inspect(engine)
        if 'user_notes' not in inspector.get_table_names():
            # Create the table
            metadata = MetaData()
            user_notes = Table(
                'user_notes',
                metadata,
                Column('id', Integer, primary_key=True),
                Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
                Column('content', Text, nullable=False),
                Column('created_at', DateTime, nullable=False, default=datetime.utcnow),
                Column('updated_at', DateTime, nullable=False, default=datetime.utcnow),
                Column('created_by', String, nullable=False),
                Column('last_edited_by', String, nullable=True)
            )
            
            metadata.create_all(engine, tables=[user_notes])
            logging.info("Created user_notes table")
        else:
            logging.info("user_notes table already exists")
    except Exception as e:
        logging.error(f"Error creating user_notes table: {e}")
        raise

def downgrade():
    """
    Drop the user_notes table.
    """
    from sqlalchemy import MetaData, Table
    from app.db.database import engine
    
    try:
        # Drop the table
        metadata = MetaData()
        user_notes = Table('user_notes', metadata)
        user_notes.drop(engine, checkfirst=True)
        logging.info("Dropped user_notes table")
    except Exception as e:
        logging.error(f"Error dropping user_notes table: {e}")
        raise
