# utils/transformations.py
"""
This file focuses on parsing and transforming text at input
Typical Input is :
1. First Last (Sometimes with middle sometimes just first name)
2. Organization Name (Sometimes blank)
3. Invited By (Name sometimes blank)
4. Email (Sometimes blank)
5. Interests (List of interests sometimes blank)
"""

import re

# Function to parse the input with 5 fields and return a dictionary
def parse_input(input_text):
    # Remove numbers and any following periods from the input text
    input_text = re.sub(r'^[\d\-#\.]+\s*', '', input_text, flags=re.MULTILINE)
    
    # Split the input text by newlines and strip whitespace
    lines = [line.strip() for line in input_text.split('\n') if line.strip()]
    
    # Initialize the dictionary with default values
    parsed_data = {
        "first_name": "",
        "last_name": "",
        "email": "",
        "invited_by": "",
        "intro": {
            "organization": "",
            "interests": ""
        }
    }
    
    # Search for email in all lines first
    email_found = False
    for i, line in enumerate(lines):
        email_match = re.search(r'[\w\.-]+@[\w\.-]+', line)
        if email_match:
            parsed_data["email"] = email_match.group(0)
            email_found = True
            break

    if len(lines) > 0:
        name_parts = lines[0].split()
        parsed_data["first_name"] = name_parts[0]
        parsed_data["last_name"] = " ".join(name_parts[1:])
    
    if len(lines) > 1:
        parsed_data["intro"]["organization"] = lines[1]
    
    if len(lines) > 2:
        parsed_data["invited_by"] = lines[2]
    
    # Collect all remaining lines as interests
    if email_found and i + 1 < len(lines):
        interests_lines = lines[i + 1:]
        parsed_data["intro"]["interests"] = " ".join(interests_lines)
    
    return parsed_data