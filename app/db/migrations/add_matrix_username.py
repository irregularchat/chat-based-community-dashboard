"""add matrix_username to users table
Revision ID: add_matrix_username
Revises: 
Create Date: 2025-04-29
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # Add matrix_username column to users table
    op.add_column('users', sa.Column('matrix_username', sa.String(), nullable=True))

def downgrade():
    # Remove matrix_username column from users table
    op.drop_column('users', 'matrix_username')
