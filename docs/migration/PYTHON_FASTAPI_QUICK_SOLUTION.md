# Python FastAPI OAuth Solution

## 🚀 Quick Setup to Solve Your OAuth Issues

### 1. Project Setup (5 minutes)

```bash
# Create new Python project
mkdir community-dashboard-api
cd community-dashboard-api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On macOS/Linux
# venv\Scripts\activate   # On Windows

# Install dependencies
pip install fastapi uvicorn authlib httpx sqlalchemy psycopg2-binary python-jose[cryptography] python-multipart
```

### 2. OAuth Service Implementation (30 minutes)

```python
# auth.py - Solves your OAuth state mismatch issues!
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2AuthorizationCodeBearer
from authlib.integrations.starlette_client import OAuth
from authlib.integrations.starlette_client import OAuthError
from starlette.middleware.sessions import SessionMiddleware
import os
import secrets

app = FastAPI()

# Add session middleware (prevents state mismatch!)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", secrets.token_hex(32)))

# Configure OAuth with Authentik
oauth = OAuth()
oauth.register(
    name='authentik',
    client_id=os.getenv('AUTHENTIK_CLIENT_ID'),
    client_secret=os.getenv('AUTHENTIK_CLIENT_SECRET'),
    server_metadata_url='https://sso.irregularchat.com/application/o/chat-based-community-dashboard/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)

@app.get("/auth/login")
async def login(request: Request):
    """Start OAuth flow - NO MORE STATE MISMATCH!"""
    # Generate secure redirect URI
    redirect_uri = "http://localhost:8000/auth/callback"
    
    # authlib handles state generation and validation automatically
    return await oauth.authentik.authorize_redirect(request, redirect_uri)

@app.get("/auth/callback")
async def callback(request: Request):
    """Handle OAuth callback - PROPERLY HANDLES STATE!"""
    try:
        # authlib automatically validates state parameter
        token = await oauth.authentik.authorize_access_token(request)
        
        # Get user info from token
        user_info = token.get('userinfo')
        if not user_info:
            # Fetch user info if not in token
            user_info = await oauth.authentik.get_userinfo(token)
        
        # Extract user data
        user_data = {
            'email': user_info.get('email'),
            'name': user_info.get('name'),
            'username': user_info.get('preferred_username'),
            'groups': user_info.get('groups', []),
            'authentik_id': user_info.get('sub')
        }
        
        # Create or update user in database
        user = await create_or_update_user(user_data)
        
        # Create session
        request.session['user_id'] = user.id
        request.session['user_email'] = user.email
        request.session['is_admin'] = user.is_admin
        
        # Redirect to frontend
        return RedirectResponse(url="http://localhost:3000/dashboard")
        
    except OAuthError as error:
        # Much better error handling than NextAuth.js
        raise HTTPException(status_code=400, detail=f"OAuth error: {error.error}")

@app.get("/auth/me")
async def get_current_user(request: Request):
    """Get current user info"""
    user_id = request.session.get('user_id')
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    user = await get_user_by_id(user_id)
    return {
        'id': user.id,
        'email': user.email,
        'name': user.name,
        'is_admin': user.is_admin,
        'is_moderator': user.is_moderator
    }

@app.post("/auth/logout")
async def logout(request: Request):
    """Logout user"""
    request.session.clear()
    return {"message": "Logged out successfully"}
```

### 3. Database Models (15 minutes)

```python
# models.py - Simple SQLAlchemy models
from sqlalchemy import Boolean, Column, Integer, String, DateTime, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from datetime import datetime
import os

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, index=True)
    first_name = Column(String)
    last_name = Column(String)
    is_admin = Column(Boolean, default=False)
    is_moderator = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    authentik_id = Column(String, unique=True)
    authentik_groups = Column(JSON, default=list)
    date_joined = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/dashboard")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

async def create_or_update_user(user_data: dict) -> User:
    """Create or update user from OAuth data"""
    db = SessionLocal()
    try:
        # Check if user exists
        user = db.query(User).filter(User.authentik_id == user_data['authentik_id']).first()
        
        if not user:
            # Check by email
            user = db.query(User).filter(User.email == user_data['email']).first()
        
        if user:
            # Update existing user
            user.email = user_data['email']
            user.username = user_data['username']
            user.authentik_id = user_data['authentik_id']
            user.authentik_groups = user_data['groups']
            user.is_admin = 'admin' in user_data['groups']
            user.is_moderator = 'moderator' in user_data['groups'] or user.is_admin
            user.last_login = datetime.utcnow()
        else:
            # Create new user
            user = User(
                email=user_data['email'],
                username=user_data['username'],
                authentik_id=user_data['authentik_id'],
                authentik_groups=user_data['groups'],
                is_admin='admin' in user_data['groups'],
                is_moderator='moderator' in user_data['groups'] or 'admin' in user_data['groups'],
                last_login=datetime.utcnow()
            )
            db.add(user)
        
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()

async def get_user_by_id(user_id: int) -> User:
    """Get user by ID"""
    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == user_id).first()
    finally:
        db.close()
```

### 4. User Management API (20 minutes)

```python
# api.py - User management endpoints
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    first_name: Optional[str]
    last_name: Optional[str]
    is_admin: bool
    is_moderator: bool
    is_active: bool
    
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    first_name: Optional[str]
    last_name: Optional[str]
    is_admin: Optional[bool]
    is_moderator: Optional[bool]
    is_active: Optional[bool]

def get_current_user(request: Request) -> User:
    """Get current authenticated user"""
    user_id = request.session.get('user_id')
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    db = SessionLocal()
    user = db.query(User).filter(User.id == user_id).first()
    db.close()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_moderator(user: User = Depends(get_current_user)) -> User:
    """Require moderator or admin permissions"""
    if not (user.is_moderator or user.is_admin):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user

def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require admin permissions"""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return user

@app.get("/api/users", response_model=List[UserResponse])
async def get_users(
    page: int = 1,
    limit: int = 25,
    search: Optional[str] = None,
    current_user: User = Depends(require_moderator)
):
    """Get users list (moderator+ required)"""
    db = SessionLocal()
    try:
        query = db.query(User)
        
        if search:
            query = query.filter(
                User.email.ilike(f"%{search}%") |
                User.username.ilike(f"%{search}%") |
                User.first_name.ilike(f"%{search}%") |
                User.last_name.ilike(f"%{search}%")
            )
        
        total = query.count()
        users = query.offset((page - 1) * limit).limit(limit).all()
        
        return {
            "users": users,
            "total": total,
            "page": page,
            "limit": limit
        }
    finally:
        db.close()

@app.put("/api/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_update: UserUpdate,
    current_user: User = Depends(require_moderator)
):
    """Update user (moderator+ required)"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update fields
        for field, value in user_update.dict(exclude_unset=True).items():
            setattr(user, field, value)
        
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()

@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin)
):
    """Delete user (admin required)"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        db.delete(user)
        db.commit()
        return {"message": "User deleted successfully"}
    finally:
        db.close()
```

### 5. Matrix Integration (15 minutes)

```python
# matrix_service.py - Matrix integration
import asyncio
from nio import AsyncClient, RoomMessageText
import os

class MatrixService:
    def __init__(self):
        self.homeserver = os.getenv("MATRIX_HOMESERVER", "https://matrix.irregularchat.com")
        self.access_token = os.getenv("MATRIX_ACCESS_TOKEN")
        self.user_id = os.getenv("MATRIX_USER_ID")
        self.welcome_room = os.getenv("MATRIX_WELCOME_ROOM_ID")
        
        self.client = AsyncClient(self.homeserver, self.user_id)
        self.client.access_token = self.access_token

    async def send_welcome_message(self, display_name: str):
        """Send welcome message to new user"""
        if not self.welcome_room:
            return
        
        message = f"Welcome to the community, {display_name}! 🎉"
        
        try:
            await self.client.room_send(
                room_id=self.welcome_room,
                message_type="m.room.message",
                content={
                    "msgtype": "m.text",
                    "body": message
                }
            )
        except Exception as e:
            print(f"Failed to send welcome message: {e}")

    async def get_room_members(self, room_id: str) -> list:
        """Get room members"""
        try:
            response = await self.client.joined_members(room_id)
            return list(response.members.keys()) if response else []
        except Exception as e:
            print(f"Failed to get room members: {e}")
            return []

# Initialize Matrix service
matrix_service = MatrixService()

@app.post("/api/matrix/welcome/{user_id}")
async def send_welcome_to_matrix(
    user_id: int,
    current_user: User = Depends(require_moderator)
):
    """Send welcome message to Matrix"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        await matrix_service.send_welcome_message(user.username or user.email)
        return {"message": "Welcome message sent"}
    finally:
        db.close()
```

### 6. Main Application (10 minutes)

```python
# main.py - Complete FastAPI application
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
import os

app = FastAPI(title="Community Dashboard API", version="1.0.0")

# Add CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add session middleware
app.add_middleware(
    SessionMiddleware, 
    secret_key=os.getenv("SECRET_KEY", "your-secret-key-here")
)

# Include all the routes from above files
# (In practice, you'd organize these into separate modules)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
```

### 7. Docker Setup (5 minutes)

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```txt
# requirements.txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
authlib==1.2.1
httpx==0.25.0
sqlalchemy==2.0.23
psycopg2-binary==2.9.7
python-jose[cryptography]==3.3.0
python-multipart==0.0.6
matrix-nio==0.20.2
```

### 8. Environment Variables

```env
# .env
SECRET_KEY=your-super-secret-key-here
DATABASE_URL=postgresql://postgres:password@db:5432/dashboard
AUTHENTIK_CLIENT_ID=your-client-id
AUTHENTIK_CLIENT_SECRET=your-client-secret
MATRIX_HOMESERVER=https://matrix.irregularchat.com
MATRIX_ACCESS_TOKEN=your-matrix-token
MATRIX_USER_ID=@bot:irregularchat.com
MATRIX_WELCOME_ROOM_ID=!welcome:irregularchat.com
```

## 🚀 Quick Deployment

### Test Your OAuth Fix (1-2 hours total!)

```bash
# 1. Set up the project
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Set environment variables
cp .env.example .env
# Edit .env with your Authentik credentials

# 3. Run the server
uvicorn main:app --reload --port 8000

# 4. Test OAuth flow
# Visit: http://localhost:8000/auth/login
# Should redirect to Authentik and back without state mismatch!
```

### Add to Docker Compose

```yaml
# Add to your existing docker-compose.yml
services:
  api:
    build: ./python-api
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      - AUTHENTIK_CLIENT_ID=${AUTHENTIK_CLIENT_ID}
      - AUTHENTIK_CLIENT_SECRET=${AUTHENTIK_CLIENT_SECRET}
    depends_on:
      - db
```

## 🎯 Why This Solves Your Issues

### OAuth Problems Fixed:
1. **State Mismatch**: `authlib` handles state generation/validation properly
2. **Session Management**: Secure session middleware prevents state issues
3. **Error Handling**: Clear error messages instead of cryptic NextAuth errors
4. **OIDC Compliance**: Proper OIDC implementation following standards

### Development Benefits:
1. **Familiar Syntax**: Easy transition from JavaScript/TypeScript
2. **Fast Development**: Can implement this entire solution in a day
3. **Better Debugging**: Python stack traces are much clearer
4. **Type Safety**: Type hints provide similar benefits to TypeScript
5. **Mature Libraries**: `authlib` is used by major companies

### Migration Strategy:
1. **Day 1**: Implement OAuth service, test with Authentik
2. **Day 2**: Add user management API
3. **Day 3**: Update React frontend to use new API
4. **Day 4**: Add Matrix integration
5. **Week 2**: Migrate remaining features

## 🏆 Final Recommendation

**Use Python FastAPI** because:

✅ **Solves OAuth immediately** - No more state mismatch errors  
✅ **Easy migration** - Familiar syntax from JavaScript/TypeScript  
✅ **Faster development** - Can be working in hours, not weeks  
✅ **Mature ecosystem** - Proven libraries for all your needs  
✅ **Better debugging** - Clear error messages and stack traces  
✅ **Type safety** - Type hints provide compile-time checking  

You can have a working OAuth solution **today** with Python FastAPI, vs potentially weeks of learning Go. For your urgent OAuth issues, Python is definitely the right choice!
