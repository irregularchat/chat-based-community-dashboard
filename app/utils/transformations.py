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
    
    # Assign fields based on expected order
    if len(lines) > 0:
        name_parts = lines[0].split()
        parsed_data["first_name"] = name_parts[0]
        parsed_data["last_name"] = " ".join(name_parts[1:])
    
    if len(lines) > 1:
        parsed_data["intro"]["organization"] = lines[1]
    
    if len(lines) > 2:
        parsed_data["invited_by"] = lines[2]
    
    if len(lines) > 3:
        parsed_data["email"] = lines[3]
    
    if len(lines) > 4:
        parsed_data["intro"]["interests"] = " ".join(lines[4:])
    
    return parsed_data