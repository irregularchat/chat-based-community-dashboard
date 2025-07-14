# Developer Onboarding Guide

> **Welcome to the Chat-Based Community Dashboard project!** This guide will get you up and running in 15 minutes.

## Quick Overview

**What we're building**: A web dashboard that makes community management simple for non-technical organizers while providing powerful tools for developers.

**Tech stack**: Python + Streamlit + SQLAlchemy + PostgreSQL/SQLite + Docker

**Architecture**: Modular design with clear separation between UI, business logic, and data layers.

## 15-Minute Setup

### 1. Clone and Environment Setup (5 minutes)
```bash
# Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/chat-based-community-dashboard.git
cd chat-based-community-dashboard

# Set up Python environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip3 install --upgrade pip
pip3 install -r requirements.txt

# Environment configuration
cp .env-template .env
# Edit .env with your API tokens (optional for development)
```

### 2. Database Setup (2 minutes)
```bash
# Option A: SQLite (easiest for development)
./run_sqlite.sh

# Option B: PostgreSQL with Docker
docker-compose up -d db
./run_local.sh
```

### 3. Run and Verify (3 minutes)
```bash
# Start the application
streamlit run app/streamlit_app.py

# Open http://localhost:8501 in your browser
# You should see the dashboard interface
```

### 4. Run Tests (2 minutes)
```bash
# Run the test suite
python3 -m pytest tests/ -v

# Should see all tests passing
```

### 5. Make a Test Change (3 minutes)
```bash
# Create a branch
git checkout -b test/my-first-change

# Make a small change (e.g., edit a comment in app/main.py)
# Commit and push
git add .
git commit -m "Test: my first change"
git push origin test/my-first-change

# Create a pull request on GitHub
```

## Project Structure

```
chat-based-community-dashboard/
├── app/                    # Main application code
│   ├── main.py            # Core Streamlit app
│   ├── streamlit_app.py   # App entry point
│   ├── db/                # Database models and migrations
│   ├── ui/                # UI components and pages
│   ├── utils/             # API integrations and helpers
│   ├── auth/              # Authentication logic
│   └── pages/             # Streamlit pages
├── tests/                 # Test suite
├── docs/                  # Documentation
├── scripts/               # Utility scripts
├── requirements.txt       # Python dependencies
├── docker-compose.yml     # Docker setup
└── .env-template         # Environment variables template
```

## Key Components

### Database Layer (`app/db/`)
- **models.py**: SQLAlchemy models for users, groups, etc.
- **database.py**: Database connection and session management
- **migrations/**: Alembic database migrations

### API Integrations (`app/utils/`)
- **authentik_api.py**: Authentik identity provider integration
- **matrix_api.py**: Matrix chat platform integration
- **email_utils.py**: Email sending functionality

### UI Layer (`app/ui/` and `app/pages/`)
- **components/**: Reusable Streamlit components
- **pages/**: Individual dashboard pages
- **styles.css**: Custom CSS styling

### Business Logic (`app/`)
- **main.py**: Core application logic and routing
- **messages.py**: Message templates and communication
- **auth/**: Authentication and authorization

## Development Workflow

### Daily Development
```bash
# Start your day
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# Make changes, test locally
streamlit run app/streamlit_app.py

# Run tests frequently
python3 -m pytest tests/ -v

# Commit and push
git add .
git commit -m "Add feature: clear description"
git push origin feature/your-feature-name
```

### Testing Strategy
- **Unit tests**: Test individual functions and classes
- **Integration tests**: Test API integrations and database operations
- **UI tests**: Test Streamlit components and user workflows
- **Manual testing**: Always test in the browser

### Code Style
- **Follow PEP 8** for Python code style
- **Use type hints** where helpful
- **Write docstrings** for functions and classes
- **Keep functions small** and focused
- **Handle errors gracefully** with try/catch blocks

## Common Development Tasks

### Adding a New Feature
1. **Create a branch**: `git checkout -b feature/feature-name`
2. **Add database models** if needed (in `app/db/models.py`)
3. **Create API functions** (in `app/utils/`)
4. **Build UI components** (in `app/ui/` or `app/pages/`)
5. **Add tests** (in `tests/`)
6. **Update documentation** as needed

### Working with the Database
```python
# Example: Adding a new model
from sqlalchemy import Column, Integer, String, DateTime
from app.db.database import Base

class NewModel(Base):
    __tablename__ = "new_models"
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# Create migration
alembic revision --autogenerate -m "Add new model"
alembic upgrade head
```

### Adding API Integrations
```python
# Example: New API integration
import requests
from app.utils.config import get_setting

def call_external_api(data):
    """Call an external API with error handling."""
    try:
        api_url = get_setting("EXTERNAL_API_URL")
        response = requests.post(api_url, json=data)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        logger.error(f"API call failed: {e}")
        raise
```

### Creating UI Components
```python
# Example: Reusable Streamlit component
import streamlit as st

def user_selector(users, key=None):
    """Reusable user selection component."""
    user_options = {f"{u.name} ({u.email})": u.id for u in users}
    selected = st.selectbox(
        "Select User",
        options=list(user_options.keys()),
        key=key
    )
    return user_options.get(selected) if selected else None
```

## Debugging Tips

### Common Issues
**"Database connection failed"**
- Check your DATABASE_URL in .env
- Ensure PostgreSQL is running (if using PostgreSQL)
- Try SQLite mode for development

**"API integration not working"**
- Check API tokens in .env
- Verify API endpoints are accessible
- Check logs for detailed error messages

**"Streamlit app won't start"**
- Check for Python syntax errors
- Ensure all dependencies are installed
- Try running with `streamlit run app/streamlit_app.py --logger.level debug`

### Debugging Tools
- **Streamlit debugger**: Built-in error display
- **Python debugger**: Use `import pdb; pdb.set_trace()`
- **Logging**: Check `app.log` for detailed logs
- **Database inspection**: Use `sqlite3` or `psql` to inspect data

## Contributing Guidelines

### Before Submitting a PR
- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation is updated
- [ ] Changes are tested manually
- [ ] Commit messages are clear

### PR Review Process
1. **Automated checks** run first
2. **Code review** by maintainers
3. **Feedback and iteration**
4. **Merge** when approved

### Getting Help
- **GitHub Issues**: For bugs and feature requests
- **Community Forum**: https://forum.irregularchat.com/
- **Code Review**: Detailed feedback on all PRs
- **Mentoring**: Available for new contributors

## Learning Resources

### Project-Specific
- **Streamlit Docs**: https://docs.streamlit.io/
- **SQLAlchemy Tutorial**: https://docs.sqlalchemy.org/en/14/tutorial/
- **Authentik API**: https://goauthentik.io/developer-docs/api/
- **Matrix API**: https://matrix.org/docs/api/

### General Development
- **Python Best Practices**: https://realpython.com/
- **Git Workflow**: https://www.atlassian.com/git/tutorials
- **Testing in Python**: https://docs.pytest.org/

## Next Steps

### Your First Contribution
1. **Pick a "good first issue"** from GitHub
2. **Set up your development environment**
3. **Make the change and test it**
4. **Submit a pull request**
5. **Respond to code review feedback**

### Growing as a Contributor
- **Take on larger features** from the roadmap
- **Help review other contributors' PRs**
- **Improve documentation and tests**
- **Mentor new contributors**

### Becoming a Maintainer
- **Consistent, high-quality contributions**
- **Help with project direction and architecture**
- **Support the community and other contributors**
- **Take ownership of specific areas**

---

**Ready to start contributing?** Pick an issue, set up your environment, and dive in! We're here to help you succeed.

**Questions?** Join our community forum or ask in your pull request - we love helping new contributors! 