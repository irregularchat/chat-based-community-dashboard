#!/usr/bin/env python3
import logging
from app.utils.transformations import determine_input_format, simple_parse_input, parse_input

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def test_parsing():
    """Test the parsing functionality with various input formats"""
    
    test_cases = [
        {
            "name": "Basic input without labels",
            "input": """John Doe
test@example.com
Sample Organization
Python, AI, Testing""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "test@example.com"
            }
        },
        {
            "name": "Input with labels",
            "input": """First Name: John
Last Name: Doe
Email: test@example.com
Organization: Sample Organization
Invited by: Jane Smith
Interests: Python, AI, Testing""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "test@example.com",
                "invited_by": "Jane Smith"
            }
        },
        {
            "name": "Input with mixed label formats",
            "input": """First Name - John
Last Name - Doe
Email Address: test@example.com
Invited by Jane Smith
Interests: Python, AI, Testing""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "test@example.com",
                "invited_by": "Jane Smith"
            }
        },
        {
            "name": "Input with Name: as a single field",
            "input": """Name: John Doe
Email: test@example.com
Organization: Sample Organization
Invited by: Jane Smith
Interests: Python, AI, Testing""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "test@example.com",
                "invited_by": "Jane Smith"
            }
        },
        {
            "name": "Input copied from screenshot",
            "input": """Full
Name: testing whiskey
Email: test@test.com
Invited by: sac""",
            "expected": {
                "first_name": "testing",
                "last_name": "whiskey",
                "email": "test@test.com",
                "invited_by": "sac"
            }
        },
        {
            "name": "Input with incomplete Gmail domain",
            "input": """John Doe
john.doe@gmail
Acme Corp
Invited by Jane Smith""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "john.doe@gmail.com",
                "invited_by": "Jane Smith"
            }
        },
        {
            "name": "Input with labeled incomplete email domain",
            "input": """First Name: Jane
Last Name: Smith
Email: jane.smith@yahoo
Organization: Example Corp
Invited by: John Doe""",
            "expected": {
                "first_name": "Jane",
                "last_name": "Smith",
                "email": "jane.smith@yahoo.com",
                "invited_by": "John Doe"
            }
        },
        {
            "name": "Input with various numbered formats",
            "input": """1: John Doe
2.. ABC Organization
3_ Invited by Jane Smith
4: test@example.com
5:: Python, AI, Testing""",
            "expected": {
                "first_name": "John",
                "last_name": "Doe",
                "email": "test@example.com",
                "invited_by": "Invited by Jane Smith"
            }
        }
    ]
    
    for i, test_case in enumerate(test_cases):
        print(f"\n\n===== Test Case {i+1}: {test_case['name']} =====")
        print("Input:")
        print(test_case['input'])
        
        # First determine the format
        format_type, confidence = determine_input_format(test_case['input'])
        print(f"\nDetected format: {format_type}, confidence: {confidence}")
        
        # Parse the input
        parsed = parse_input(test_case['input'])
        print("\nParsed result:")
        print(parsed)
        
        # Check if the expected fields match
        print("\nValidation:")
        for key, expected_value in test_case['expected'].items():
            if key not in parsed:
                print(f"❌ Missing key: {key}")
                continue
                
            actual_value = parsed[key]
            if actual_value == expected_value:
                print(f"✅ {key}: {actual_value}")
            else:
                print(f"❌ {key}: Expected '{expected_value}', got '{actual_value}'")

if __name__ == "__main__":
    test_parsing() 