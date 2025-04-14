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
        },
        "signal_username": "",
        "phone_number": "",
        "linkedin_username": ""
    }
    
    # Check for empty input - return empty dictionary with default values
    if not input_text or not input_text.strip():
        logging.warning("Empty input provided to simple_parse_input")
        return parsed_data
    
    # Check if this appears to be the standard 6-line numbered format with:
    # 1. NAME, 2. ORGANIZATION, 3. INVITED BY, 4. EMAIL, 5. INTERESTS, 6. LINKEDIN
    lines = [line.strip() for line in input_text.split('\n') if line.strip()]
    if len(lines) >= 4:  # At least 4 lines to get the minimum required info
        # Check lines for ordinal numbers (1st, 2nd, 3rd, 4th, etc.) which shouldn't be treated as list markers
        # This is a common pattern in descriptions rather than list indexes
        has_ordinal_numbers = any(
            re.match(r'^\d+(st|nd|rd|th)', line.strip()) for line in lines[:min(6, len(lines))]
        )
        
        if has_ordinal_numbers:
            logging.info("Detected text with ordinal numbers (1st, 2nd, etc.) - not treating as numbered format")
            # Skip the numbered format processing for text with ordinals
        else:
            # Enhanced regex to match various number formats like: 1. 1: 1- 1) 1.. 1_ etc.
            numbered_format = all(
                re.match(r'^\d+[\.\:\-\)\(\]\[\}\{_\s]*\s*', line) for line in lines[:min(6, len(lines))]
            )
            
            if numbered_format:
                logging.info("Detected standard numbered format with 6 specific fields")
                # Process each line by specific position, removing the number prefix
                for i, line in enumerate(lines):
                    # Remove the number prefix with enhanced regex to handle more formats
                    content = re.sub(r'^\d+[\.\:\-\)\(\]\[\}\{_\s]*\s*', '', line).strip()
                    
                    if i == 0:  # Line 1: Name
                        name_parts = content.split()
                        if name_parts:
                            parsed_data["first_name"] = name_parts[0]
                            if len(name_parts) > 1:
                                parsed_data["last_name"] = " ".join(name_parts[1:])
                        logging.info(f"Parsed name: {parsed_data['first_name']} {parsed_data['last_name']}")
                        
                    elif i == 1:  # Line 2: Organization
                        parsed_data["intro"]["organization"] = content
                        logging.info(f"Parsed organization: {content}")
                        
                    elif i == 2:  # Line 3: Invited by
                        parsed_data["invited_by"] = content
                        logging.info(f"Parsed invited by: {content}")
                        
                    elif i == 3:  # Line 4: Email
                        # Clean and validate the email if possible
                        email = content.strip()
                        if '@' in email:
                            parsed_data["email"] = email
                        logging.info(f"Parsed email: {email}")
                        
                    elif i == 4:  # Line 5: Interests
                        parsed_data["intro"]["interests"] = content
                        logging.info(f"Parsed interests: {content}")
                        
                    elif i == 5:  # Line 6: LinkedIn Username
                        parsed_data["linkedin_username"] = content
                        logging.info(f"Parsed LinkedIn username: {content}")
                
                # Return early since we've processed the specific format
                return parsed_data
    
    # If not the specific numbered format, proceed with the original parsing logic
    # Remove numbers and any following periods/characters from the input text
    # Enhanced regex to handle more special characters consistently
    cleaned_text = re.sub(r'^[\d\-#\.\:\*\•\(\)\[\]\{\}_]+\s*', '', input_text, flags=re.MULTILINE)
    
    # Split the input text by newlines and strip whitespace
    lines = [line.strip() for line in cleaned_text.split('\n') if line.strip()]
    
    # Detect if this is form-style input (contains field labels)
    has_form_labels = False
    form_patterns = {
        'first_name': r'^(?:First\s*Name\s*[:,-]?\s*)(.*)',
        'last_name': r'^(?:Last\s*Name\s*[:,-]?\s*)(.*)',
        'full_name': r'^(?:(?:Full\s*)?Name\s*[:,-]?\s*)(.*)',
        'email': r'^(?:Email\s*(?:Address)?\s*[:,-]?\s*)(.*)',
        'organization': r'^(?:Organization\s*[:,-]?\s*)(.*)',
        'invited_by': r'^(?:Invited\s*by\s*[:,-]?\s*)(.*)',
        'interests': r'^(?:Interests\s*[:,-]?\s*)(.*)',
        'signal_username': r'^(?:Signal\s*(?:Username|ID)?\s*[:,-]?\s*)(.*)',
        'phone_number': r'^(?:Phone\s*(?:Number)?\s*[:,-]?\s*)(.*)',
        'linkedin_username': r'^(?:LinkedIn\s*(?:Username|ID|Profile)?\s*[:,-]?\s*)(.*)'
    }
    
    # Check if this is likely a form input
    for line in lines:
        for pattern in form_patterns.values():
            if re.search(pattern, line, re.IGNORECASE):
                has_form_labels = True
                break
        if has_form_labels:
            break
    
    # If it's form-style input, extract the values directly
    if has_form_labels:
        logging.info("Detected form-style input, extracting values from labeled fields")
        
        # Extract values based on field labels
        for i, line in enumerate(lines):
            # First name
            match = re.search(form_patterns['first_name'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["first_name"] = match.group(1).strip()
                continue
                
            # Last name
            match = re.search(form_patterns['last_name'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["last_name"] = match.group(1).strip()
                continue
                
            # Full name
            match = re.search(form_patterns['full_name'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                name_parts = match.group(1).split()
                if name_parts:
                    parsed_data["first_name"] = name_parts[0]
                    parsed_data["last_name"] = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
                continue
                
            # Email
            match = re.search(form_patterns['email'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                email = match.group(1).strip()
                # Check for complete email with @ and domain
                email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', email)
                # Check for incomplete email with just @domain (missing TLD)
                incomplete_email_match = re.search(r'[\w\.-]+@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|zoho|mail|yandex)$', email, re.IGNORECASE)
                
                if email_match:
                    parsed_data["email"] = email_match.group(0)
                elif incomplete_email_match:
                    # Add .com to common domains that are missing it
                    domain = incomplete_email_match.group(1).lower()
                    corrected_email = f"{email}.com"
                    logging.info(f"Fixed incomplete email: {email} -> {corrected_email}")
                    parsed_data["email"] = corrected_email
                else:
                    parsed_data["email"] = email
                continue
                
            # Organization
            match = re.search(form_patterns['organization'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["intro"]["organization"] = match.group(1).strip()
                continue
                
            # Invited by
            match = re.search(form_patterns['invited_by'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["invited_by"] = match.group(1).strip()
                continue
                
            # Interests
            match = re.search(form_patterns['interests'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["intro"]["interests"] = match.group(1).strip()
                continue
                
            # Signal username
            match = re.search(form_patterns['signal_username'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["signal_username"] = match.group(1).strip()
                continue
                
            # Phone number
            match = re.search(form_patterns['phone_number'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["phone_number"] = match.group(1).strip()
                continue
                
            # LinkedIn username
            match = re.search(form_patterns['linkedin_username'], line, re.IGNORECASE)
            if match and match.group(1).strip():
                parsed_data["linkedin_username"] = match.group(1).strip()
                continue
                
            # Also check for lines that just have "Invited by" text without the colon
            invited_match = re.search(r'^Invited\s+by\s+(.+)', line, re.IGNORECASE)
            if invited_match and invited_match.group(1).strip():
                parsed_data["invited_by"] = invited_match.group(1).strip()
                continue
                
            # If none of the patterns match but the line has an email, extract it
            email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
            if email_match:
                parsed_data["email"] = email_match.group(0)
                continue
                
            # Check for incomplete email with just @domain (missing TLD)
            incomplete_email_match = re.search(r'[\w\.-]+@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|zoho|mail|yandex)$', line, re.IGNORECASE)
            if incomplete_email_match:
                # Add .com to common domains that are missing it
                full_email = line
                corrected_email = f"{full_email}.com"
                logging.info(f"Fixed incomplete email: {full_email} -> {corrected_email}")
                parsed_data["email"] = corrected_email
                continue
        
        # If we're still missing a name but have something in line 1, try to use it
        if not parsed_data["first_name"] and not parsed_data["last_name"] and len(lines) > 0:
            # Check if the first line appears to be a name (no special characters)
            if not re.search(r'[:@\d]', lines[0]):
                name_parts = lines[0].split()
                if name_parts:
                    parsed_data["first_name"] = name_parts[0]
                    parsed_data["last_name"] = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
    else:
        # If not form-style, use the original parsing logic
        logging.info("Using standard parsing logic for non-form input")
        
        # Clean up common labels from each line
        label_patterns = [
            r'^(First\s*Name\s*[:,-]?\s*)',
            r'^(Last\s*Name\s*[:,-]?\s*)',
            r'^(Name\s*[:,-]?\s*)',
            r'^(Email\s*[:,-]?\s*)',
            r'^(Email\s*Address\s*[:,-]?\s*)',
            r'^(Organization\s*[:,-]?\s*)',
            r'^(Invited\s*by\s*[:,-]?\s*)',
            r'^(Interests\s*[:,-]?\s*)',
            r'^(Signal\s*Username\s*[:,-]?\s*)',
            r'^(Phone\s*Number\s*[:,-]?\s*)',
            r'^(LinkedIn\s*Username\s*[:,-]?\s*)'
        ]
        
        cleaned_lines = []
        for line in lines:
            # Try each label pattern and remove if found
            cleaned_line = line
            for pattern in label_patterns:
                cleaned_line = re.sub(pattern, '', cleaned_line, flags=re.IGNORECASE)
            cleaned_lines.append(cleaned_line.strip())
        
        lines = cleaned_lines
        logging.info(f"Parsed {len(lines)} non-empty lines after label removal")
        
        # Search for email in all lines (IMPORTANT: Do this first)
        email_index = -1  # Initialize email index
        email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'  # More precise email regex
        incomplete_email_pattern = r'[\w\.-]+@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|zoho|mail|yandex)$'  # Pattern for common domains without TLD
        
        for i, line in enumerate(lines):
            # First check for complete email
            email_match = re.search(email_pattern, line)
            if email_match:
                parsed_data["email"] = email_match.group(0)
                email_index = i
                logging.info(f"Found email {parsed_data['email']} at line {i+1}")
                break
                
            # Then check for incomplete email (missing TLD)
            incomplete_match = re.search(incomplete_email_pattern, line, re.IGNORECASE)
            if incomplete_match:
                domain = incomplete_match.group(1).lower()
                corrected_email = f"{line}.com"
                logging.info(f"Fixed incomplete email: {line} -> {corrected_email}")
                parsed_data["email"] = corrected_email
                email_index = i
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
                # Check if this line contains "invited by" text
                invited_line = lines[2].lower()
                if "invited" in invited_line and "by" in invited_line:
                    # Try to extract just the name part after "invited by"
                    invited_match = re.search(r'invited\s+by\s+(.+)', invited_line, re.IGNORECASE)
                    if invited_match:
                        parsed_data["invited_by"] = invited_match.group(1).strip()
                    else:
                        parsed_data["invited_by"] = lines[2]
                else:
                    parsed_data["invited_by"] = lines[2]
                logging.info(f"Parsed invited_by: {parsed_data['invited_by']}")
    
            # Interests are after email
            if email_index < len(lines) - 1:
                interests_lines = lines[email_index + 1:]
                # Check if the first line starts with "interests" or contains it
                if interests_lines and re.match(r'^interests', interests_lines[0], re.IGNORECASE):
                    # Extract just the part after "interests"
                    interests_match = re.search(r'interests:?\s*(.+)', interests_lines[0], re.IGNORECASE)
                    if interests_match:
                        interests_lines[0] = interests_match.group(1)
                
                parsed_data["intro"]["interests"] = "; ".join(interests_lines)
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
                # Check if this line contains "invited by" text
                invited_line = lines[2].lower()
                if "invited" in invited_line and "by" in invited_line:
                    # Try to extract just the name part after "invited by"
                    invited_match = re.search(r'invited\s+by\s+(.+)', invited_line, re.IGNORECASE)
                    if invited_match:
                        parsed_data["invited_by"] = invited_match.group(1).strip()
                    else:
                        parsed_data["invited_by"] = lines[2]
                else:
                    parsed_data["invited_by"] = lines[2]
                logging.info(f"Parsed invited_by (no email): {parsed_data['invited_by']}")
            
            if len(lines) > 3:
                interests_lines = lines[3:]
                # Check if the first line starts with "interests" or contains it
                if interests_lines and re.match(r'^interests', interests_lines[0], re.IGNORECASE):
                    # Extract just the part after "interests"
                    interests_match = re.search(r'interests:?\s*(.+)', interests_lines[0], re.IGNORECASE)
                    if interests_match:
                        interests_lines[0] = interests_match.group(1)
                
                parsed_data["intro"]["interests"] = "; ".join(interests_lines)
                logging.info(f"Parsed interests (no email): {parsed_data['intro']['interests']}")
    
    # Final validation and correction for email addresses
    if parsed_data["email"]:
        # Check if the email has a TLD (like .com, .org, etc)
        if not re.search(r'\.\w+$', parsed_data["email"]):
            # Check if it's a common domain without TLD
            incomplete_match = re.search(r'([\w\.-]+@)(gmail|yahoo|hotmail|outlook|aol|icloud|proton|zoho|mail|yandex)$', 
                                         parsed_data["email"], re.IGNORECASE)
            if incomplete_match:
                domain = incomplete_match.group(2).lower()
                corrected_email = f"{parsed_data['email']}.com"
                logging.info(f"Added missing .com to email: {parsed_data['email']} -> {corrected_email}")
                parsed_data["email"] = corrected_email
    
    # Handle organization and interests if not already set
    # If we have multiple interests but no organization, move the first interest to organization
    if not parsed_data["intro"]["organization"] and ";" in parsed_data["intro"]["interests"]:
        interests = parsed_data["intro"]["interests"].split(";")
        parsed_data["intro"]["organization"] = interests[0].strip()
        parsed_data["intro"]["interests"] = "; ".join([i.strip() for i in interests[1:]])
    
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
    
    # Check for form-style format with field labels (common when copying from forms)
    form_labels = [
        r'first\s*name\s*:',
        r'last\s*name\s*:',
        r'name\s*:',
        r'email\s*:',
        r'email\s*address\s*:',
        r'organization\s*:',
        r'invited\s*by\s*:',
        r'interests\s*:'
    ]
    
    form_label_count = 0
    lines = text.split('\n')
    for line in lines:
        line_lower = line.lower().strip()
        if any(re.search(pattern, line_lower) for pattern in form_labels):
            form_label_count += 1
    
    # If multiple form-style labels are found, treat as numbered format (which will strip labels)
    if form_label_count >= 2:
        logging.info(f"Detected form-style format with {form_label_count} labeled fields")
        return 'numbered', True
    
    # Check for numbered list format - supports numbers, hashes, dashes, and bullets
    numbered_pattern = r'^(?:\d+[\.\-\)]|#|\-|\•|\*)\s+'
    
    # Check for ordinal numbers (1st, 2nd, 3rd, etc.) which shouldn't be treated as numbered list markers
    has_ordinal_numbers = any(
        re.match(r'^\d+(st|nd|rd|th)', line.strip()) for line in lines
    )
    
    if has_ordinal_numbers:
        logging.info("Detected text with ordinal numbers (1st, 2nd, etc.) - not treating as standard numbered format")
        # If we have ordinal numbers, it's likely part of content description not a list format
        # Let's not override it to chatgpt, but be less confident in it being numbered
        return 'chatgpt', True
    
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