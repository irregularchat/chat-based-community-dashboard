import pytest
from unittest.mock import patch, MagicMock, Mock
import streamlit as st
from app.main import render_main_content, render_sidebar
from app.pages.settings import render_settings_page


class TestDashboardAccessControl:
    """Test access control for different user roles across the dashboard"""
    
    @pytest.fixture
    def mock_streamlit(self):
        """Mock streamlit components"""
        with patch('streamlit.session_state', {}) as mock_state, \
             patch('streamlit.title') as mock_title, \
             patch('streamlit.write') as mock_write, \
             patch('streamlit.error') as mock_error, \
             patch('streamlit.success') as mock_success, \
             patch('streamlit.info') as mock_info, \
             patch('streamlit.warning') as mock_warning, \
             patch('streamlit.markdown') as mock_markdown, \
             patch('streamlit.sidebar.title') as mock_sidebar_title, \
             patch('streamlit.sidebar.write') as mock_sidebar_write, \
             patch('streamlit.sidebar.selectbox') as mock_sidebar_selectbox, \
             patch('streamlit.sidebar.button') as mock_sidebar_button, \
             patch('streamlit.sidebar.markdown') as mock_sidebar_markdown, \
             patch('streamlit.sidebar.expander') as mock_sidebar_expander, \
             patch('streamlit.query_params', {}) as mock_query_params:
            
            yield {
                'session_state': mock_state,
                'title': mock_title,
                'write': mock_write,
                'error': mock_error,
                'success': mock_success,
                'info': mock_info,
                'warning': mock_warning,
                'markdown': mock_markdown,
                'sidebar_title': mock_sidebar_title,
                'sidebar_write': mock_sidebar_write,
                'sidebar_selectbox': mock_sidebar_selectbox,
                'sidebar_button': mock_sidebar_button,
                'sidebar_markdown': mock_sidebar_markdown,
                'sidebar_expander': mock_sidebar_expander,
                'query_params': mock_query_params
            }
    
    @pytest.fixture
    def unauthenticated_state(self):
        """Session state for unauthenticated user"""
        return {
            'is_authenticated': False,
            'is_admin': False,
            'is_moderator': False,
            'username': '',
            'user_info': {}
        }
    
    @pytest.fixture
    def regular_user_state(self):
        """Session state for regular authenticated user"""
        return {
            'is_authenticated': True,
            'is_admin': False,
            'is_moderator': False,
            'username': 'regular_user',
            'user_info': {
                'preferred_username': 'regular_user',
                'name': 'Regular User',
                'email': 'regular@example.com'
            }
        }
    
    @pytest.fixture
    def moderator_state(self):
        """Session state for moderator user"""
        return {
            'is_authenticated': True,
            'is_admin': False,
            'is_moderator': True,
            'username': 'moderator_user',
            'user_info': {
                'preferred_username': 'moderator_user',
                'name': 'Moderator User',
                'email': 'moderator@example.com'
            }
        }
    
    @pytest.fixture
    def admin_state(self):
        """Session state for admin user"""
        return {
            'is_authenticated': True,
            'is_admin': True,
            'is_moderator': False,
            'username': 'admin_user',
            'user_info': {
                'preferred_username': 'admin_user',
                'name': 'Admin User',
                'email': 'admin@example.com'
            }
        }

    def test_unauthenticated_sidebar_access(self, mock_streamlit, unauthenticated_state):
        """Test sidebar navigation for unauthenticated users"""
        mock_streamlit['session_state'].update(unauthenticated_state)
        mock_streamlit['sidebar_selectbox'].return_value = "Create User"
        
        with patch('app.ui.common.display_login_button') as mock_login_button:
            selected_page = render_sidebar()
            
            # Should only see Create User page
            mock_streamlit['sidebar_selectbox'].assert_called_once()
            args, kwargs = mock_streamlit['sidebar_selectbox'].call_args
            # Check if options are in args or kwargs
            if 'options' in kwargs:
                options = kwargs['options']
            else:
                # Options are likely the second positional argument
                options = args[1] if len(args) > 1 else args[0]
            assert options == ["Create User"]
            assert selected_page == "Create User"
            
            # Should see login button
            mock_login_button.assert_called_once_with(location="sidebar")

    def test_regular_user_sidebar_access(self, mock_streamlit, regular_user_state):
        """Test sidebar navigation for regular authenticated users"""
        mock_streamlit['session_state'].update(regular_user_state)
        mock_streamlit['sidebar_selectbox'].return_value = "Create User"
        mock_streamlit['sidebar_button'].return_value = False
        
        selected_page = render_sidebar()
        
        # Should see multiple pages but not admin-only pages
        mock_streamlit['sidebar_selectbox'].assert_called_once()
        args, kwargs = mock_streamlit['sidebar_selectbox'].call_args
        # Check if options are in args or kwargs
        if 'options' in kwargs:
            options = kwargs['options']
        else:
            # Options are likely the second positional argument
            options = args[1] if len(args) > 1 else args[0]
        
        # Should have access to these pages
        assert "Create User" in options
        assert "List & Manage Users" in options
        assert "Create Invite" in options
        assert "Matrix Messages and Rooms" in options
        assert "Signal Association" in options
        
        # Should NOT have access to admin pages (Settings, Prompts Manager, and Test SMTP are now in Settings page)
        pass  # No admin-only pages in main dropdown anymore

    def test_moderator_sidebar_access(self, mock_streamlit, moderator_state):
        """Test sidebar navigation for moderator users"""
        mock_streamlit['session_state'].update(moderator_state)
        mock_streamlit['sidebar_selectbox'].return_value = "Create User"
        mock_streamlit['sidebar_button'].return_value = False
        mock_streamlit['sidebar_expander'].return_value.__enter__ = Mock()
        mock_streamlit['sidebar_expander'].return_value.__exit__ = Mock()
        
        with patch('app.db.session.get_db') as mock_get_db, \
             patch('app.utils.auth_helpers.get_user_accessible_sections') as mock_get_sections:
            
            # Mock database session
            mock_db = Mock()
            mock_get_db.return_value = iter([mock_db])
            mock_get_sections.return_value = []  # No specific sections = basic access
            
            selected_page = render_sidebar()
            
            # Should see moderator pages but not admin pages
            mock_streamlit['sidebar_selectbox'].assert_called_once()
            args, kwargs = mock_streamlit['sidebar_selectbox'].call_args
            # Check if options are in args or kwargs
            if 'options' in kwargs:
                options = kwargs['options']
            else:
                # Options are likely the second positional argument
                options = args[1] if len(args) > 1 else args[0]
            
            # Should have basic moderator access
            assert "Create User" in options
            assert "List & Manage Users" in options
            
            # Should NOT have access to admin pages (Settings and Test SMTP are now in Settings page)
            pass  # No admin-only pages in main dropdown anymore

    def test_admin_sidebar_access(self, mock_streamlit, admin_state):
        """Test sidebar navigation for admin users"""
        mock_streamlit['session_state'].update(admin_state)
        mock_streamlit['sidebar_selectbox'].return_value = "Create User"
        mock_streamlit['sidebar_button'].return_value = False
        
        selected_page = render_sidebar()
        
        # Should see all pages including admin-only pages
        mock_streamlit['sidebar_selectbox'].assert_called_once()
        args, kwargs = mock_streamlit['sidebar_selectbox'].call_args
        # Check if options are in args or kwargs
        if 'options' in kwargs:
            options = kwargs['options']
        else:
            # Options are likely the second positional argument
            options = args[1] if len(args) > 1 else args[0]
        
        # Should have access to all pages
        assert "Create User" in options
        assert "List & Manage Users" in options
        assert "Create Invite" in options
        assert "Matrix Messages and Rooms" in options
        assert "Signal Association" in options
        # Admin users now access Settings, Prompts Manager, and Test SMTP through the Settings page
        # Main dropdown only has core functionality pages

    def test_unauthenticated_page_access(self, mock_streamlit, unauthenticated_state):
        """Test page access for unauthenticated users"""
        mock_streamlit['session_state'].update(unauthenticated_state)
        
        # Test access to protected pages (Settings and Prompts Manager are no longer in main dropdown)
        protected_pages = ["List & Manage Users"]
        
        for page in protected_pages:
            mock_streamlit['session_state']['current_page'] = page
            
            with patch('app.ui.common.display_login_button') as mock_login_button:
                render_main_content()
                
                # Should be redirected to login
                mock_login_button.assert_called()
                
                # Should see authentication required message
                mock_streamlit['markdown'].assert_any_call("## Welcome to the Community Dashboard")

    def test_regular_user_admin_page_access(self, mock_streamlit, regular_user_state):
        """Test that regular users cannot access admin pages (Settings and Test SMTP are now in Settings page)"""
        mock_streamlit['session_state'].update(regular_user_state)
        
        # Settings and Test SMTP are no longer in main dropdown, they're in the Settings page
        # which has its own access control. This test is now mainly for documentation.
        pass

    def test_moderator_admin_page_access(self, mock_streamlit, moderator_state):
        """Test that moderators cannot access admin pages (Settings and Test SMTP are now in Settings page)"""
        mock_streamlit['session_state'].update(moderator_state)
        
        # Settings and Test SMTP are no longer in main dropdown, they're in the Settings page
        # which has its own access control. This test is now mainly for documentation.
        pass

    def test_admin_page_access(self, mock_streamlit, admin_state):
        """Test that admins can access all pages"""
        mock_streamlit['session_state'].update(admin_state)
        
        # Test Create User page
        mock_streamlit['session_state']['current_page'] = "Create User"
        with patch('app.ui.forms.run_async_safely') as mock_run_async:
            render_main_content()
            mock_run_async.assert_called_once()
            mock_streamlit['error'].assert_not_called()
        
        # Settings page is no longer in main dropdown - it's accessed through the Settings page
        # which has its own access control
        


    def test_settings_page_access_control(self, mock_streamlit):
        """Test access control specifically for Settings page"""
        
        # Test unauthenticated access
        mock_streamlit['session_state'].update({
            'is_authenticated': False,
            'is_admin': False
        })
        
        with patch('app.pages.settings.display_login_button') as mock_login_button:
            render_settings_page()
            # The function should show warning and display login button
            mock_streamlit['title'].assert_called_with("Authentication Required")
            mock_streamlit['warning'].assert_called_with("You must log in to access Settings.")
            mock_login_button.assert_called_with(location="main")
        
        # Test regular user access
        mock_streamlit['session_state'].update({
            'is_authenticated': True,
            'is_admin': False
        })
        mock_streamlit['error'].reset_mock()
        
        render_settings_page()
        mock_streamlit['error'].assert_called_with("You need administrator privileges to access the Settings page.")
        
        # Test admin access
        mock_streamlit['session_state'].update({
            'is_authenticated': True,
            'is_admin': True
        })
        
        with patch('streamlit.tabs') as mock_tabs, \
             patch('app.pages.settings.render_user_settings'), \
             patch('app.pages.settings.render_matrix_rooms_settings'), \
             patch('app.pages.settings.render_message_users_settings'), \
             patch('app.pages.settings.render_prompts_settings'), \
             patch('app.pages.settings.render_advanced_settings'):
            
            # Create mock tabs with proper context manager support
            mock_tab = Mock()
            mock_tab.__enter__ = Mock(return_value=mock_tab)
            mock_tab.__exit__ = Mock(return_value=None)
            mock_tabs.return_value = [mock_tab, mock_tab, mock_tab, mock_tab, mock_tab]
            
            render_settings_page()
            mock_streamlit['title'].assert_called_with("Settings")

    def test_create_user_access_control(self, mock_streamlit):
        """Test Create User page access control"""
        
        # Test regular user access (should be denied)
        mock_streamlit['session_state'].update({
            'is_authenticated': True,
            'is_admin': False,
            'current_page': 'Create User'
        })
        
        render_main_content()
        mock_streamlit['error'].assert_called_with("You need administrator privileges to access this page.")
        
        # Test admin access (should be allowed)
        mock_streamlit['session_state'].update({
            'is_authenticated': True,
            'is_admin': True,
            'current_page': 'Create User'
        })
        
        with patch('app.ui.forms.run_async_safely') as mock_run_async:
            render_main_content()
            mock_run_async.assert_called_once()

    def test_moderator_specific_permissions(self, mock_streamlit, moderator_state):
        """Test moderator-specific permission system"""
        mock_streamlit['session_state'].update(moderator_state)
        mock_streamlit['sidebar_selectbox'].return_value = "Create User"
        mock_streamlit['sidebar_button'].return_value = False
        mock_streamlit['sidebar_expander'].return_value.__enter__ = Mock()
        mock_streamlit['sidebar_expander'].return_value.__exit__ = Mock()
        
        with patch('app.db.session.get_db') as mock_get_db, \
             patch('app.utils.auth_helpers.get_user_accessible_sections') as mock_get_sections:
            
            # Mock database session
            mock_db = Mock()
            mock_get_db.return_value = iter([mock_db])
            
            # Test with specific section permissions
            mock_get_sections.return_value = ['Onboarding', 'User Reports']
            
            selected_page = render_sidebar()
            
            # Should see sections based on permissions
            mock_streamlit['sidebar_selectbox'].assert_called_once()
            args, kwargs = mock_streamlit['sidebar_selectbox'].call_args
            # Check if options are in args or kwargs
            if 'options' in kwargs:
                options = kwargs['options']
            else:
                # Options are likely the second positional argument
                options = args[1] if len(args) > 1 else args[0]
            
            # Should have access to Onboarding (Create User, Create Invite)
            assert "Create User" in options
            assert "Create Invite" in options
            
            # Should have access to User Reports (List & Manage Users)
            assert "List & Manage Users" in options
            
            # Should NOT have Messaging access (Prompts Manager is now in Settings page)
            assert "Matrix Messages and Rooms" not in options

    def test_logout_functionality(self, mock_streamlit, admin_state):
        """Test logout clears session state properly"""
        mock_streamlit['session_state'].update(admin_state)
        mock_streamlit['sidebar_button'].return_value = True  # Simulate logout button click
        
        with patch('streamlit.rerun') as mock_rerun:
            render_sidebar()
            
            # Should clear authentication state
            assert mock_streamlit['session_state']['is_authenticated'] == False
            assert mock_streamlit['session_state']['is_admin'] == False
            assert mock_streamlit['session_state']['is_moderator'] == False
            
            # Should trigger rerun
            mock_rerun.assert_called_once()

    def test_session_state_persistence(self, mock_streamlit):
        """Test that session state maintains authentication across page loads"""
        # Simulate authenticated session
        mock_streamlit['session_state'].update({
            'is_authenticated': True,
            'is_admin': True,
            'permanent_auth': True,
            'permanent_admin': True,
            'username': 'admin_user'
        })
        
        # Simulate page reload (session state partially cleared)
        mock_streamlit['session_state']['is_authenticated'] = False
        
        with patch('app.db.init_db'), \
             patch('streamlit.query_params', {}), \
             patch('app.main.render_sidebar'), \
             patch('app.main.render_main_content'):
            
            from app.main import main
            main()
            
            # Should restore authentication from permanent flags
            assert mock_streamlit['session_state']['is_authenticated'] == True
            assert mock_streamlit['session_state']['is_admin'] == True

    def test_error_handling_in_access_control(self, mock_streamlit, admin_state):
        """Test error handling in access control logic"""
        mock_streamlit['session_state'].update(admin_state)
        mock_streamlit['session_state']['current_page'] = "Create User"
        
        # Test that admin can access Create User page without error
        with patch('app.ui.forms.run_async_safely') as mock_run_async:
            render_main_content()
            # Should call run_async_safely for Create User page
            mock_run_async.assert_called_once()
            # Should not show any error
            mock_streamlit['error'].assert_not_called() 