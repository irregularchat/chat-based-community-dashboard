# Authentik User Creation Script

This application brings authentik admin actions in a controled and dedicated manner for your community moderators. The application uses environment variables for secure handling of sensitive information. The application runs with streamlit and can be deployed on a server for easy access by the community moderators. No Authentication is built into the application, so it is important to secure the server where the application is deployed; this app has been tested with an identity aware proxy like cloudlfare access.

The application has the following features:
- Create a new user account, generating a custom message for the user
- Reset the password for an existing user account
- Create a temporary invite link for a user, group, event, or person, with an expiration time and label
- List all users in the system
- Search users and filter by multiple attributes
- Update selected users by:
   - Activating / Deactivating
   - Changing password
   - Deleting


## Prerequisites

- Docker Compose
- Access to the Authentik API
   - If you are an admin, you can generate an API token from the Authentik web interface: https://sso.domain.tld/if/admin/#/core/tokens
## Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/irregularchat/authentik-account-creation.git
   cd authentik-user-creation
   ```

2. **Set Up Environment Variables**
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
3. **Build and Run the Docker Container**
   ```bash
   docker-compose up -d --build
   ```
## Usage

### Local Development
1. **Access the Application**
   - Open a web browser and navigate to `http://localhost:8501` to access the application.

### Production Deployment
1. **Setup Cloudflared Tunnel**
2. **Serve Application**
   - Set domain or subdomain 
   - Point cloudflare tunnel to  `http://localhost:8501` to access the application
3. **Access the Application**
   - Open a web browser and navigate to `http://your.domain.tld` to access the application.

## Best Practices for Setting Up the Environment

1. **Use a Virtual Environment**: Always use a virtual environment to manage dependencies and avoid conflicts with other projects.
2. **Store Sensitive Information Securely**: Use environment variables to store sensitive information like API tokens. Never hard-code them in your script.
3. **Use a `.env` File**: Use a `.env` file to manage environment variables. Make sure to add the `.env` file to your `.gitignore` to avoid committing sensitive information to version control.


## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.
