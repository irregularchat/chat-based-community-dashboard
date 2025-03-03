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
from utils.gpt_call import gpt_parse_input, gpt_check_api

def simple_parse_input(input_text):
    """
    This function works by removing numbers and any following periods, hashes, or dashes, or asterisks, or bullets or parentheses from the input text
    then splitting the input text by newlines and stripping whitespace
    then initializing the dictionary with default values
    then searching for email in all lines first (IMPORTANT)
    then if email is found, parsing the first name and last name
    then if email is not found, parsing the first name and last name
    The final lines are the interests

    """
    # Remove numbers and any following periods/characters from the input text
    input_text = re.sub(r'^[\d\-#\.*\•\(\)]+\s*', '', input_text, flags=re.MULTILINE)

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


def determine_input_format(input_text):
    """
    Determines if the input text is in numbered list format or chatgpt format.
    Returns 'numbered' for numbered list format, 'chatgpt' for chatgpt format, 
    or None if format is invalid.
    """
    # Clean the input text
    text = input_text.strip()
    if not text:
        # this is an empty string and would mean the user didn't provide any input
        return None, False
    
    # Check for numbered list format - supports numbers, hashes, dashes, and bullets
    numbered_pattern = r'^(?:\d+[\.\-\)]|#|\-|\•|\*)\s+'
    lines = text.split('\n')
    
    # If first non-empty line starts with any of the supported formats, treat as numbered format
    for line in lines:
        if line.strip():
            if re.match(numbered_pattern, line.strip()):
                return 'numbered', True
            break
    
    # Check for chatgpt format - typically starts with greeting or name
    chatgpt_indicators = ['hi', 'hello', 'thank', 'thanks', 'greetings', 'i am', "i'm", 'my name']
    first_line_lower = lines[0].lower()
    
    if any(indicator in first_line_lower for indicator in chatgpt_indicators):
        return 'chatgpt', True
    
    # Enhanced structured format detection
    if len(lines) >= 3:  # At least 3 non-empty lines
        non_empty_lines = [line for line in lines if line.strip()]
        if len(non_empty_lines) >= 3:
            # Check for common patterns in structured input:
            # - Contains an email address
            # - Contains a social media handle (@username)
            # - Contains organizational unit/department
            email_pattern = r'[\w\.-]+@[\w\.-]+'
            social_handle_pattern = r'@\w+'
            
            has_email = any(re.search(email_pattern, line) for line in lines)
            has_social = any(re.search(social_handle_pattern, line) for line in lines)
            
            if has_email or has_social:
                return 'numbered', True
    
    # If no clear format is detected, return chatgpt with mismatch flag
    return 'chatgpt', False

def parse_input(input_text):
    format_type, _ = determine_input_format(input_text)
    if format_type == 'numbered':
        return simple_parse_input(input_text)
    elif format_type == 'chatgpt':
        try:
            # Get API key from Config
            if gpt_check_api():
                return gpt_parse_input(input_text)
            else:
                return {"error": "Please provide a valid OpenAI API key"}
        except Exception as e:
            return {"error": f"OpenAI API error: {str(e)}"}
    else:
        return None, False