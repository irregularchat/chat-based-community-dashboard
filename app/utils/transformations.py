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
from app.utils.gpt_call import gpt_parse_input, gpt_check_api
import logging

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
    # Log the input we're trying to parse
    logging.info(f"Simple parsing input: {input_text[:100]}..." if len(input_text) > 100 else f"Simple parsing input: {input_text}")
    
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
    
    # Check for empty input - return empty dictionary with default values
    if not input_text or not input_text.strip():
        logging.warning("Empty input provided to simple_parse_input")
        return parsed_data
    
    # Remove numbers and any following periods/characters from the input text
    cleaned_text = re.sub(r'^[\d\-#\.*\•\(\)]+\s*', '', input_text, flags=re.MULTILINE)
    logging.info(f"After cleaning prefixes: {cleaned_text[:100]}..." if len(cleaned_text) > 100 else f"After cleaning prefixes: {cleaned_text}")

    # Split the input text by newlines and strip whitespace
    lines = [line.strip() for line in cleaned_text.split('\n') if line.strip()]
    logging.info(f"Parsed {len(lines)} non-empty lines")

    # Search for email in all lines (IMPORTANT: Do this first)
    email_index = -1  # Initialize email index
    email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'  # More precise email regex
    
    for i, line in enumerate(lines):
        email_match = re.search(email_pattern, line)
        if email_match:
            parsed_data["email"] = email_match.group(0)
            email_index = i
            logging.info(f"Found email {parsed_data['email']} at line {i+1}")
            break

    # Parse based on whether email was found or not
    if email_index != -1:
        # Email found, parse name, organization, invited_by from lines before email
        if email_index > 0:
            name_parts = lines[0].split()
            if name_parts:
                parsed_data["first_name"] = name_parts[0]
                parsed_data["last_name"] = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
                logging.info(f"Parsed name: {parsed_data['first_name']} {parsed_data['last_name']}")
        
        if email_index > 1:
            parsed_data["intro"]["organization"] = lines[1]
            logging.info(f"Parsed organization: {parsed_data['intro']['organization']}")
        
        if email_index > 2:
            parsed_data["invited_by"] = lines[2]
            logging.info(f"Parsed invited_by: {parsed_data['invited_by']}")

        # Interests are after email
        if email_index < len(lines) - 1:
            parsed_data["intro"]["interests"] = "; ".join(lines[email_index + 1:])
            logging.info(f"Parsed interests: {parsed_data['intro']['interests']}")
    else:
        # Email not found, try to parse as much as possible
        if len(lines) > 0:
            name_parts = lines[0].split()
            if name_parts:
                parsed_data["first_name"] = name_parts[0]
                parsed_data["last_name"] = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
                logging.info(f"Parsed name (no email): {parsed_data['first_name']} {parsed_data['last_name']}")
        
        if len(lines) > 1:
            parsed_data["intro"]["organization"] = lines[1]
            logging.info(f"Parsed organization (no email): {parsed_data['intro']['organization']}")
        
        if len(lines) > 2:
            parsed_data["invited_by"] = lines[2]
            logging.info(f"Parsed invited_by (no email): {parsed_data['invited_by']}")
        
        if len(lines) > 3:
            parsed_data["intro"]["interests"] = "; ".join(lines[3:])
            logging.info(f"Parsed interests (no email): {parsed_data['intro']['interests']}")
    
    # Final validation check
    if not parsed_data["first_name"] and not parsed_data["last_name"]:
        logging.warning("No name could be parsed from the input")
        
    # Log the final parsed data
    logging.info(f"Final parsed data: {parsed_data}")
    
    return parsed_data


def determine_input_format(input_text):
    """
    Determines if the input text is in numbered list format or chatgpt format.
    Returns 'numbered' for numbered list format, 'chatgpt' for chatgpt format, 
    or None if format is invalid.
    """
    # Clean the input text
    text = input_text.strip()
    logging.info(f"Determining format for: {text[:50]}..." if len(text) > 50 else f"Determining format for: {text}")
    
    if not text:
        # this is an empty string and would mean the user didn't provide any input
        logging.warning("Empty input provided to determine_input_format")
        return None, False
    
    # Check for numbered list format - supports numbers, hashes, dashes, and bullets
    numbered_pattern = r'^(?:\d+[\.\-\)]|#|\-|\•|\*)\s+'
    lines = text.split('\n')
    
    # Count lines with numbering patterns to determine confidence
    numbered_lines = 0
    for line in lines:
        if line.strip() and re.match(numbered_pattern, line.strip()):
            numbered_lines += 1
    
    # If we have multiple numbered lines or the first line is numbered, this is likely a numbered format
    if numbered_lines >= 2 or (lines and re.match(numbered_pattern, lines[0].strip())):
        logging.info(f"Detected numbered format with {numbered_lines} numbered lines")
        return 'numbered', True
    
    # Check for chatgpt format - typically starts with greeting or name
    chatgpt_indicators = ['hi', 'hello', 'thank', 'thanks', 'greetings', 'i am', "i'm", 'my name']
    first_line_lower = lines[0].lower() if lines else ""
    
    if any(indicator in first_line_lower for indicator in chatgpt_indicators):
        logging.info("Detected chatgpt format based on greeting")
        return 'chatgpt', True
    
    # Enhanced structured format detection
    if len(lines) >= 3:  # At least 3 non-empty lines
        non_empty_lines = [line for line in lines if line.strip()]
        if len(non_empty_lines) >= 3:
            # Check for common patterns in structured input:
            # - Contains an email address
            # - Contains a social media handle (@username)
            # - Contains organizational unit/department
            email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'  # More precise email regex
            social_handle_pattern = r'@\w+'
            
            has_email = any(re.search(email_pattern, line) for line in lines)
            has_social = any(re.search(social_handle_pattern, line) for line in lines)
            
            if has_email:
                logging.info("Detected structured format with email address")
                return 'numbered', True
            
            if has_social:
                logging.info("Detected structured format with social handle")
                return 'numbered', True
    
    # If the first line looks like a name (no special chars, not too long)
    if lines and len(lines[0].split()) <= 4 and not re.search(r'[^\w\s]', lines[0]):
        logging.info("Detected structured format with name-like first line")
        return 'numbered', True
    
    # If no clear format is detected, prefer simple parser over GPT
    logging.info("No clear format detected, defaulting to numbered format")
    return 'numbered', False

def parse_input(input_text):
    """
    Main entry point for parsing user input. Determines the format of the input
    and processes it using the appropriate parser (simple or GPT).
    
    Args:
        input_text (str): The raw text input from the user
        
    Returns:
        dict: A dictionary containing the parsed user data or an error message
    """
    if not input_text or not input_text.strip():
        logging.warning("Empty input provided to parse_input")
        # Handle empty input consistently by calling simple_parse_input
        return simple_parse_input("")
    
    try:
        # Log the input we're trying to parse
        logging.info(f"Parsing input: {input_text[:100]}..." if len(input_text) > 100 else f"Parsing input: {input_text}")
        
        # Determine input format
        format_type, is_confident = determine_input_format(input_text)
        logging.info(f"Determined format: {format_type}, confidence: {is_confident}")
        
        if format_type is None:
            return {"error": "Could not determine format. Please check your input."}
        
        if format_type == 'numbered':
            # Use simple parser for numbered format
            result = simple_parse_input(input_text)
            
            # Check for error in result
            if isinstance(result, dict) and "error" in result:
                return result
                
            # Validate output
            if not result.get("first_name") and not result.get("last_name"):
                logging.warning("Parsing successful but no name found")
                # Still return the partial result as it might have other useful information
            
            return result
            
        elif format_type == 'chatgpt':
            # Use GPT for chatgpt format
            try:
                # Get API key from Config
                if gpt_check_api():
                    gpt_result = gpt_parse_input(input_text)
                    logging.info(f"GPT parsing result: {gpt_result}")
                    return gpt_result
                else:
                    # Fall back to simple parser if no API key available
                    logging.warning("No OpenAI API key, falling back to simple parser")
                    return simple_parse_input(input_text)
            except Exception as e:
                logging.error(f"Error using GPT parser: {str(e)}")
                # Fall back to simple parser on error
                logging.warning(f"GPT parsing failed, falling back to simple parser: {str(e)}")
                return simple_parse_input(input_text)
        else:
            # This should never happen, but just in case
            logging.error(f"Unknown format type: {format_type}")
            return {"error": f"Unknown format type: {format_type}"}
            
    except Exception as e:
        logging.error(f"Unexpected error in parse_input: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        return {"error": f"Error parsing input: {str(e)}"}