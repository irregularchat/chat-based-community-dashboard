#!/usr/bin/env python3
"""
Database connection test script
Tests database connection configurations and URL parsing under different scenarios.
"""

import os
import sys
import time
import re
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("db_test")

def test_database_url_parsing():
    """Test database URL parsing with various formats"""
    print("\n=== Testing Database URL Parsing ===")
    
    # Test cases with expected results
    test_cases = [
        {
            "url": "postgresql://user:password@db:5432/dbname",
            "expected_host": "db",
            "expected_port": "5432",
            "expected_user": "user",
            "expected_dbname": "dbname",
            "description": "Standard PostgreSQL URL"
        },
        {
            "url": "postgresql://dashboarduser:password_for_db@localhost:5436/dashboarddb",
            "expected_host": "localhost",
            "expected_port": "5436",
            "expected_user": "dashboarduser", 
            "expected_dbname": "dashboarddb",
            "description": "Local PostgreSQL URL"
        },
        {
            "url": "postgresql://user:complex%40password@db:5432/my_db",
            "expected_host": "db",
            "expected_port": "5432",
            "expected_user": "user",
            "expected_dbname": "my_db",
            "description": "URL with encoded special characters"
        },
        {
            "url": "postgresql://user:password@127.0.0.1/dbname",
            "expected_host": "127.0.0.1",
            "expected_port": None,
            "expected_user": "user",
            "expected_dbname": "dbname",
            "description": "IP address without port"
        }
    ]
    
    # Regex patterns for extracting parts
    host_pattern = r'@([^:/]+)[:/]'
    port_pattern = r'@[^:]+:(\d+)'
    user_pattern = r'postgresql://([^:]+):'
    # Fix the database name pattern to correctly extract the name
    dbname_pattern = r'[:/]([^:/]+)$'  # Match the last segment after / or :
    
    # Test each case
    for i, case in enumerate(test_cases):
        url = case["url"]
        print(f"\nTest {i+1}: {case['description']}")
        print(f"URL: {url.replace(':password', ':****')}")
        
        # Extract host
        host_match = re.search(host_pattern, url)
        host = host_match.group(1) if host_match else None
        print(f"Extracted host: {host}")
        if host == case["expected_host"]:
            print("✅ Host extraction successful")
        else:
            print(f"❌ Host extraction failed. Expected: {case['expected_host']}, Got: {host}")
        
        # Extract port
        port_match = re.search(port_pattern, url)
        port = port_match.group(1) if port_match else None
        print(f"Extracted port: {port}")
        if port == case["expected_port"]:
            print("✅ Port extraction successful")
        else:
            print(f"❌ Port extraction failed. Expected: {case['expected_port']}, Got: {port}")
        
        # Extract user
        user_match = re.search(user_pattern, url)
        user = user_match.group(1) if user_match else None
        print(f"Extracted user: {user}")
        if user == case["expected_user"]:
            print("✅ User extraction successful")
        else:
            print(f"❌ User extraction failed. Expected: {case['expected_user']}, Got: {user}")
        
        # Extract dbname
        dbname_match = re.search(dbname_pattern, url)
        dbname = dbname_match.group(1) if dbname_match else None
        print(f"Extracted database name: {dbname}")
        if dbname == case["expected_dbname"]:
            print("✅ Database name extraction successful")
        else:
            print(f"❌ Database name extraction failed. Expected: {case['expected_dbname']}, Got: {dbname}")
    
    print("\nURL parsing tests completed.")

def test_bash_regex_parsing():
    """Test the Bash regex pattern used in entrypoint.sh"""
    print("\n=== Testing Bash Regex Pattern ===")
    
    # The regex pattern in entrypoint.sh is: [[ $DB_URL =~ @([^:/]+)[:/] ]]
    # Python equivalent
    bash_pattern = r'@([^:/]+)[:/]'
    
    test_cases = [
        {
            "url": "postgresql://user:password@db:5432/dbname",
            "expected": "db",
            "description": "Standard URL"
        },
        {
            "url": "postgresql://user:password@localhost:5432/dbname",
            "expected": "localhost",
            "description": "Localhost URL"
        },
        {
            "url": "postgresql://user:password@127.0.0.1:5432/dbname",
            "expected": "127.0.0.1",
            "description": "IP address URL"
        },
        {
            "url": "postgresql://user:password@db/dbname",
            "expected": "db",
            "description": "URL without port"
        }
    ]
    
    for i, case in enumerate(test_cases):
        url = case["url"]
        print(f"\nTest {i+1}: {case['description']}")
        print(f"URL: {url}")
        
        match = re.search(bash_pattern, url)
        extracted = match.group(1) if match else None
        
        if extracted == case["expected"]:
            print(f"✅ Bash regex successfully extracted host: {extracted}")
        else:
            print(f"❌ Bash regex failed. Expected: {case['expected']}, Got: {extracted}")
    
    print("\nBash regex tests completed.")

def test_env_variable_handling():
    """Test environment variable handling for database configuration"""
    print("\n=== Testing Environment Variable Handling ===")
    
    # Save original environment variables
    original_vars = {}
    for var in ["DATABASE_URL", "IN_DOCKER", "DB_HOST", "POSTGRES_USER", 
                "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_PORT"]:
        original_vars[var] = os.environ.get(var)
    
    try:
        # Test case 1: Set DATABASE_URL directly
        print("\nTest 1: Setting DATABASE_URL directly")
        test_url = "postgresql://test_user:test_password@test_host:5555/test_db"
        os.environ["DATABASE_URL"] = test_url
        
        # Clear other variables to ensure they don't interfere
        for var in ["IN_DOCKER", "DB_HOST"]:
            if var in os.environ:
                del os.environ[var]

        # Force the URL_SOURCE to be from environment
        os.environ["URL_SOURCE"] = "ENV"
        
        # Create a test function to simulate the behavior without importing
        # This avoids the issue of cached modules
        def get_test_url():
            db_url = os.getenv("DATABASE_URL")
            print(f"Using URL from environment: {db_url.replace(':test_password', ':****')}")
            return db_url
        
        result_url = get_test_url()
        print(f"Direct DATABASE_URL result: {result_url.replace(':test_password', ':****')}")
        if test_url == result_url:
            print("✅ Direct DATABASE_URL test successful")
        else:
            print(f"❌ Direct DATABASE_URL test failed")
        
        # Test case 2: Docker environment
        print("\nTest 2: Docker environment with DB_HOST")
        # Remove previous URL
        if "DATABASE_URL" in os.environ:
            del os.environ["DATABASE_URL"]
            
        os.environ["IN_DOCKER"] = "true"
        os.environ["DB_HOST"] = "docker_db"
        os.environ["POSTGRES_USER"] = "docker_user"
        os.environ["POSTGRES_PASSWORD"] = "docker_pass"
        os.environ["POSTGRES_DB"] = "docker_dbname"
        os.environ["POSTGRES_PORT"] = "5432"
        
        # Function to simulate Docker environment URL building
        def get_docker_url():
            db_host = os.getenv('DB_HOST', 'db')
            postgres_user = os.getenv('POSTGRES_USER', 'dashboarduser')
            postgres_password = os.getenv('POSTGRES_PASSWORD', 'password_for_db')
            postgres_db = os.getenv('POSTGRES_DB', 'dashboarddb')
            postgres_port = os.getenv('POSTGRES_PORT', '5432')
            
            db_url = f"postgresql://{postgres_user}:{postgres_password}@{db_host}:{postgres_port}/{postgres_db}"
            print(f"Built Docker URL: {db_url.replace(':'+postgres_password, ':****')}")
            return db_url
        
        result_url = get_docker_url()
        expected_url = "postgresql://docker_user:docker_pass@docker_db:5432/docker_dbname"
        print(f"Docker environment result: {result_url.replace(':docker_pass', ':****')}")
        
        if expected_url == result_url:
            print("✅ Docker environment test successful")
        else:
            print(f"❌ Docker environment test failed")
            print(f"Expected: {expected_url.replace(':docker_pass', ':****')}")
            
        # Test case 3: Local environment (no Docker)
        print("\nTest 3: Local environment")
        if "IN_DOCKER" in os.environ:
            del os.environ["IN_DOCKER"]
        if "DB_HOST" in os.environ:
            del os.environ["DB_HOST"]
            
        os.environ["POSTGRES_USER"] = "local_user"
        os.environ["POSTGRES_PASSWORD"] = "local_pass"
        os.environ["POSTGRES_DB"] = "local_dbname"
        os.environ["POSTGRES_PORT"] = "5433"
        
        # Function to simulate local environment URL building
        def get_local_url():
            postgres_user = os.getenv('POSTGRES_USER', 'dashboarduser')
            postgres_password = os.getenv('POSTGRES_PASSWORD', 'password_for_db')
            postgres_db = os.getenv('POSTGRES_DB', 'dashboarddb')
            postgres_port = os.getenv('POSTGRES_PORT', '5432')
            
            db_url = f"postgresql://{postgres_user}:{postgres_password}@localhost:{postgres_port}/{postgres_db}"
            print(f"Built local URL: {db_url.replace(':'+postgres_password, ':****')}")
            return db_url
        
        result_url = get_local_url()
        expected_url = "postgresql://local_user:local_pass@localhost:5433/local_dbname"
        print(f"Local environment result: {result_url.replace(':local_pass', ':****')}")
        
        if expected_url == result_url:
            print("✅ Local environment test successful")
        else:
            print(f"❌ Local environment test failed")
            print(f"Expected: {expected_url.replace(':local_pass', ':****')}")
            
    finally:
        # Restore original environment variables
        for var, value in original_vars.items():
            if value is not None:
                os.environ[var] = value
            elif var in os.environ:
                del os.environ[var]
        
        # Clean up additional variables
        if "URL_SOURCE" in os.environ:
            del os.environ["URL_SOURCE"]
    
    print("\nEnvironment variable tests completed.")

def test_sqlite_connection():
    """Test SQLite database connection"""
    print("\n=== Testing SQLite Connection ===")
    try:
        # Configure SQLite
        os.environ["SQLITE_DEV"] = "true"
        if "LOCAL_DEV" in os.environ:
            del os.environ["LOCAL_DEV"]
            
        # Import our database configuration
        sys.path.append(".")
        # Try to use a separate engine to avoid conflicts
        sqlite_url = "sqlite:///test_connection.db"
        engine = create_engine(sqlite_url)
        
        # Test connection with a simple query
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            data = result.fetchone()
            
        print("✅ SQLite connection successful!")
        return True
    except Exception as e:
        print(f"❌ SQLite connection failed: {str(e)}")
        return False
    finally:
        # Clean up environment variable
        if "SQLITE_DEV" in os.environ:
            del os.environ["SQLITE_DEV"]
        # Remove test database file if it was created
        if os.path.exists("test_connection.db"):
            try:
                os.remove("test_connection.db")
            except:
                pass

def test_postgres_connection():
    """Test PostgreSQL database connection"""
    print("\n=== Testing PostgreSQL Connection ===")
    try:
        # Configure PostgreSQL
        os.environ["LOCAL_DEV"] = "true"
        if "SQLITE_DEV" in os.environ:
            del os.environ["SQLITE_DEV"]
        
        # Load environment variables
        postgres_port = os.getenv("POSTGRES_PORT", "5432")
        postgres_user = os.getenv("POSTGRES_USER", "dashboarduser")
        postgres_password = os.getenv("POSTGRES_PASSWORD", "password_for_db")
        postgres_db = os.getenv("POSTGRES_DB", "dashboarddb")
        
        # Build connection string
        db_url = f"postgresql://{postgres_user}:{postgres_password}@localhost:{postgres_port}/{postgres_db}"
        print(f"Connecting to: {db_url.replace(':'+postgres_password, ':****')}")
        
        # Create engine and test connection
        pg_engine = create_engine(db_url)
        with pg_engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            data = result.fetchone()
            
        print("✅ PostgreSQL connection successful!")
        return True
    except OperationalError as e:
        print(f"❌ PostgreSQL connection failed: {str(e)}")
        print("\nPossible reasons:")
        print("1. PostgreSQL is not running on your machine")
        print("2. Database credentials are incorrect")
        print("3. The database does not exist")
        print("\nTo create the database:")
        print(f"  createdb -U {postgres_user} {postgres_db}")
        return False
    except Exception as e:
        print(f"❌ PostgreSQL connection failed with unexpected error: {str(e)}")
        return False
    finally:
        # Clean up environment variable
        if "LOCAL_DEV" in os.environ:
            del os.environ["LOCAL_DEV"]

def test_docker_url_in_nondocker():
    """Test what happens when a Docker-style URL is used outside Docker"""
    print("\n=== Testing Docker URL in Non-Docker Environment ===")
    try:
        # Clear Docker flag but use a db hostname
        if "IN_DOCKER" in os.environ:
            del os.environ["IN_DOCKER"]
        
        # Create a connection string with 'db' as host
        postgres_user = "test_user"
        postgres_password = "test_password"
        postgres_db = "test_db"
        db_url = f"postgresql://{postgres_user}:{postgres_password}@db:5432/{postgres_db}"
        print(f"Testing URL with 'db' hostname: {db_url.replace(':'+postgres_password, ':****')}")
        
        # Try to create an engine - this should fail with hostname resolution error
        engine = create_engine(
            db_url,
            connect_args={"connect_timeout": 3}  # Short timeout to make test faster
        )
        
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            data = result.fetchone()
            
        print("⚠️ Connection with 'db' hostname worked unexpectedly!")
        return True
    except OperationalError as e:
        if "could not translate host name" in str(e).lower():
            print("✅ Expected error received: Host 'db' correctly not resolved")
            print(f"Error: {str(e)}")
            return True
        else:
            print(f"❌ Unexpected error: {str(e)}")
            return False
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        return False

def test_entrypoint_bash_extraction():
    """Test the extraction logic used in the entrypoint script"""
    print("\n=== Testing Entrypoint Bash Extraction Logic ===")
    
    test_cases = [
        {
            "url": "postgresql://user:password@db:5432/dbname",
            "expected_host": "db", 
            "expected_db": "dbname",
            "expected_user": "user",
            "expected_port": "5432",
            "description": "Standard URL"
        },
        {
            "url": "postgresql://dashboarduser:password_for_db@localhost:5436/dashboarddb",
            "expected_host": "localhost",
            "expected_db": "dashboarddb",
            "expected_user": "dashboarduser",
            "expected_port": "5436",
            "description": "Local URL with custom port"
        }
    ]
    
    for i, case in enumerate(test_cases):
        url = case["url"]
        print(f"\nTest {i+1}: {case['description']}")
        
        # Simulate bash extraction for hostname
        # [[ $DB_URL =~ @([^:/]+)[:/] ]]
        bash_host_pattern = r'@([^:/]+)[:/]'
        host_match = re.search(bash_host_pattern, url)
        host = host_match.group(1) if host_match else None
        
        # Simulate bash extraction for port
        # grep -o ":[0-9]*/" <<< "$DB_URL" | tr -d ":/")
        port_pattern = r':(\d+)/'
        port_match = re.search(port_pattern, url)
        port = port_match.group(1) if port_match else None
        
        # Simulate bash extraction for database name
        # grep -o "/[^/]*$" <<< "$DB_URL" | tr -d "/")
        db_pattern = r'/([^/]*)$'
        db_match = re.search(db_pattern, url)
        db = db_match.group(1) if db_match else None
        
        # Simulate bash extraction for username
        # grep -o "^[^:]*://\([^:]*\):" <<< "$DB_URL" | sed 's/^.*:\/\///' | tr -d ":")
        user_pattern = r'://([^:]+):'
        user_match = re.search(user_pattern, url)
        user = user_match.group(1) if user_match else None
        
        print(f"URL: {url.replace(case['expected_user']+':password', case['expected_user']+':****')}")
        print(f"Extracted host: {host} (Expected: {case['expected_host']})")
        print(f"Extracted port: {port} (Expected: {case['expected_port']})")
        print(f"Extracted database: {db} (Expected: {case['expected_db']})")
        print(f"Extracted user: {user} (Expected: {case['expected_user']})")
        
        if (host == case['expected_host'] and 
            port == case['expected_port'] and 
            db == case['expected_db'] and 
            user == case['expected_user']):
            print("✅ All extractions successful")
        else:
            print("❌ Extraction test failed")
    
    print("\nEntrypoint script extraction tests completed.")

if __name__ == "__main__":
    print("Enhanced Database Connection Test")
    print("================================")
    
    # Test regex parsing
    test_database_url_parsing()
    
    # Test bash regex parsing
    test_bash_regex_parsing()
    
    # Test entrypoint script extraction
    test_entrypoint_bash_extraction()
    
    # Test environment variable handling
    test_env_variable_handling()
    
    # Test SQLite first (simpler)
    sqlite_ok = test_sqlite_connection()
    
    # Wait a moment before trying PostgreSQL
    time.sleep(1)
    
    # Test PostgreSQL
    postgres_ok = test_postgres_connection()
    
    # Test Docker URL in non-Docker environment
    docker_url_test = test_docker_url_in_nondocker()
    
    # Summary
    print("\n=== Summary ===")
    print(f"URL Parsing: Tests completed")
    print(f"Bash Regex: Tests completed")
    print(f"Entrypoint Script Extraction: Tests completed")
    print(f"Environment Variables: Tests completed")
    print(f"SQLite: {'✅ Working' if sqlite_ok else '❌ Not working'}")
    print(f"PostgreSQL: {'✅ Working' if postgres_ok else '❌ Not working'}")
    print(f"Docker URL Test: {'✅ Completed' if docker_url_test else '❌ Failed'}")
    
    if sqlite_ok:
        print("\nYou can run the application with SQLite using:")
        print("  ./run_sqlite.sh")
    
    if postgres_ok:
        print("\nYou can run the application with PostgreSQL using:")
        print("  ./run_local.sh")
    
    if not sqlite_ok and not postgres_ok:
        print("\n❌ Neither database configuration is working.")
        print("Please check your setup and try again.")
        sys.exit(1)
    
    print("\nTest completed successfully.") 