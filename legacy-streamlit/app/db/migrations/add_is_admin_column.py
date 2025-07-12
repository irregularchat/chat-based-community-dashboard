"""Add is_admin column to users table

Revision ID: add_is_admin_column
Revises: 
Create Date: 2024-03-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_is_admin_column'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Add is_admin column with default value False
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'))

def downgrade():
    # Remove is_admin column
    op.drop_column('users', 'is_admin') 