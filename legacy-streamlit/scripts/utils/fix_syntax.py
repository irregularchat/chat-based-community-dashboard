#!/usr/bin/env python3
"""
Script to identify and fix syntax errors in forms.py
"""
import sys
import re

def fix_syntax_error():
    """Fix the syntax error in forms.py by correcting indentation"""
    try:
        # Read the file
        with open('app/ui/forms.py', 'r') as f:
            content = f.read()
        
        # Find the problematic section
        pattern = re.compile(r'except Exception as e:\s+logging\.error\(f"Error connecting with Matrix user:')
        match = pattern.search(content)
        
        if not match:
            print("Could not find the problematic section")
            return False
        
        # Get the position of the match
        pos = match.start()
        
        # Get the lines before the match to analyze indentation
        before_match = content[:pos]
        lines_before = before_match.split('\n')
        
        # Find the last 'try:' before the problematic except
        try_positions = []
        for i, line in enumerate(lines_before):
            if 'try:' in line:
                try_positions.append((i, line))
        
        if not try_positions:
            print("Could not find matching try statement")
            return False
        
        # Get the last try statement
        last_try_index, last_try_line = try_positions[-1]
        
        # Determine indentation of the try statement
        try_indent = len(last_try_line) - len(last_try_line.lstrip())
        
        # Determine indentation of the except statement
        except_line = content[pos:content.find('\n', pos)]
        except_indent = len(except_line) - len(except_line.lstrip())
        
        print(f"Try indentation: {try_indent}")
        print(f"Except indentation: {except_indent}")
        
        # If indentation doesn't match, we need to fix it
        if try_indent != except_indent:
            print(f"Indentation mismatch: try={try_indent}, except={except_indent}")
            
            # Find the correct try statement that should match this except
            correct_try_indent = None
            for i in range(len(try_positions) - 1, -1, -1):
                idx, line = try_positions[i]
                indent = len(line) - len(line.lstrip())
                if indent == except_indent:
                    correct_try_indent = indent
                    print(f"Found matching try at line {idx+1} with indent {indent}")
                    break
            
            if correct_try_indent is None:
                print("Could not find a try statement with matching indentation")
                return False
            
            # Now we need to fix the file
            # This is a simple approach - we'll just output the problematic section
            print("\nProblematic section:")
            lines = content.split('\n')
            
            # Find the line number of the except
            except_line_num = content[:pos].count('\n')
            
            # Print 10 lines before and after
            for i in range(max(0, except_line_num - 10), min(len(lines), except_line_num + 10)):
                prefix = ">>>" if i == except_line_num else "   "
                print(f"{prefix} {i+1}: {lines[i]}")
                
            print("\nPlease fix the indentation manually in the file.")
            
        return True
    
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    fix_syntax_error()
