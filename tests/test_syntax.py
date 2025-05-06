#!/usr/bin/env python3
"""
Script to test and fix the syntax in forms.py
"""
import re
import os

def find_unmatched_except():
    """Find unmatched except statements in the file"""
    try:
        file_path = 'app/ui/forms.py'
        with open(file_path, 'r') as f:
            content = f.readlines()
        
        # Create a fixed version of the file
        fixed_content = []
        skip_line = False
        
        for i, line in enumerate(content):
            # Check for the problematic line at 1482
            if i == 1481:  # 0-indexed, so line 1482 is at index 1481
                # Check if this is the unmatched except
                if 'except Exception as e:' in line:
                    skip_line = True
                    print(f"Skipping unmatched except at line {i+1}")
                else:
                    fixed_content.append(line)
            elif i >= 1482 and i <= 1484 and skip_line:
                # Skip the next 3 lines (the except block)
                print(f"Skipping line {i+1}: {line.strip()}")
            else:
                fixed_content.append(line)
        
        # Write the fixed content to a new file
        with open('app/ui/forms_fixed.py', 'w') as f:
            f.writelines(fixed_content)
        
        print(f"Fixed file written to app/ui/forms_fixed.py")
        return True
    
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    find_unmatched_except()
