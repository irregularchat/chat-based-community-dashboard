# utils/gpt_call.py
"""
This file is for calling the GPT API and returning the response
"""

from openai import OpenAI
from app.utils.config import Config

# initialize the OpenAI client and check if it is initialized from the config file
client = OpenAI(api_key=Config.OPENAI_API_KEY)
if not client:
    raise ValueError("OpenAI client not initialized")


def gpt_check_api():
    """
    Check if the OPENAI_API_KEY is valid and that the client is initialized
    Check for empty, invalid, and incorrect API keys
    """
    OPENAI_API_KEY = Config.OPENAI_API_KEY
    openai_api_key_status = False
    if not OPENAI_API_KEY:
        openai_api_key_status = False
        raise ValueError("OPENAI_API_KEY not initialized")
    if OPENAI_API_KEY == "":
        openai_api_key_status = False
        raise ValueError("OPENAI_API_KEY is empty")
    if not OPENAI_API_KEY.startswith("sk-"):
        openai_api_key_status = False
        raise ValueError("OPENAI_API_KEY must start with 'sk-'")
    if len(OPENAI_API_KEY) < 20 or len(OPENAI_API_KEY) > 200:
        openai_api_key_status = False
        raise ValueError("OPENAI_API_KEY must be between 20 and 200 characters")
    if OPENAI_API_KEY == "sk-proj-01234567890123456789012345678901":
        openai_api_key_status = False
        raise ValueError("OPENAI_API_KEY is invalid")
    client = OpenAI(api_key=OPENAI_API_KEY)
    if not client:
        openai_api_key_status = False
        raise ValueError("OpenAI client not initialized")
    # tiny sample call to check if the API key is valid
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "briefly with only a number, what is 1+1?"}],
    )
    if response.choices[0].message.content == "2":
        openai_api_key_status = True
    return openai_api_key_status


def gpt_call(prompt, model="gpt-4o-mini", role="user"):
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": role, "content": prompt}],
    )
    return response.choices[0].message.content

def gpt_parse_input(input_text):
    """
    Parse the input text using GPT-4o-mini with a structured prompt and return in the same format as simple_parse_input
    """
    parsing_prompt = f"""Parse this introduction into a structured format. Return ONLY a numbered list with exactly these items in order:
1. Full Name
2. Organization and Role
3. Invited by
4. Email
5. Interests

{input_text}"""
    
    # Get GPT response and format it as a numbered list
    gpt_response = gpt_call(parsing_prompt, model="gpt-4o-mini", role="user")
    
    # Convert GPT response to lines and clean them
    lines = [line.strip() for line in gpt_response.split('\n') if line.strip()]
    
    # Remove any numbers at the start of lines
    lines = [line.split('.', 1)[-1].strip() for line in lines]
    
    # Create the structured dictionary
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
    
    # Fill in the dictionary based on the lines
    if len(lines) > 0 and lines[0] != "MISSING_NOT_PROVIDED":
        name_parts = lines[0].split()
        if name_parts:
            parsed_data["first_name"] = name_parts[0]
            parsed_data["last_name"] = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
    
    if len(lines) > 1 and lines[1] != "MISSING_NOT_PROVIDED":
        parsed_data["intro"]["organization"] = lines[1]
    
    if len(lines) > 2 and lines[2] != "MISSING_NOT_PROVIDED":
        parsed_data["invited_by"] = lines[2]
    
    if len(lines) > 3 and lines[3] != "MISSING_NOT_PROVIDED":
        parsed_data["email"] = lines[3]
    
    if len(lines) > 4 and lines[4] != "MISSING_NOT_PROVIDED":
        parsed_data["intro"]["interests"] = lines[4]
    
    return parsed_data