# Authentik User Creation Script

This script automates the creation of user accounts on an Authentik instance. It generates a strong password and ensures unique usernames. The script uses environment variables for secure handling of sensitive information.

## Prerequisites

- Python 3.x
- `requests` library
- `python-dotenv` library
- Access to the Authentik API
   - If you are an admin, you can generate an API token from the Authentik web interface: https://sso.irregularchat.com/if/admin/#/core/tokens
## Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/irregularchat/authentik-account-creation.git
   cd authentik-user-creation
   ```

2. **Create a Virtual Environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows use `venv\Scripts\activate`
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set Up Environment Variables**
   - Copy the .env template, gitignore it so that it doesn't sync and edit
   ```bash
   cp .env-template .env
   echo ".env" >> .gitignore
   echo "venv" >> .gitignore

   nano .env
   ```
   - Or create a `.env` file in the project directory and add the following:
     ```env
      AUTHENTIK_API_TOKEN=your_api_token_here
      base_password = "usePasswordManager-" #Looking to remind the user 
      MAIN_GROUP_ID = GROUP_ID #The group id you want to add the user to    
      ```
     - add to gitignore

    ```bash
    echo ".env" >> .gitignore
    ```

## Usage

### Create User Account
#### Syntax

Run the script to create a new user account:
```bash
python authentik-creation-workflow.py create {username}
```

Run the script to reset the password for a user account:
```bash
python authentik-creation-workflow.py reset {username}
```
#### Example Output
```plaintext
New Username: user1
New Password: TempPassword@2gh#k
[Community Message]
```
### Create Temporary Invite Link
#### Syntax
```bash
python authentik-creation-workflow.py invite {username|group|event|person}
```

#### Example Output
```plaintext
🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans.  Here's what you need to know to get started and a guide to join the wiki and other services:

IrregularChat Temp Invite: https://sso.irregularchat.com/if/flow/simple-enrollment-flow/?itoken=goes_here_123
Invite Expires: 2 hours from now

🌟 After you login you'll see options for the wiki, matrix "element messenger", and other self-hosted services.
Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/links/
```
### Reset Password
#### Syntax
```bash
python authentik-creation-workflow.py reset {username}
```

## Script Overview

### Environment Variables

- `AUTHENTIK_API_TOKEN`: The API token for accessing the Authentik API.
- `base_password`: The base pasword to generate unique passwords.

### Functions

- **generate_password()**: Generates a strong password starting with "TempPassword" followed by a random sequence of characters and numbers.
- **create_unique_username(base_username, existing_usernames)**: Ensures the generated username is unique by appending a counter if necessary.
- **get_existing_usernames(api_url, headers)**: Retrieves the list of existing usernames from the Authentik API.
- **create_user(api_url, headers, username, password)**: Creates a new user on the Authentik instance with the provided username and password.
- **reset_password(api_url, headers, username, password)**: Resets the password for an existing user on the Authentik instance.

## Best Practices for Setting Up the Environment

1. **Use a Virtual Environment**: Always use a virtual environment to manage dependencies and avoid conflicts with other projects.
2. **Store Sensitive Information Securely**: Use environment variables to store sensitive information like API tokens. Never hard-code them in your script.
3. **Use a `.env` File**: Use a `.env` file to manage environment variables. Make sure to add the `.env` file to your `.gitignore` to avoid committing sensitive information to version control.

## Running on a Server

#TODO

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.
