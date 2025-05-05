"""Add user metadata fields

Revision ID: add_user_metadata_fields
Revises: add_is_admin_column
Create Date: 2025-04-21 10:41:25

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_metadata_fields'
down_revision = 'add_is_admin_column'
branch_labels = None
depends_on = None

def upgrade():
    # Add new columns
    op.add_column('users', sa.Column('phone_number', sa.String(), nullable=True))
    op.add_column('users', sa.Column('linkedin_username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('telegram_username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('discord_username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('github_username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('timezone', sa.String(), nullable=True))
    op.add_column('users', sa.Column('bio', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('interests', sa.ARRAY(sa.String()), nullable=True))
    op.add_column('users', sa.Column('organization', sa.String(), nullable=True))
    op.add_column('users', sa.Column('role', sa.String(), nullable=True))

def downgrade():
    # Remove the columns in reverse order
    op.drop_column('users', 'role')
    op.drop_column('users', 'organization')
    op.drop_column('users', 'interests')
    op.drop_column('users', 'bio')
    op.drop_column('users', 'timezone')
    op.drop_column('users', 'github_username')
    op.drop_column('users', 'discord_username')
    op.drop_column('users', 'telegram_username')
    op.drop_column('users', 'linkedin_username')
    op.drop_column('users', 'phone_number')
