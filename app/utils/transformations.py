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

def parse_input(input_text):
    """
    Parse the input with 5 fields and return a dictionary
    This function works by removing numbers and any following periods from the input text
    then splitting the input text by newlines and stripping whitespace
    then initializing the dictionary with default values
    then searching for email in all lines first (IMPORTANT)
    then if email is found, parsing the first name and last name
    then if email is not found, parsing the first name and last name
    The final lines are the interests

    """
    # Remove numbers and any following periods/characters from the input text
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

    # Search for email in all lines (IMPORTANT: Do this first)
    email_index = -1  # Initialize email index
    for i, line in enumerate(lines):
        email_match = re.search(r'[\w\.-]+@[\w\.-]+', line)
        if email_match:
            parsed_data["email"] = email_match.group(0)
            email_index = i
            break

    # Parse based on whether email was found or not
    if email_index != -1:
        # Email found, parse name, organization, invited_by from lines before email
        if email_index > 0:
            name_parts = lines[0].split()
            parsed_data["first_name"] = name_parts[0]
            parsed_data["last_name"] = " ".join(name_parts[1:])
        if email_index > 1:
            parsed_data["intro"]["organization"] = lines[1]
        if email_index > 2:
            parsed_data["invited_by"] = lines[2]

        # Interests are after email
        parsed_data["intro"]["interests"] = "; ".join(lines[email_index + 1:])
    else:
        # Email not found, try to parse as much as possible
        if len(lines) > 0:
            name_parts = lines[0].split()
            parsed_data["first_name"] = name_parts[0]
            parsed_data["last_name"] = " ".join(name_parts[1:])
        if len(lines) > 1:
            parsed_data["intro"]["organization"] = lines[1]
        if len(lines) > 2:
            parsed_data["invited_by"] = lines[2]
        if len(lines) > 3:
            parsed_data["intro"]["interests"] = "; ".join(lines[3:])

    return parsed_data