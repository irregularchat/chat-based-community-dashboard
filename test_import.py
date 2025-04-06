#!/usr/bin/env python3
# Simple test to ensure imports are working correctly

import sys
import os

# Add the current directory to the Python path
sys.path.insert(0, os.path.abspath('.'))

# Try to import the modules
try:
    print("Attempting to import app.auth.test_login...")
    from app.auth.test_login import test_login_page
    print("✅ Success! app.auth.test_login imported successfully")
except ImportError as e:
    print(f"❌ Error importing app.auth.test_login: {e}")
    print("\nPython path:")
    for path in sys.path:
        print(f"  - {path}")
    
    print("\nChecking file existence:")
    test_file = os.path.join('app', 'auth', 'test_login.py')
    if os.path.exists(test_file):
        print(f"  ✅ {test_file} exists")
    else:
        print(f"  ❌ {test_file} does not exist")
        
    # Check the auth directory structure
    auth_dir = os.path.join('app', 'auth')
    if os.path.exists(auth_dir):
        print(f"  ✅ {auth_dir} directory exists")
        print("    Files in directory:")
        for file in os.listdir(auth_dir):
            print(f"      - {file}")
    else:
        print(f"  ❌ {auth_dir} directory does not exist") 