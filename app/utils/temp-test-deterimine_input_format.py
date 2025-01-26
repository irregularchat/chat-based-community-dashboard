# temp test to determine if the input is in numbered list format or chatgpt format
import re

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

# get input from user - collect multiple lines
def get_multiline_input():
    print("Enter/paste your text (press Enter twice to finish):")
    lines = []
    while True:
        try:
            line = input()
            if line == "":
                if lines and lines[-1] == "":  # Two consecutive empty lines
                    break
            lines.append(line)
        except EOFError:
            break
    return "\n".join(lines)

input_text = get_multiline_input()
format_type, is_confident = determine_input_format(input_text)
print(f"\nInput text:")
print("-" * 40)
print(input_text)
print("-" * 40)
print(f"Detected format: {format_type}")
if not is_confident:
    print("Possible Mismatch - defaulting to chatgpt format")

