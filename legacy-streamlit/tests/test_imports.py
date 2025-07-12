import unittest
import importlib
import sys
import os

class TestImports(unittest.TestCase):
    def setUp(self):
        # Add the app directory to the Python path
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

    def test_forms_imports(self):
        """Test that all imports in forms.py are valid"""
        try:
            # Test each import individually
            import app.ui.forms
            from app.db.session import get_db
            from app.db.models import User
            from app.utils.recommendation import get_entrance_room_users_sync
            from app.utils.matrix_actions import invite_to_matrix_room
            from app.db.session import get_groups_from_db
            
            # Test that the functions exist
            self.assertTrue(callable(get_db))
            self.assertTrue(hasattr(User, '__class__'))
            self.assertTrue(callable(get_entrance_room_users_sync))
            self.assertTrue(callable(invite_to_matrix_room))
            self.assertTrue(callable(get_groups_from_db))
            
        except ImportError as e:
            self.fail(f"ImportError: {str(e)}")
        except Exception as e:
            self.fail(f"Unexpected error: {str(e)}")

    def test_recommendation_imports(self):
        """Test that all imports in recommendation.py are valid"""
        try:
            from app.utils.recommendation import get_entrance_room_users_sync
            self.assertTrue(callable(get_entrance_room_users_sync))
        except ImportError as e:
            self.fail(f"ImportError: {str(e)}")
        except Exception as e:
            self.fail(f"Unexpected error: {str(e)}")

if __name__ == '__main__':
    unittest.main() 