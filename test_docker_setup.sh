#!/bin/bash

echo "Testing Enhanced User Management Docker Setup"
echo "============================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if docker and docker-compose are installed
echo -n "Checking Docker installation... "
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    docker --version
else
    echo -e "${RED}✗${NC}"
    echo "Docker is not installed. Please install Docker first."
    exit 1
fi

echo -n "Checking Docker Compose installation... "
if command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    docker-compose --version
else
    echo -e "${RED}✗${NC}"
    echo "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
echo -n "Checking .env file... "
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC}"
    
    # Check for required new variables
    echo "Checking Enhanced User Management variables:"
    
    if grep -q "API_SECRET_KEY" .env; then
        echo -e "  API_SECRET_KEY: ${GREEN}✓${NC}"
    else
        echo -e "  API_SECRET_KEY: ${YELLOW}⚠${NC} (will use default)"
        echo "    Add to .env: API_SECRET_KEY=your-secure-api-key"
    fi
    
    if grep -q "USE_REACT_FRONTEND" .env; then
        echo -e "  USE_REACT_FRONTEND: ${GREEN}✓${NC}"
    else
        echo -e "  USE_REACT_FRONTEND: ${YELLOW}⚠${NC} (will default to false)"
        echo "    Add to .env: USE_REACT_FRONTEND=true"
    fi
else
    echo -e "${RED}✗${NC}"
    echo "No .env file found. Please create one based on .env.example"
    exit 1
fi

# Build the Docker image
echo ""
echo "Building Docker image..."
docker-compose build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Docker image built successfully${NC}"
else
    echo -e "${RED}✗ Failed to build Docker image${NC}"
    exit 1
fi

# Start services
echo ""
echo "Starting services..."
docker-compose up -d

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Services started successfully${NC}"
else
    echo -e "${RED}✗ Failed to start services${NC}"
    exit 1
fi

# Wait for services to be ready
echo ""
echo "Waiting for services to be ready..."
sleep 10

# Check service health
echo ""
echo "Checking service health:"

# Get configured external ports
EXTERNAL_PORT=${PORT:-8503}
EXTERNAL_API_PORT=${API_PORT:-5001}

# Check Streamlit
echo -n "  Streamlit (external port $EXTERNAL_PORT -> internal 8503): "
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$EXTERNAL_PORT | grep -q "200\|302"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "    Check logs: docker-compose logs streamlit"
fi

# Check Flask API
echo -n "  Flask API (external port $EXTERNAL_API_PORT -> internal 5001): "
if curl -s -o /dev/null -w "%{http_code}" http://localhost:$EXTERNAL_API_PORT/api/users/health | grep -q "200"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "    Check logs: docker-compose exec streamlit tail -f /app/logs/flask_api.log"
fi

# Check PostgreSQL
echo -n "  PostgreSQL database: "
if docker-compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "    Check logs: docker-compose logs db"
fi

# Check supervisord
echo ""
echo "Checking process manager:"
docker-compose exec streamlit supervisorctl status

# Show port configuration
echo ""
echo "Port Configuration:"
echo "  Internal Ports (fixed inside container):"
echo "    - Streamlit: 8503"
echo "    - Flask API: 5001"
echo "    - PostgreSQL: 5432"
echo ""
echo "  External Ports (configurable via .env):"
echo "    - Streamlit: $EXTERNAL_PORT (PORT=${PORT:-8503})"
echo "    - Flask API: $EXTERNAL_API_PORT (API_PORT=${API_PORT:-5001})"
echo "    - PostgreSQL: ${POSTGRES_PORT:-5436}"

# Show useful commands
echo ""
echo "Useful commands:"
echo "  View all logs:        docker-compose logs -f"
echo "  View Streamlit logs:  docker-compose exec streamlit tail -f /app/logs/streamlit.log"
echo "  View API logs:        docker-compose exec streamlit tail -f /app/logs/flask_api.log"
echo "  Restart API:          docker-compose exec streamlit supervisorctl restart flask_api"
echo "  Shell access:         docker-compose exec streamlit bash"
echo "  Stop services:        docker-compose down"

echo ""
echo "Access the application at:"
echo "  Main Dashboard: http://localhost:$EXTERNAL_PORT"
echo "  API Health:     http://localhost:$EXTERNAL_API_PORT/api/users/health"

# Make script executable
chmod +x test_docker_setup.sh 