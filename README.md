# Chat Based Community Dashboard

## About
See [forum post about this fork](https://forum.irregularchat.com/t/forking-authentik-distro-for-better-community-management/647?u=sac) for more information.

While platforms like Discord and Slack are great for general communities, and tools like Matrix/Element Messenger offer self-hosting and encryption, many users are hesitant to adopt new platforms. Signal's wide adoption and default status make it an ideal starting point for community interaction.

This repo bridges the gap by providing community management tools that extend Signal's capabilities, along with integration options like:

Signal Bots: Enable interaction and updates directly through Signal.
Maubot for Matrix: Allow easy management and messaging in Matrix ecosystems.
Bridged Chats: Seamlessly connect chats across platforms.
SMTP Emails: Enable email-based communications for users.
Webhooks: Automate and streamline tasks.
NoCoDB Database Integration: Simplify community data handling and tracking.
### Aims

This project aims to retain Signal as a base platform while expanding its usability for community managers. With additional tools and integrations, this repo provides options for:

Enhanced Signal bot functionality.
Bridging chats across different platforms.
Managing community databases and communication through an accessible GUI.

### Features 
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

### Roadmap
See [ROADMAP.md](ROADMAP.md) for more information.

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

### Running Without Docker
To run the application directly on your local machine without Docker, you have two options:

#### Option 1: Local PostgreSQL
1. **Ensure PostgreSQL is installed** on your local machine
2. **Create a database** with the credentials specified in your `.env` file:
   ```bash
   createdb -U dashboarduser dashboarddb
   ```
3. **Run the local development script**:
   ```bash
   ./run_local.sh
   ```
   This script will:
   - Configure the application to connect to PostgreSQL on localhost
   - Check if PostgreSQL is running
   - Start the Streamlit application

#### Option 2: SQLite (Simplest)
If you don't want to install PostgreSQL, you can use SQLite:
1. **Run the SQLite development script**:
   ```bash
   ./run_sqlite.sh
   ```
   This script will:
   - Configure the application to use a SQLite database file (local_dev.db)
   - Start the Streamlit application

Note: Some features that rely on PostgreSQL-specific functionality may not work correctly in SQLite mode.

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

Contributions are welcome! 
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
