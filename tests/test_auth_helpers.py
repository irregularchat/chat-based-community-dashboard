"""
Tests for authentication helper functions
"""
import pytest
import uuid
from app.db.models import User, ModeratorPermission
from app.utils.auth_helpers import (
    check_moderator_access,
    get_user_accessible_sections,
    get_user_accessible_rooms,
    is_admin_or_moderator,
    format_permission_display
)
from app.db.operations import promote_to_moderator, grant_moderator_permission


@pytest.fixture
def test_admin_user(test_session):
    """Create a test admin user"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"test_admin_{unique_id}",
        email=f"admin_{unique_id}@test.com",
        first_name="Test",
        last_name="Admin",
        is_active=True,
        is_admin=True,
        is_moderator=False
    )
    test_session.add(user)
    test_session.commit()
    return user


@pytest.fixture
def test_moderator_user(test_session):
    """Create a test moderator user"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"test_moderator_{unique_id}",
        email=f"moderator_{unique_id}@test.com",
        first_name="Test",
        last_name="Moderator",
        is_active=True,
        is_admin=False,
        is_moderator=True
    )
    test_session.add(user)
    test_session.commit()
    return user


@pytest.fixture
def test_regular_user(test_session):
    """Create a test regular user"""
    unique_id = str(uuid.uuid4())[:8]
    user = User(
        username=f"test_user_{unique_id}",
        email=f"user_{unique_id}@test.com",
        first_name="Test",
        last_name="User",
        is_active=True,
        is_admin=False,
        is_moderator=False
    )
    test_session.add(user)
    test_session.commit()
    return user


class TestCheckModeratorAccess:
    """Test check_moderator_access function"""
    
    def test_admin_has_all_access(self, test_session, test_admin_user):
        """Test that admins have access to everything"""
        assert check_moderator_access(test_session, test_admin_user.username) == True
        assert check_moderator_access(test_session, test_admin_user.username, section="Onboarding") == True
        assert check_moderator_access(test_session, test_admin_user.username, room_id="!test:example.com") == True
    
    def test_regular_user_no_access(self, test_session, test_regular_user):
        """Test that regular users have no moderator access"""
        assert check_moderator_access(test_session, test_regular_user.username) == False
        assert check_moderator_access(test_session, test_regular_user.username, section="Onboarding") == False
        assert check_moderator_access(test_session, test_regular_user.username, room_id="!test:example.com") == False
    
    def test_moderator_without_permissions(self, test_session, test_moderator_user):
        """Test moderator without specific permissions"""
        # General moderator check should pass
        assert check_moderator_access(test_session, test_moderator_user.username) == True
        # But specific section/room checks should fail without permissions
        assert check_moderator_access(test_session, test_moderator_user.username, section="Onboarding") == False
        assert check_moderator_access(test_session, test_moderator_user.username, room_id="!test:example.com") == False
    
    def test_moderator_with_global_permission(self, test_session, test_moderator_user):
        """Test moderator with global permission"""
        # Grant global permission
        grant_moderator_permission(
            test_session,
            test_moderator_user.id,
            'global',
            None,
            'admin'
        )
        
        # Should have access to everything
        assert check_moderator_access(test_session, test_moderator_user.username) == True
        assert check_moderator_access(test_session, test_moderator_user.username, section="Onboarding") == True
        assert check_moderator_access(test_session, test_moderator_user.username, room_id="!test:example.com") == True
    
    def test_moderator_with_section_permission(self, test_session, test_moderator_user):
        """Test moderator with specific section permission"""
        # Grant permission for Onboarding section
        grant_moderator_permission(
            test_session,
            test_moderator_user.id,
            'section',
            'Onboarding',
            'admin'
        )
        
        # Should have access to Onboarding but not other sections
        assert check_moderator_access(test_session, test_moderator_user.username, section="Onboarding") == True
        assert check_moderator_access(test_session, test_moderator_user.username, section="Messaging") == False
        assert check_moderator_access(test_session, test_moderator_user.username, room_id="!test:example.com") == False
    
    def test_nonexistent_user(self, test_session):
        """Test with nonexistent user"""
        assert check_moderator_access(test_session, "nonexistent_user") == False


class TestGetUserAccessibleSections:
    """Test get_user_accessible_sections function"""
    
    def test_admin_gets_all_sections(self, test_session, test_admin_user):
        """Test that admins get all sections"""
        sections = get_user_accessible_sections(test_session, test_admin_user.username)
        expected_sections = ['Onboarding', 'Messaging', 'User Reports', 'Prompt Editor', 'Settings']
        assert set(sections) == set(expected_sections)
    
    def test_regular_user_no_sections(self, test_session, test_regular_user):
        """Test that regular users get no sections"""
        sections = get_user_accessible_sections(test_session, test_regular_user.username)
        assert sections == []
    
    def test_moderator_with_global_permission(self, test_session, test_moderator_user):
        """Test moderator with global permission gets all non-admin sections"""
        # Grant global permission
        grant_moderator_permission(
            test_session,
            test_moderator_user.id,
            'global',
            None,
            'admin'
        )
        
        sections = get_user_accessible_sections(test_session, test_moderator_user.username)
        # Should get all sections except Settings
        expected_sections = ['Onboarding', 'Messaging', 'User Reports', 'Prompt Editor']
        assert set(sections) == set(expected_sections)
    
    def test_moderator_with_specific_sections(self, test_session, test_moderator_user):
        """Test moderator with specific section permissions"""
        # Grant permissions for specific sections
        grant_moderator_permission(test_session, test_moderator_user.id, 'section', 'Onboarding', 'admin')
        grant_moderator_permission(test_session, test_moderator_user.id, 'section', 'Messaging', 'admin')
        
        sections = get_user_accessible_sections(test_session, test_moderator_user.username)
        assert set(sections) == {'Onboarding', 'Messaging'}


class TestGetUserAccessibleRooms:
    """Test get_user_accessible_rooms function"""
    
    def test_admin_gets_all_rooms(self, test_session, test_admin_user):
        """Test that admins get empty list (meaning all rooms)"""
        rooms = get_user_accessible_rooms(test_session, test_admin_user.username)
        assert rooms == []  # Empty list means all rooms
    
    def test_regular_user_no_rooms(self, test_session, test_regular_user):
        """Test that regular users get no rooms"""
        rooms = get_user_accessible_rooms(test_session, test_regular_user.username)
        assert rooms == []
    
    def test_moderator_with_global_permission(self, test_session, test_moderator_user):
        """Test moderator with global permission gets all rooms"""
        # Grant global permission
        grant_moderator_permission(
            test_session,
            test_moderator_user.id,
            'global',
            None,
            'admin'
        )
        
        rooms = get_user_accessible_rooms(test_session, test_moderator_user.username)
        assert rooms == []  # Empty list means all rooms
    
    def test_moderator_with_specific_rooms(self, test_session, test_moderator_user):
        """Test moderator with specific room permissions"""
        # Grant permissions for specific rooms
        grant_moderator_permission(test_session, test_moderator_user.id, 'room', '!room1:example.com', 'admin')
        grant_moderator_permission(test_session, test_moderator_user.id, 'room', '!room2:example.com', 'admin')
        
        rooms = get_user_accessible_rooms(test_session, test_moderator_user.username)
        assert set(rooms) == {'!room1:example.com', '!room2:example.com'}


class TestIsAdminOrModerator:
    """Test is_admin_or_moderator function"""
    
    def test_admin_user(self, test_session, test_admin_user):
        """Test that admin users return True"""
        assert is_admin_or_moderator(test_session, test_admin_user.username) == True
    
    def test_moderator_user(self, test_session, test_moderator_user):
        """Test that moderator users return True"""
        assert is_admin_or_moderator(test_session, test_moderator_user.username) == True
    
    def test_regular_user(self, test_session, test_regular_user):
        """Test that regular users return False"""
        assert is_admin_or_moderator(test_session, test_regular_user.username) == False
    
    def test_nonexistent_user(self, test_session):
        """Test with nonexistent user"""
        assert is_admin_or_moderator(test_session, "nonexistent_user") == False


class TestFormatPermissionDisplay:
    """Test format_permission_display function"""
    
    def test_global_permission(self):
        """Test formatting global permission"""
        perm = ModeratorPermission(
            permission_type='global',
            permission_value=None
        )
        assert format_permission_display(perm) == "🌐 Global Access"
    
    def test_section_permission(self):
        """Test formatting section permission"""
        perm = ModeratorPermission(
            permission_type='section',
            permission_value='Onboarding'
        )
        assert format_permission_display(perm) == "📑 Section: Onboarding"
    
    def test_room_permission(self):
        """Test formatting room permission"""
        perm = ModeratorPermission(
            permission_type='room',
            permission_value='!test:example.com'
        )
        assert format_permission_display(perm) == "🏠 Room: !test:example.com"
    
    def test_unknown_permission(self):
        """Test formatting unknown permission type"""
        perm = ModeratorPermission(
            permission_type='custom',
            permission_value='something'
        )
        assert format_permission_display(perm) == "❓ custom: something" 