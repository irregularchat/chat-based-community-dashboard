# Docker Setup for Enhanced User Management System

This guide explains how to run the Community Dashboard with the enhanced React/AG Grid user management system using Docker.

## 🐳 Docker Architecture

The updated Docker setup runs multiple services in a single container:
- **Streamlit App** (Internal Port 8503) - Main dashboard application
- **Flask API Server** (Internal Port 5001) - Enhanced user management API
- **Supervisor** - Process manager to run both services

## 📋 Prerequisites

1. Docker and Docker Compose installed
2. `.env` file configured with your settings

## 🚀 Quick Start

1. **Configure Environment Variables**

Add these to your `.env` file:
```env
# Enhanced User Management
API_SECRET_KEY=your-secure-api-key-here
USE_REACT_FRONTEND=false  # Set to true to enable React UI by default

# Port Configuration (optional - only for external access)
PORT=8503           # External port for Streamlit (defaults to 8503)
API_PORT=5001       # External port for Flask API (defaults to 5001)
POSTGRES_PORT=5436  # External port for PostgreSQL (defaults to 5436)
```

2. **Build and Run**

```bash
# Build the Docker image
docker-compose build

# Start the services
docker-compose up -d

# View logs
docker-compose logs -f
```

3. **Access the Application**

- Main Dashboard: http://localhost:8503 (or your configured PORT)
- Flask API: http://localhost:5001 (or your configured API_PORT)

## 🔧 Configuration

### Port Configuration Explained

The Docker setup uses a **fixed internal port** + **configurable external port** strategy:

#### Internal Ports (Fixed)
These ports are used INSIDE the Docker container and never change:
- Streamlit: **8503**
- Flask API: **5001**
- PostgreSQL: **5432**

#### External Ports (Configurable)
These ports are used to access services from your host machine:
- Streamlit: `${PORT:-8503}` (defaults to 8503, configurable via PORT env var)
- Flask API: `${API_PORT:-5001}` (defaults to 5001, configurable via API_PORT env var)
- PostgreSQL: `${POSTGRES_PORT:-5436}` (defaults to 5436, configurable via POSTGRES_PORT env var)

#### Why This Matters
- Services inside Docker always communicate on fixed internal ports
- You can change external ports without breaking internal communication
- Example: Set `PORT=8080` to access Streamlit on http://localhost:8080 while it still runs on 8503 internally

### Environment Variables

| Variable | Description | Default | Type |
|----------|-------------|---------|------|
| `PORT` | External port for Streamlit access | 8503 | External |
| `API_PORT` | External port for Flask API access | 5001 | External |
| `API_SECRET_KEY` | API authentication key | default-docker-api-key | Internal |
| `USE_REACT_FRONTEND` | Enable React UI by default | false | Internal |
| `POSTGRES_DB` | Database name | dashboarddb | Internal |
| `POSTGRES_USER` | Database user | postgres | Internal |
| `POSTGRES_PASSWORD` | Database password | password_for_db | Internal |
| `POSTGRES_PORT` | External port for PostgreSQL access | 5436 | External |

### Docker Compose Services

```yaml
services:
  streamlit:
    ports:
      - "${PORT:-8503}:8503"        # External:Internal
      - "${API_PORT:-5001}:5001"    # External:Internal
    
  db:
    ports:
      - "${POSTGRES_PORT:-5436}:5432"  # External:Internal
```

## 🏗️ Build Process

The Docker build process:

1. Installs Python and Node.js dependencies
2. Builds React components with webpack
3. Sets up supervisor to manage processes
4. Configures database connections
5. Runs migrations on startup

## 📁 File Structure

```
/app/
├── app/
│   ├── api/
│   │   └── users.py          # Flask API server
│   ├── static/
│   │   └── components/       # React components
│   │       ├── build/        # Built React files
│   │       └── *.jsx         # React source files
│   └── ui/
│       └── components.py     # Streamlit-React bridge
├── supervisord.conf          # Process manager config
├── entrypoint.sh            # Startup script
├── package.json             # Node.js dependencies
└── webpack.config.js        # React build config
```

## 🔍 Monitoring

### Check Service Status

```bash
# View all running services
docker-compose ps

# Check supervisor status inside container
docker-compose exec streamlit supervisorctl status

# View specific service logs
docker-compose exec streamlit tail -f /app/logs/streamlit.log
docker-compose exec streamlit tail -f /app/logs/flask_api.log
```

### Health Checks

The container includes health checks for both services:

```bash
# Manual health check (using default ports)
curl http://localhost:8503  # Streamlit
curl http://localhost:5001/api/users/health  # Flask API

# With custom ports
curl http://localhost:${PORT}  # Streamlit
curl http://localhost:${API_PORT}/api/users/health  # Flask API
```

## 🛠️ Troubleshooting

### Services Not Starting

1. Check supervisor logs:
```bash
docker-compose exec streamlit cat /app/logs/supervisord.log
```

2. Verify port availability:
```bash
# Check if ports are already in use
lsof -i :${PORT:-8503} -i :${API_PORT:-5001}
```

3. Check internal service status:
```bash
# Services should always be listening on their internal ports
docker-compose exec streamlit netstat -tlnp | grep -E "8503|5001"
```

### React Components Not Loading

1. Check if React build completed:
```bash
docker-compose exec streamlit ls -la /app/app/static/components/build/
```

2. Rebuild if necessary:
```bash
docker-compose exec streamlit npm run build
```

### Database Connection Issues

1. Verify database is running:
```bash
docker-compose exec db pg_isready
```

2. Check connection from app container:
```bash
docker-compose exec streamlit psql -h db -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;"
```

## 📈 Performance Tuning

### Production Optimizations

1. **Disable Debug Mode**:
```env
DEBUG=false
```

2. **Increase Worker Processes** (supervisord.conf):
```ini
[program:flask_api]
numprocs=2  # Run multiple API workers
```

3. **Enable React Production Build**:
The Docker build automatically creates optimized production builds.

### Resource Limits

Add to docker-compose.yml:
```yaml
services:
  streamlit:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
```

## 🔄 Development Workflow

### Hot Reload for Development

1. Mount source code:
```yaml
volumes:
  - ./app:/app/app  # Mount app code
  - ./package.json:/app/package.json
```

2. Run in development mode:
```bash
docker-compose exec streamlit supervisorctl restart flask_api
```

### Updating React Components

```bash
# Inside container
docker-compose exec streamlit bash
cd /app
npm run build

# Or from outside
docker-compose exec streamlit npm run build
```

## 🚢 Deployment

### Production Build

1. Create production image:
```bash
docker build -t community-dashboard:latest .
```

2. Run with production settings:
```bash
docker run -d \
  -p 80:8503 \
  -p 5001:5001 \
  -e USE_REACT_FRONTEND=true \
  -e API_SECRET_KEY=production-secret-key \
  -v $(pwd)/.env:/app/.env \
  community-dashboard:latest
```

Note: In production, you might want to expose Streamlit on port 80 (external) while it still runs on 8503 (internal).

### Docker Hub

```bash
# Tag and push
docker tag community-dashboard:latest yourusername/community-dashboard:latest
docker push yourusername/community-dashboard:latest
```

## 🔒 Security Considerations

1. **Change Default API Key**:
Always set a secure `API_SECRET_KEY` in production.

2. **Network Isolation**:
Consider using Docker networks to isolate services:
```yaml
networks:
  frontend:
  backend:
```

3. **HTTPS in Production**:
Use a reverse proxy (nginx, traefik) for SSL termination.

## 📝 Notes

- Internal ports (8503, 5001) are fixed and used for container-to-container communication
- External ports can be customized via environment variables
- Supervisor ensures both services restart if they crash
- React components are built during the Docker image build process
- Database migrations run automatically on container startup

For more details on the enhanced user management features, see [README_Enhanced_User_Management.md](README_Enhanced_User_Management.md) 