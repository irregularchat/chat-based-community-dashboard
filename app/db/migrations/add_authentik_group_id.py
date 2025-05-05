"""add authentik_group_id to groups

Revision ID: add_authentik_group_id
Revises: 
Create Date: 2024-04-14 04:15:00.000000

"""
from sqlalchemy import text
from app.db.database import engine

# revision identifiers, used by Alembic.
revision = 'add_authentik_group_id'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    """Add authentik_group_id column to groups table"""
    with engine.begin() as conn:  # This automatically handles transactions
        # Check if column exists first using PRAGMA for SQLite
        result = conn.execute(text("PRAGMA table_info(groups)"))
        columns = [row[1] for row in result.fetchall()]  # Column names are in index 1
        
        if 'authentik_group_id' not in columns:
            # Column doesn't exist, add it
            conn.execute(text("""
                ALTER TABLE groups 
                ADD COLUMN authentik_group_id VARCHAR
            """))

def downgrade():
    """Remove authentik_group_id column from groups table"""
    with engine.begin() as conn:  # This automatically handles transactions
        # Check if column exists first using PRAGMA for SQLite
        result = conn.execute(text("PRAGMA table_info(groups)"))
        columns = [row[1] for row in result.fetchall()]  # Column names are in index 1
        
        if 'authentik_group_id' in columns:
            # Column exists, remove it
            # SQLite doesn't support DROP COLUMN directly, so we need to:
            # 1. Create a new table without the column
            # 2. Copy data from old table
            # 3. Drop old table
            # 4. Rename new table
            conn.execute(text("""
                CREATE TABLE groups_new (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR UNIQUE,
                    description TEXT,
                    authentik_group_id VARCHAR
                )
            """))
            conn.execute(text("""
                INSERT INTO groups_new (id, name, description)
                SELECT id, name, description FROM groups
            """))
            conn.execute(text("DROP TABLE groups"))
            conn.execute(text("ALTER TABLE groups_new RENAME TO groups")) 