import os
import re
import sys

def find_python_files(directory):
    """
    Recursively find all Python files in the given directory.
    Skip virtual environment directories and other non-app directories.
    """
    python_files = []
    for root, dirs, files in os.walk(directory):
        # Skip virtual environment directories and other non-app directories
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != 'env' and d != 'venv']
        
        for file in files:
            if file.endswith('.py'):
                python_files.append(os.path.join(root, file))
    return python_files

def extract_form_keys(file_path):
    """Extract all form keys from a Python file."""
    form_keys = []
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            content = file.read()
            line_numbers = []
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if "st.form(" in line:
                    line_numbers.append(i + 1)  # +1 because line numbers start at 1
            
            # Use regex to find all form keys
            pattern = r"st\.form\(['\"]([^'\"]*)['\"]"
            matches = re.finditer(pattern, content)
            
            for match in matches:
                key = match.group(1)
                # Find the line number for this key
                pos = match.start()
                line_number = content.count('\n', 0, pos) + 1
                form_keys.append((key, line_number))
                
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")
    
    return form_keys

def main():
    # Get the root directory of the project
    current_file = os.path.abspath(__file__)
    root_dir = os.path.dirname(os.path.dirname(current_file))
    
    # Only check files in the app directory
    app_dir = os.path.join(root_dir, 'app')
    
    # Find all Python files
    python_files = find_python_files(app_dir)
    
    # Extract form keys from all files
    all_form_keys = {}
    for file_path in python_files:
        keys = extract_form_keys(file_path)
        for key, line_number in keys:
            relative_path = os.path.relpath(file_path, root_dir)
            if key not in all_form_keys:
                all_form_keys[key] = []
            all_form_keys[key].append((relative_path, line_number))
    
    # Print all form keys
    print("\n=== All form keys found ===")
    for key, locations in sorted(all_form_keys.items()):
        print(f"Key: '{key}' used in:")
        for location in locations:
            print(f"  - {location[0]}:{location[1]}")
    
    # Check for duplicate keys
    duplicate_keys = {key: locations for key, locations in all_form_keys.items() if len(locations) > 1}
    
    if duplicate_keys:
        print("\n=== DUPLICATE FORM KEYS FOUND ===")
        for key, locations in duplicate_keys.items():
            print(f"Key: '{key}' is used in multiple locations:")
            for location in locations:
                print(f"  - {location[0]}:{location[1]}")
        print("\nDuplicate form keys can cause issues with Streamlit's session state.")
        print("Please ensure each form has a unique key.")
        sys.exit(1)
    else:
        print("\n✅ No duplicate form keys found.")
        
def test_unique_form_keys():
    """
    Test to ensure all Streamlit form keys are unique across the codebase.
    """
    # Get the root directory of the project
    current_file = os.path.abspath(__file__)
    root_dir = os.path.dirname(os.path.dirname(current_file))
    
    # Only check files in the app directory
    app_dir = os.path.join(root_dir, 'app')
    
    # Find all Python files
    python_files = find_python_files(app_dir)
    
    # Extract form keys from all files
    all_form_keys = {}
    for file_path in python_files:
        keys = extract_form_keys(file_path)
        for key, line_number in keys:
            relative_path = os.path.relpath(file_path, root_dir)
            if key not in all_form_keys:
                all_form_keys[key] = []
            all_form_keys[key].append((relative_path, line_number))
    
    # Check for duplicate keys
    duplicate_keys = {key: locations for key, locations in all_form_keys.items() if len(locations) > 1}
    
    error_message = ""
    if duplicate_keys:
        error_message = "Duplicate form keys found:\n"
        for key, locations in duplicate_keys.items():
            error_message += f"Key: '{key}' is used in multiple locations:\n"
            for location in locations:
                error_message += f"  - {location[0]}:{location[1]}\n"
        error_message += "\nDuplicate form keys can cause issues with Streamlit's session state."
    
    assert not duplicate_keys, error_message

if __name__ == "__main__":
    main() 