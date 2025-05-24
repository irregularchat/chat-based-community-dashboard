"""
Tests for moderator management functionality
"""
import pytest
import uuid
from app.db.models import User, ModeratorPermission, AdminEvent
from app.db.operations import (
    is_moderator,
    update_moderator_status,
    get_moderator_users,
    get_moderator_count,
    promote_to_moderator,
    demote_from_moderator,
    grant_moderator_permission,
    revoke_moderator_permission,
    get_moderator_permissions,
    has_moderator_permission,
    clear_moderator_permissions,
    get_users_with_roles
)


@pytest.fixture
def test_user(test_session):
    """Create a test user"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"testuser_{unique_id}",
        email=f"test_{unique_id}@example.com",
        first_name="Test",
        last_name="User",
        is_active=True,
        is_admin=False,
        is_moderator=False
    )
    test_session.add(user)
    test_session.commit()
    yield user


@pytest.fixture
def test_moderator(test_session):
    """Create a test moderator"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"testmoderator_{unique_id}",
        email=f"moderator_{unique_id}@example.com",
        first_name="Test",
        last_name="Moderator",
        is_active=True,
        is_admin=False,
        is_moderator=True
    )
    test_session.add(user)
    test_session.commit()
    yield user


@pytest.fixture
def test_admin(test_session):
    """Create a test admin"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"testadmin_{unique_id}",
        email=f"admin_{unique_id}@example.com",
        first_name="Test",
        last_name="Admin",
        is_active=True,
        is_admin=True,
        is_moderator=False
    )
    test_session.add(user)
    test_session.commit()
    yield user


class TestModeratorStatus:
    """Test moderator status functions"""
    
    def test_is_moderator(self, test_session, test_user, test_moderator):
        """Test checking if a user is a moderator"""
        assert is_moderator(test_session, test_user.username) == False
        assert is_moderator(test_session, test_moderator.username) == True
        assert is_moderator(test_session, "nonexistent") == False
    
    def test_update_moderator_status(self, test_session, test_user):
        """Test updating moderator status"""
        # Promote to moderator
        assert update_moderator_status(test_session, test_user.username, True) == True
        assert is_moderator(test_session, test_user.username) == True
        
        # Demote from moderator
        assert update_moderator_status(test_session, test_user.username, False) == True
        assert is_moderator(test_session, test_user.username) == False
        
        # Test with non-existent user
        assert update_moderator_status(test_session, "nonexistent", True) == False
    
    def test_get_moderator_users(self, test_session, test_user, test_moderator):
        """Test getting all moderator users"""
        moderators = get_moderator_users(test_session)
        assert len(moderators) >= 1
        assert test_moderator in moderators
        assert test_user not in moderators
    
    def test_get_moderator_count(self, test_session, test_moderator):
        """Test getting moderator count"""
        count = get_moderator_count(test_session)
        assert count >= 1


class TestModeratorPromotion:
    """Test moderator promotion and demotion"""
    
    def test_promote_to_moderator(self, test_session, test_user, test_admin):
        """Test promoting a user to moderator"""
        assert promote_to_moderator(test_session, test_user.username, test_admin.username) == True
        assert is_moderator(test_session, test_user.username) == True
        
        # Check that admin event was created
        events = test_session.query(AdminEvent).filter(
            AdminEvent.event_type == "MODERATOR_PROMOTED"
        ).all()
        assert len(events) > 0
        assert test_admin.username in events[-1].username
    
    def test_demote_from_moderator(self, test_session, test_moderator, test_admin):
        """Test demoting a user from moderator"""
        assert demote_from_moderator(test_session, test_moderator.username, test_admin.username) == True
        assert is_moderator(test_session, test_moderator.username) == False
        
        # Check that admin event was created
        events = test_session.query(AdminEvent).filter(
            AdminEvent.event_type == "MODERATOR_DEMOTED"
        ).all()
        assert len(events) > 0


class TestModeratorPermissions:
    """Test moderator permission management"""
    
    def test_grant_moderator_permission(self, test_session, test_moderator, test_admin):
        """Test granting permissions to a moderator"""
        # Grant global permission
        perm = grant_moderator_permission(
            test_session, 
            test_moderator.id, 
            'global', 
            None, 
            test_admin.username
        )
        assert perm is not None
        assert perm.permission_type == 'global'
        assert perm.permission_value is None
        
        # Grant section permission
        perm2 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Onboarding',
            test_admin.username
        )
        assert perm2 is not None
        assert perm2.permission_type == 'section'
        assert perm2.permission_value == 'Onboarding'
        
        # Grant room permission
        perm3 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'room',
            '!room123:example.com',
            test_admin.username
        )
        assert perm3 is not None
        assert perm3.permission_type == 'room'
        assert perm3.permission_value == '!room123:example.com'
    
    def test_duplicate_permission(self, test_session, test_moderator, test_admin):
        """Test that duplicate permissions are not created"""
        # Grant permission once
        perm1 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Messaging',
            test_admin.username
        )
        
        # Try to grant same permission again
        perm2 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Messaging',
            test_admin.username
        )
        
        # Should return the existing permission
        assert perm1.id == perm2.id
    
    def test_revoke_moderator_permission(self, test_session, test_moderator, test_admin):
        """Test revoking permissions from a moderator"""
        # Grant a permission first
        perm = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'User Reports',
            test_admin.username
        )
        assert perm is not None
        perm_id = perm.id
        
        # Revoke the permission
        assert revoke_moderator_permission(test_session, perm_id, test_admin.username) == True
        
        # Verify it's gone
        deleted_perm = test_session.query(ModeratorPermission).filter(
            ModeratorPermission.id == perm_id
        ).first()
        assert deleted_perm is None
    
    def test_get_moderator_permissions(self, test_session, test_moderator, test_admin):
        """Test getting all permissions for a moderator"""
        # Grant multiple permissions
        perm1 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'global',
            None,
            test_admin.username
        )
        perm2 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Prompt Editor',
            test_admin.username
        )
        
        # Get permissions
        permissions = get_moderator_permissions(test_session, test_moderator.id)
        assert len(permissions) >= 2
        assert any(p.id == perm1.id for p in permissions)
        assert any(p.id == perm2.id for p in permissions)
    
    def test_has_moderator_permission(self, test_session, test_moderator, test_admin):
        """Test checking if a moderator has specific permissions"""
        # Initially should have no permissions
        assert has_moderator_permission(test_session, test_moderator.id, 'section', 'Onboarding') == False
        
        # Grant section permission
        perm = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Onboarding',
            test_admin.username
        )
        
        # Now should have the permission
        assert has_moderator_permission(test_session, test_moderator.id, 'section', 'Onboarding') == True
        assert has_moderator_permission(test_session, test_moderator.id, 'section', 'Messaging') == False
    
    def test_global_permission_override(self, test_session, test_moderator, test_admin):
        """Test that global permission overrides specific permissions"""
        # Grant global permission
        perm = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'global',
            None,
            test_admin.username
        )
        
        # Should have access to any section or room
        assert has_moderator_permission(test_session, test_moderator.id, 'section', 'Onboarding') == True
        assert has_moderator_permission(test_session, test_moderator.id, 'section', 'Messaging') == True
        assert has_moderator_permission(test_session, test_moderator.id, 'room', '!anyroom:example.com') == True
    
    def test_clear_moderator_permissions(self, test_session, test_moderator, test_admin):
        """Test clearing all permissions for a moderator"""
        # Grant multiple permissions
        perm1 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'global',
            None,
            test_admin.username
        )
        perm2 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'section',
            'Onboarding',
            test_admin.username
        )
        perm3 = grant_moderator_permission(
            test_session,
            test_moderator.id,
            'room',
            '!room456:example.com',
            test_admin.username
        )
        
        # Clear all permissions
        assert clear_moderator_permissions(test_session, test_moderator.id, test_admin.username) == True
        
        # Verify all permissions are gone
        permissions = get_moderator_permissions(test_session, test_moderator.id)
        assert len(permissions) == 0


class TestGetUsersWithRoles:
    """Test getting users with specific roles"""
    
    def test_get_users_with_roles(self, test_session, test_user, test_moderator, test_admin):
        """Test getting users with admin and/or moderator roles"""
        # Get all users with roles
        users_with_roles = get_users_with_roles(test_session, True, True)
        assert test_admin in users_with_roles
        assert test_moderator in users_with_roles
        assert test_user not in users_with_roles
        
        # Get only admins
        admins_only = get_users_with_roles(test_session, True, False)
        assert test_admin in admins_only
        assert test_moderator not in admins_only
        assert test_user not in admins_only
        
        # Get only moderators
        mods_only = get_users_with_roles(test_session, False, True)
        assert test_admin not in mods_only
        assert test_moderator in mods_only
        assert test_user not in mods_only
        
        # Get none (edge case)
        no_users = get_users_with_roles(test_session, False, False)
        assert len(no_users) == 0 