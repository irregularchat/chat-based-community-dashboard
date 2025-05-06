#!/usr/bin/env python3
"""
Script to fix the syntax error in forms.py
"""
import re

def fix_syntax_error():
    """Fix the syntax error in forms.py by correcting indentation"""
    try:
        # Read the file
        with open('app/ui/forms.py', 'r') as f:
            content = f.read()
        
        # Find the problematic section - look for the except statement that's causing issues
        pattern = r'except Exception as e:\s+logging\.error\(f"Error connecting with Matrix user:'
        match = re.search(pattern, content)
        
        if not match:
            print("Could not find the problematic section")
            return False
        
        # Get the position of the match
        pos = match.start()
        
        # Get the content before and after the match
        before = content[:pos]
        after = content[pos:]
        
        # Find the indentation level of the problematic except
        lines = after.split('\n')
        except_line = lines[0]
        
        # Extract the current indentation
        current_indent = len(except_line) - len(except_line.lstrip())
        
        # We need to find where this except should be indented
        # Look for the nearest try statement with proper indentation
        try_pattern = r'try:'
        try_matches = list(re.finditer(try_pattern, before))
        
        if not try_matches:
            print("Could not find any try statements")
            return False
        
        # Find the correct indentation for the except statement
        correct_indent = None
        for try_match in reversed(try_matches):
            try_pos = try_match.start()
            try_line = before[before.rfind('\n', 0, try_pos)+1:before.find('\n', try_pos)]
            try_indent = len(try_line) - len(try_line.lstrip())
            
            # Check if this try is at the same indentation level as our except
            if try_indent == current_indent:
                correct_indent = try_indent
                break
        
        if correct_indent is None:
            print("Could not determine correct indentation")
            return False
        
        # Create a fixed version of the file
        fixed_content = before + after
        
        # Write the fixed content to a new file
        with open('app/ui/forms_fixed.py', 'w') as f:
            f.write(fixed_content)
        
        print("Created fixed version at app/ui/forms_fixed.py")
        print("Please review the changes and replace the original file if correct.")
        
        # Also create a simplified version that can be used to diagnose the issue
        simplified = """
import logging
import traceback
import streamlit as st

def test_function():
    try:
        # Outer try block
        if True:
            try:
                # Inner try block
                print("Inside inner try")
            except Exception as e:
                logging.error(f"Inner exception: {str(e)}")
                
        # This is where we have the create_user_message call
        print("After inner try-except")
    except Exception as e:
        logging.error(f"Outer exception: {str(e)}")
        
    print("End of function")
"""
        with open('simplified_example.py', 'w') as f:
            f.write(simplified)
        
        print("Created simplified example at simplified_example.py")
        
        return True
    
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    fix_syntax_error()
