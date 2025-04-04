from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.utils.config import Config
import os
import re
import logging

# Set up logging
logger = logging.getLogger(__name__)

# Create the declarative base
Base = declarative_base()

def parse_database_url(url):
    """
    Parse a PostgreSQL database URL into its components.
    Returns a dictionary with host, port, user, password, dbname.
    """
    result = {}
    
    # Extract hostname
    host_match = re.search(r'@([^:/]+)[:/]', url)
    result['host'] = host_match.group(1) if host_match else None
    
    # Extract port
    port_match = re.search(r'@[^:]+:(\d+)', url)
    result['port'] = port_match.group(1) if port_match else '5432'
    
    # Extract username
    user_match = re.search(r'://([^:]+):', url)
    result['user'] = user_match.group(1) if user_match else None
    
    # Extract password (careful with logging this)
    pass_match = re.search(r'://[^:]+:([^@]+)@', url)
    result['password'] = pass_match.group(1) if pass_match else None
    
    # Extract database name
    db_match = re.search(r'[:/]([^:/]+)$', url)
    result['dbname'] = db_match.group(1) if db_match else None
    
    return result

# Force Docker mode if DB_HOST is set to 'db'
if os.getenv("DB_HOST") == "db":
    os.environ["IN_DOCKER"] = "true"
    logger.info("Docker mode detected via DB_HOST")

# Determine which database connection to use
if os.getenv("TESTING"):
    # Use SQLite for testing
    DATABASE_URL = "sqlite:///:memory:"
    logger.info("Using in-memory SQLite database for testing")
elif os.getenv("SQLITE_DEV"):
    # Use SQLite for easier local development without requiring PostgreSQL
    DATABASE_URL = "sqlite:///local_dev.db"
    logger.info("Using SQLite database for local development")
elif os.getenv("LOCAL_DEV"):
    # For local development without Docker, replace 'db' with 'localhost'
    # and use the specified port in the environment
    postgres_port = os.getenv("POSTGRES_PORT", "5432")
    postgres_user = os.getenv("POSTGRES_USER", "dashboarduser")
    postgres_password = os.getenv("POSTGRES_PASSWORD", "password_for_db")
    postgres_db = os.getenv("POSTGRES_DB", "dashboarddb")
    DATABASE_URL = f"postgresql://{postgres_user}:{postgres_password}@localhost:{postgres_port}/{postgres_db}"
    logger.info(f"Using local PostgreSQL database at localhost:{postgres_port}")
elif os.getenv("IN_DOCKER", "").lower() == "true" or os.getenv("DB_HOST") == "db":
    # We're running in Docker, ensure we use the Docker service name
    postgres_user = os.getenv("POSTGRES_USER", "dashboarduser")
    postgres_password = os.getenv("POSTGRES_PASSWORD", "password_for_db")
    postgres_db = os.getenv("POSTGRES_DB", "dashboarddb")
    postgres_port = os.getenv("POSTGRES_PORT", "5432")
    db_host = os.getenv("DB_HOST", "db")  # Use DB_HOST or default to 'db'
    # In Docker, the host should be the service name from docker-compose.yml
    DATABASE_URL = f"postgresql://{postgres_user}:{postgres_password}@{db_host}:{postgres_port}/{postgres_db}"
    logger.info(f"Running in Docker environment, using database at {db_host}:{postgres_port}")
else:
    # Check if DATABASE_URL is already specified in the environment or config
    env_db_url = os.getenv("DATABASE_URL")
    config_db_url = Config.DATABASE_URL if hasattr(Config, 'DATABASE_URL') else None
    
    # Auto-detect if we're trying to use 'db' as host but not in Docker - fall back to SQLite
    auto_use_sqlite = False
    if env_db_url and "db" in env_db_url and os.getenv("IN_DOCKER", "").lower() != "true":
        logger.warning("Detected 'db' hostname in DATABASE_URL but not running in Docker. Falling back to SQLite.")
        auto_use_sqlite = True
    elif config_db_url and "db" in config_db_url and os.getenv("IN_DOCKER", "").lower() != "true":
        logger.warning("Detected 'db' hostname in Config.DATABASE_URL but not running in Docker. Falling back to SQLite.")
        auto_use_sqlite = True
    
    if auto_use_sqlite:
        # Automatically use SQLite if we detect a Docker configuration being used outside Docker
        DATABASE_URL = "sqlite:///local_dev.db"
        logger.info("Automatically switched to SQLite database for local development")
    elif env_db_url:
        DATABASE_URL = env_db_url
        # Parse and validate the URL
        try:
            components = parse_database_url(DATABASE_URL)
            if all([components['host'], components['dbname'], components['user']]):
                logger.info(f"Using valid DATABASE_URL from environment: {components['user']}:****@{components['host']}:{components['port']}/{components['dbname']}")
            else:
                logger.warning(f"DATABASE_URL from environment may be malformed: {DATABASE_URL.split('@')[0].split(':')[0]}:****@{DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'unknown'}")
        except Exception as e:
            logger.warning(f"Error parsing DATABASE_URL: {str(e)}")
    elif config_db_url:
        DATABASE_URL = config_db_url
        logger.info("Using DATABASE_URL from Config")
    else:
        # Fallback if DATABASE_URL is not set in Config or environment
        postgres_user = os.getenv("POSTGRES_USER", "dashboarduser")
        postgres_password = os.getenv("POSTGRES_PASSWORD", "password_for_db")
        postgres_db = os.getenv("POSTGRES_DB", "dashboarddb")
        postgres_host = os.getenv("DB_HOST", "localhost")  # Default to localhost as last resort
        postgres_port = os.getenv("POSTGRES_PORT", "5432")
        DATABASE_URL = f"postgresql://{postgres_user}:{postgres_password}@{postgres_host}:{postgres_port}/{postgres_db}"
        logger.info(f"Constructed DATABASE_URL using environment variables: {postgres_user}:****@{postgres_host}:{postgres_port}/{postgres_db}")

# Log a masked version of the final URL for security
try:
    if DATABASE_URL.startswith('postgresql://'):
        # Extract parts of the URL for masking
        user_part = DATABASE_URL.split('@')[0]
        if ':' in user_part:
            masked_user_part = user_part.split(':')[0] + ':****'
        else:
            masked_user_part = user_part
        
        host_part = DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL
        logger.info(f"Final DATABASE_URL being used: {masked_user_part}@{host_part}")
    else:
        # For SQLite or other database types, no need to mask
        logger.info(f"Final DATABASE_URL being used: {DATABASE_URL}")
except Exception as e:
    logger.warning(f"Error masking DATABASE_URL for logging: {str(e)}")
    logger.info(f"Database URL type: {type(DATABASE_URL)}")

# Additional connection arguments for PostgreSQL
connect_args = {}
if DATABASE_URL.startswith("postgresql"):
    # Define additional connection arguments for PostgreSQL
    connect_args = {
        "connect_timeout": 10,  # Connection timeout in seconds
        "client_encoding": "utf8"
    }
    
    # Check if we're in Docker and this is a 'db' host
    if os.getenv("IN_DOCKER") == "true" and "db" in DATABASE_URL:
        # Add application_name for better visibility in PostgreSQL logs
        connect_args["application_name"] = "streamlit_docker_app"

try:
    # Create engine with connection pooling settings
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,  # Enable connection health checks
        pool_recycle=3600,   # Recycle connections after 1 hour
        connect_args=connect_args
    )
    
    # Log success
    logger.info(f"Successfully created database engine")
except Exception as e:
    logger.error(f"Error creating database engine: {str(e)}")
    # Fallback to SQLite if there's an error with the primary database
    logger.warning("Falling back to SQLite database due to connection error")
    DATABASE_URL = "sqlite:///fallback.db"
    engine = create_engine(DATABASE_URL)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """
    Get a database session. This function is used as a dependency in FastAPI.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Only create tables if not in test mode
# Moving this part out so it doesn't execute on import during tests
if not os.getenv("TESTING"):
    try:
        # Import models only needed for table creation, not during testing
        from app.db.models import *  # Import models to ensure they're registered
        Base.metadata.create_all(bind=engine)
        logger.info("Successfully created database tables")
    except Exception as e:
        logger.error(f"Error creating database tables: {str(e)}") 