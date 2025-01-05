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
        "first_name": fields[0] if len(fields) > 0 else "",
        "last_name": "",
        "email": "",
        "invited_by": "",
        "intro": {
            "organization": "",
            "interests": ""
        }
    }
    
    # Iterate over the fields to find email and other data
    for field in fields[1:]:
        if "@" in field and "." in field:
            parsed_data["email"] = field
        elif parsed_data["invited_by"] == "":
            parsed_data["invited_by"] = field
        else:
            if parsed_data["intro"]["organization"] == "":
                parsed_data["intro"]["organization"] = field
            else:
                parsed_data["intro"]["interests"] += field + " "
    
    # Assign remaining fields to last_name
    last_name_index = fields.index(parsed_data["email"]) if parsed_data["email"] else len(fields)
    parsed_data["last_name"] = " ".join(fields[1:last_name_index])
    
    # Trim any trailing space from interests
    parsed_data["intro"]["interests"] = parsed_data["intro"]["interests"].strip()
    
    return parsed_data