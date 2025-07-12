from app.db.database import get_db
from sqlalchemy.orm import Session
from app.db.models import Group
from typing import List, Dict, Any

__all__ = ['get_db']

def get_db():
    """Get database session"""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_groups_from_db() -> List[Dict[str, Any]]:
    """Get all groups from the database"""
    db = next(get_db())
    try:
        groups = db.query(Group).all()
        return [
            {
                'id': group.id,
                'name': group.name,
                'description': group.description
            }
            for group in groups
        ]
    finally:
        db.close() 