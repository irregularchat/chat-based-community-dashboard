"""
Debug script to directly check user counts in the database.
This bypasses Streamlit entirely to verify the database connection.
"""

import os
import sys
import sqlite3

# Add the parent directory to the Python path so we can import from app
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

def check_user_count_direct():
    """Check user count directly with SQLite."""
    try:
        # Direct SQLite query
        conn = sqlite3.connect('local_dev.db')
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM users')
        sqlite_count = cursor.fetchone()[0]
        print(f"Direct SQLite query shows {sqlite_count} users")
        
        # Get first 5 users
        cursor.execute('SELECT id, username FROM users LIMIT 5')
        users = cursor.fetchall()
        print("First 5 users:")
        for user in users:
            print(f"  ID: {user[0]}, Username: {user[1]}")
            
        # Get last 5 users
        cursor.execute('SELECT id, username FROM users ORDER BY id DESC LIMIT 5')
        users = cursor.fetchall()
        print("Last 5 users:")
        for user in users:
            print(f"  ID: {user[0]}, Username: {user[1]}")
            
        conn.close()
    except Exception as e:
        print(f"Error in direct SQL query: {e}")
    
    try:
        # SQLAlchemy query
        from app.db.database import SessionLocal
        from app.db.models import User
        
        db = SessionLocal()
        try:
            total_count = db.query(User).count()
            print(f"SQLAlchemy query shows {total_count} users")
            
            # Get first 5 users
            users = db.query(User).order_by(User.id).limit(5).all()
            print("First 5 users from SQLAlchemy:")
            for user in users:
                print(f"  ID: {user.id}, Username: {user.username}")
                
            # Get last 5 users
            users = db.query(User).order_by(User.id.desc()).limit(5).all()
            print("Last 5 users from SQLAlchemy:")
            for user in users:
                print(f"  ID: {user.id}, Username: {user.username}")
        finally:
            db.close()
    except Exception as e:
        print(f"Error in SQLAlchemy query: {e}")

if __name__ == "__main__":
    print("==== DIRECT DATABASE ACCESS DEBUG ====")
    check_user_count_direct()
    print("=====================================")
