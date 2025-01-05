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
    # Remove numbers from the input text
    input_text = re.sub(r'\d+', '', input_text)
    
    # Split the input text by spaces
    fields = input_text.split()
    
    # Initialize the dictionary with default values
    parsed_data = {
        "name": fields[0] if len(fields) > 0 else "",
        "organization": "",
        "invited_by": "",
        "email": "",
        "interests": ""
    }
    
    # Iterate over the fields to find email and other data
    for field in fields[1:]:
        if "@" in field and "." in field:
            parsed_data["email"] = field
        elif parsed_data["organization"] == "":
            parsed_data["organization"] = field
        elif parsed_data["invited_by"] == "":
            parsed_data["invited_by"] = field
        else:
            parsed_data["interests"] += field + " "
    
    # Trim any trailing space from interests
    parsed_data["interests"] = parsed_data["interests"].strip()
    
    return parsed_data