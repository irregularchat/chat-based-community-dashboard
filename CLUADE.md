# Development Partnership for OmniCore

We're building production-quality code together for the OmniCore platform. Your role is to create maintainable, efficient solutions while catching potential issues early.

When you seem stuck or overly complex, I'll redirect you - my guidance helps you stay on track.

## 🚨 AUTOMATED CHECKS ARE MANDATORY
**ALL linting and test issues are BLOCKING - EVERYTHING must be ✅ GREEN!**  
No errors. No formatting issues. No linting problems. Zero tolerance.  
These are not suggestions. Fix ALL issues before continuing.

## CRITICAL WORKFLOW - ALWAYS FOLLOW THIS!

### Research → Plan → Implement
**NEVER JUMP STRAIGHT TO CODING!** Always follow this sequence:
1. **Research**: Explore the codebase, understand existing patterns
2. **Plan**: Create a detailed implementation plan and verify it with me  
3. **Implement**: Execute the plan with validation checkpoints

When asked to implement any feature, you'll first say: "Let me research the codebase and create a plan before implementing."

For complex architectural decisions or challenging problems, use **"ultrathink"** to engage maximum reasoning capacity. Say: "Let me ultrathink about this architecture before proposing a solution."

### USE MULTIPLE AGENTS!
*Leverage subagents aggressively* for better results:

* Spawn agents to explore different parts of the codebase in parallel
* Use one agent to write tests while another implements features
* Delegate research tasks: "I'll have an agent investigate the database schema while I analyze the API structure"
* For complex refactors: One agent identifies changes, another implements them

Say: "I'll spawn agents to tackle different aspects of this problem" whenever a task has multiple independent parts.

### Reality Checkpoints
**Stop and validate** at these moments:
- After implementing a complete feature
- Before starting a new major component  
- When something feels wrong
- Before declaring "done"
- **WHEN LINTERS OR TESTS FAIL** ❌

**Backend**: `cd backend && make lint && make test`  
**Frontend**: `cd frontend && npm run lint && npm test`

> Why: You can lose track of what's actually working. These checkpoints prevent cascading failures.

### 🚨 CRITICAL: Linting/Test Failures Are BLOCKING
**When linters or tests report ANY issues, you MUST:**
1. **STOP IMMEDIATELY** - Do not continue with other tasks
2. **FIX ALL ISSUES** - Address every ❌ issue until everything is ✅ GREEN
3. **VERIFY THE FIX** - Re-run the failed command to confirm it's fixed
4. **CONTINUE ORIGINAL TASK** - Return to what you were doing before the interrupt
5. **NEVER IGNORE** - There are NO warnings, only requirements

This includes:
- Formatting issues (black, prettier, etc.)
- Linting violations (flake8, eslint, etc.)
- Type errors (mypy, TypeScript)
- Failed tests (pytest, vitest)
- ALL other checks

Your code must be 100% clean. No exceptions.

**Recovery Protocol:**
- When interrupted by a failure, maintain awareness of your original task
- After fixing all issues and verifying the fix, continue where you left off
- Use the todo list to track both the fix and your original task

## 🔧 Environment & Configuration Management

### Conda Environments (MANDATORY)
**ALWAYS activate the correct conda environment before running commands:**

```bash
# Backend work
conda activate omnicore-backend
cd backend

# Frontend work  
conda activate omnicore-frontend
cd frontend

# Mediaserver work (if needed)
conda activate mediaserver
cd backend/mediaserver
```

### Configuration System
OmniCore uses a centralized configuration system:

1. **config.yaml** - Central configuration file controlling all services
2. **configure.sh** - Environment setup and management
3. **omnicore.sh** - Application management (start, stop, build)

**Before starting development:**
```bash
# Initialize configuration (first time only)
./configure.sh init

# Check configuration status
./configure.sh status

# Set up development environment
./configure.sh dev
```

### Deployment Modes
- **local**: Development with conda environments (recommended for development)
- **hybrid**: Frontend/Backend local, infrastructure in Docker
- **docker**: Everything in containers

**Start development:**
```bash
# Recommended for development
./omnicore.sh start local
```

### Development Environment Setup
**Standard development configuration:**
- **Frontend, Backend, Mediaserver**: Run in terminal (using conda environments)
- **Everything else** (PostgreSQL, Redis, MinIO, etc.): Runs in Docker

This hybrid approach provides:
- Fast iteration on application code
- Stable infrastructure services
- Easy debugging and hot reloading

### Database Credentials
**To connect to the database or other services:**
```bash
# Read current credentials from docker-compose.yml
cat docker-compose.yml  # Look for POSTGRES_USER, POSTGRES_PASSWORD, etc.

# Or check running container environment
docker-compose ps
docker-compose exec postgres env | grep POSTGRES_
```

Always use the credentials from docker-compose.yml for consistency with the running services.

## Working Memory Management

### When context gets long:
- Re-read this CLAUDE.md file
- Summarize progress in a PROGRESS.md file
- Document current state before major changes

### Maintain TODO.md:
```
## Current Task
- [ ] What we're doing RIGHT NOW

## Completed  
- [x] What's actually done and tested

## Next Steps
- [ ] What comes next
```

## Python/Backend-Specific Rules

### FORBIDDEN - NEVER DO THESE:
- **NO bare except:** - Always catch specific exceptions
- **NO mutable default arguments** - Use `None` and check in function
- **NO print() in production code** - Use proper logging
- **NO hardcoded secrets or URLs** - Use environment variables
- **NO direct database queries in views** - Use service layer
- **NO synchronous operations in async code** - Keep async consistent
- **NO TODOs in final code**

### Required Standards:
- **Type hints on all functions**: Use proper typing annotations
- **Docstrings on all public functions**: Google style docstrings
- **Early returns** to reduce nesting
- **Dependency injection**: Pass dependencies, don't import globally
- **Use Pydantic models** for validation
- **Service layer pattern**: Controllers → Services → Repositories
- **Proper error handling**: Return appropriate HTTP status codes
- **Database migrations**: Always use Alembic, never manual SQL

### Testing Standards (Backend)
```bash
# Always in omnicore-backend environment
cd backend

# Run all tests
make test

# Run with coverage
make coverage

# Run specific test
pytest tests/unit/test_auth.py -v
```

## TypeScript/Frontend-Specific Rules

### FORBIDDEN - NEVER DO THESE:
- **NO `any` type** - Use proper types or `unknown`
- **NO direct DOM manipulation** - Use React
- **NO inline styles** - Use Tailwind classes
- **NO console.log in production** - Use proper logging
- **NO unhandled promises** - Always catch or return
- **NO direct API calls in components** - Use service layer
- **NO magic strings/numbers** - Use constants
- **NO TODOs in final code**

### Required Standards:
- **Explicit return types** on all functions
- **Proper error boundaries** for error handling
- **Custom hooks** for reusable logic
- **Zustand stores** for global state
- **React Query** for server state
- **Proper loading and error states** in all components
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Mobile-first responsive design** with Tailwind

### Testing Standards (Frontend)
```bash
# Always in omnicore-frontend environment
cd frontend

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Implementation Standards

### Our code is complete when:
- ✅ All linters pass with zero issues
- ✅ All tests pass  
- ✅ Feature works end-to-end
- ✅ Old code is deleted (no dead code)
- ✅ Proper documentation exists
- ✅ Code follows project patterns

### Backend Testing Strategy
- Complex business logic → Write tests first (TDD)
- API endpoints → Test all status codes and edge cases
- Database operations → Use test database with transactions
- External services → Mock with unittest.mock
- Async code → Use pytest-asyncio

### Frontend Testing Strategy  
- Components → Test user interactions and edge cases
- Custom hooks → Test in isolation with renderHook
- API calls → Mock with MSW or vi.mock
- Forms → Test validation and submission
- State management → Test store actions and selectors

### Project Structure

**Backend:**
```
backend/
├── app/
│   ├── api/         # API routes/controllers
│   ├── core/        # Core configuration
│   ├── models/      # SQLAlchemy models
│   ├── services/    # Business logic
│   └── utils/       # Utilities
├── tests/
│   ├── unit/        # Unit tests
│   └── integration/ # Integration tests
└── alembic/         # Database migrations
```

**Frontend:**
```
frontend/
├── src/
│   ├── components/  # React components
│   ├── pages/       # Page components
│   ├── services/    # API services
│   ├── stores/      # Zustand stores
│   ├── hooks/       # Custom hooks
│   └── types/       # TypeScript types
└── tests/           # Test files
```

## Common Development Tasks

### Database Changes (Backend)
```bash
conda activate omnicore-backend
cd backend

# Create migration
alembic revision --autogenerate -m "Add user preferences table"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Database Changes (Backend) - CRITICAL RULES
```bash
conda activate omnicore-backend
cd backend

# ALWAYS check current date before creating migrations
date  # Use this date for migration filenames - NEVER make up dates!

# Check for multiple heads (MUST be avoided)
alembic heads  # Should only show ONE head
alembic branches  # Review branch structure

# If multiple heads exist, merge them immediately:
alembic merge -m "Merge heads"

# Create migration with proper date
alembic revision --autogenerate -m "Add user preferences table"

# ALWAYS review the generated migration before applying
# Check the generated file in alembic/versions/

# Apply migrations
alembic upgrade head

# Rollback if needed
alembic downgrade -1
```

**⚠️ MIGRATION RULES - STRICTLY ENFORCED:**
1. **ALWAYS use today's actual date** - Run `date` command if unsure
2. **NEVER create multiple heads** - Check with `alembic heads` before creating new migrations
3. **CAREFULLY track all migrations** - Review generated files before applying
4. **NO one-off database operations** - NEVER run manual SQL without explicit permission
5. **If heads diverge** - Stop immediately and merge them
6. **Test migrations** - Always test upgrade AND downgrade paths

**Forbidden Database Operations:**
- ❌ Direct SQL execution without migration
- ❌ Manual table modifications
- ❌ Ad-hoc database scripts
- ❌ Production database access without approval
- ❌ Skipping migration review

### API Development (Backend)
1. Create/update SQLAlchemy model
2. Create Pydantic schemas
3. Implement service layer
4. Add API endpoint
5. Write tests
6. Update API documentation

### Component Development (Frontend)
1. Create component with TypeScript
2. Add Tailwind styling
3. Create Storybook story (if complex)
4. Implement tests
5. Connect to stores/services
6. Ensure accessibility

### Adding New Features
1. **Research** existing patterns
2. **Update** database schema if needed
3. **Implement** backend API
4. **Test** backend thoroughly
5. **Implement** frontend UI
6. **Test** frontend thoroughly
7. **Verify** end-to-end functionality
8. **Update** documentation

## Performance & Security

### Backend Performance:
- Use async/await properly
- Implement database query optimization (eager loading)
- Use Redis caching where appropriate
- Profile with Python profilers before optimizing

### Frontend Performance:
- Use React.memo for expensive components
- Implement virtual scrolling for long lists
- Lazy load routes and components
- Optimize bundle size with code splitting

### Security Always:
- Validate all inputs (Pydantic for backend, Zod for frontend)
- Use parameterized queries (SQLAlchemy handles this)
- Implement proper authentication/authorization
- Never expose sensitive data in frontend
- Use HTTPS in production
- Implement CORS properly

## Communication Protocol

### Progress Updates:
```
✓ Implemented user preferences API (all tests passing)
✓ Added frontend preferences page
✗ Found issue with preference validation - investigating
```

### Suggesting Improvements:
"The current approach works, but I notice [observation].
Would you like me to [specific improvement]?"

### When Stuck:
"I see two approaches:
1. [Option A with pros/cons]
2. [Option B with pros/cons]
Which would you prefer?"

## Problem-Solving Together

When you're stuck or confused:
1. **Stop** - Don't spiral into complex solutions
2. **Research** - Check existing patterns in the codebase
3. **Delegate** - Consider spawning agents for parallel investigation
4. **Ultrathink** - For complex problems, engage deeper reasoning
5. **Step back** - Re-read the requirements
6. **Simplify** - The simple solution is usually correct
7. **Ask** - Get clarification before proceeding

## Configuration Tips

### Environment Variables
- Backend: Check `backend/.env` and `backend/app/core/config.py`
- Frontend: Check `frontend/.env` and use `VITE_` prefix
- Never commit `.env` files, use `.env.example`

### Service URLs
The configuration system automatically manages service URLs based on deployment mode. Check `config.yaml` for current settings.

### Adding New Services
1. Update `config.yaml` with service configuration
2. Update `config_loader.py` if needed
3. Regenerate environment files: `./configure.sh dev`

## Working Together

- This is always a feature branch - no backwards compatibility needed
- When in doubt, we choose clarity over cleverness
- Delete old code when replacing - no commented-out code
- **REMINDER**: If this file hasn't been referenced in 30+ minutes, RE-READ IT!

Remember: Simple, obvious solutions are usually better. My guidance helps you stay focused on what matters. 
