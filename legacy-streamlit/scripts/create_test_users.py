#!/usr/bin/env python3
"""
Create test users in the local database for development purposes.
This script will generate a specified number of fake users with realistic data.

Usage:
    python -m scripts.create_test_users [num_users]

Arguments:
    num_users   Number of users to create (default: 1000)
"""

import os
import sys
import random
import string
import logging
import argparse
from datetime import datetime, timedelta
from typing import List
import traceback

# Add the parent directory to the Python path so we can import from app
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db.database import SessionLocal, get_db
from app.db.models import User
from app.db.operations import AdminEvent
from app.utils.config import Config

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Sample data for generating realistic users
FIRST_NAMES = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", 
               "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
               "Sofia", "Aiden", "Olivia", "Noah", "Isabella", "Liam", "Emma", "Jacob", "Ava", "Mason", "Mia"]

LAST_NAMES = ["Smith", "Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor",
             "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia", "Martinez", "Robinson",
             "Clark", "Rodriguez", "Lewis", "Lee", "Walker", "Hall", "Allen", "Young", "Hernandez", "King"]

EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "example.com", 
                "mail.com", "company.com", "organization.org", "edu.net", "community.io"]

def generate_random_string(length: int) -> str:
    """Generate a random string of specified length."""
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

def generate_matrix_username() -> str:
    """Generate a fake Matrix username."""
    parts = ["@", random.choice(["user", "person", "matrix", "chat"]), 
             str(random.randint(100, 999)), ":", 
             random.choice(["matrix.org", "irregularchat.com", "chat.example.com"])]
    return ''.join(parts)

def create_user(index: int) -> User:
    """Create a single test user with realistic data."""
    first_name = random.choice(FIRST_NAMES)
    last_name = random.choice(LAST_NAMES)
    
    # Make username unique by adding index
    username_base = f"{first_name.lower()}{last_name.lower()}"
    username = f"{username_base}{index}"
    
    # Create a random but plausible email
    email_domain = random.choice(EMAIL_DOMAINS)
    email = f"{username}@{email_domain}"
    
    # Randomly decide if the user has a matrix username
    has_matrix = random.random() > 0.3  # 70% chance of having matrix username
    matrix_username = generate_matrix_username() if has_matrix else None
    
    # Create random dates for joining and last login
    now = datetime.now()
    max_days_ago = 365 * 3  # Up to 3 years ago
    date_joined = now - timedelta(days=random.randint(1, max_days_ago))
    
    # Last login is after join date, sometimes null (inactive user)
    inactive = random.random() > 0.8  # 20% chance of being inactive
    last_login = None if inactive else date_joined + timedelta(days=random.randint(0, (now - date_joined).days))
    
    # Random status and admin flag
    is_active = not inactive
    is_admin = random.random() > 0.95  # 5% chance of being admin
    
    # Create user object
    user = User(
        username=username,
        first_name=first_name,
        last_name=last_name,
        email=email,
        matrix_username=matrix_username,
        date_joined=date_joined,
        last_login=last_login,
        is_active=is_active,
        is_admin=is_admin,
        authentik_id=f"test-{index}",  # For tracking test users
        is_moderator=(random.random() > 0.9)  # 10% chance of being moderator
    )
    
    return user

def create_test_users(num_users: int) -> int:
    """Create the specified number of test users in the database."""
    logger.info(f"Creating {num_users} test users...")
    
    # Get a database session
    db = SessionLocal()
    try:
        # Get current user count
        initial_count = db.query(User).count()
        logger.info(f"Current user count: {initial_count}")
        
        # Create users in batches of 100 to avoid memory issues
        batch_size = 100
        users_created = 0
        
        for batch_start in range(0, num_users, batch_size):
            batch_end = min(batch_start + batch_size, num_users)
            batch_size_actual = batch_end - batch_start
            
            logger.info(f"Creating batch {batch_start+1}-{batch_end} of {num_users}...")
            
            # Generate batch of users
            users_batch = []
            for i in range(batch_start, batch_end):
                user = create_user(initial_count + i + 1)
                users_batch.append(user)
            
            # Add to database and commit
            db.add_all(users_batch)
            db.commit()
            users_created += batch_size_actual
            
            logger.info(f"Created {users_created}/{num_users} test users...")
        
        # Log admin event for audit trail
        admin_event = AdminEvent(
            event_type="test_users_created",
            username="script",  # Script created these users
            details=str({"count": users_created}),
            timestamp=datetime.now()
        )
        db.add(admin_event)
        db.commit()
        
        # Get final user count
        final_count = db.query(User).count()
        logger.info(f"Final user count: {final_count}")
        
        return users_created
        
    except Exception as e:
        logger.error(f"Error creating test users: {str(e)}")
        logger.error(traceback.format_exc())
        db.rollback()
        return 0
    finally:
        db.close()

def main():
    """Main function to parse arguments and create test users."""
    parser = argparse.ArgumentParser(description="Create test users in the local database.")
    parser.add_argument("num_users", type=int, nargs="?", default=1000, 
                        help="Number of users to create (default: 1000)")
    args = parser.parse_args()
    
    start_time = datetime.now()
    users_created = create_test_users(args.num_users)
    end_time = datetime.now()
    
    duration = (end_time - start_time).total_seconds()
    logger.info(f"Created {users_created} test users in {duration:.2f} seconds")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
