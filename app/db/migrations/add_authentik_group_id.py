"""add authentik_group_id to groups

Revision ID: add_authentik_group_id
Revises: 
Create Date: 2024-04-14 04:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_authentik_group_id'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Add authentik_group_id column to groups table
    op.add_column('groups', sa.Column('authentik_group_id', sa.String(), nullable=True))

def downgrade():
    # Remove authentik_group_id column from groups table
    op.drop_column('groups', 'authentik_group_id') 