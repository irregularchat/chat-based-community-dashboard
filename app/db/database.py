from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.utils.config import Config
import os

# Create the declarative base
Base = declarative_base()

# Use SQLite for testing, otherwise use the configured DATABASE_URL
if os.getenv("TESTING"):
    DATABASE_URL = "sqlite:///:memory:"
else:
    DATABASE_URL = Config.DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Only create tables if not in test mode
if not os.getenv("TESTING"):
    from app.db.models import *  # Import models to ensure they're registered
    Base.metadata.create_all(bind=engine) 