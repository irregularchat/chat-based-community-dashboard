# Chat-Based Community Dashboard

> **A modern Next.js application for managing community members across Signal, Matrix, and other platforms - built for scale and ease of use.**

See [forum post about this project](https://forum.irregularchat.com/t/forking-authentik-distro-for-better-community-management/647?u=sac) for more information.

## 🎨 Modern Stack Architecture

This repository contains the **modern-stack** version of the community dashboard, built with:
- **Next.js 15** with App Router and Turbopack
- **TypeScript** for type safety
- **Prisma ORM** for database management
- **tRPC** for type-safe APIs
- **NextAuth** for authentication
- **Tailwind CSS** and shadcn/ui for modern UI

> **Looking for the legacy Streamlit version?** Check out the [`legacy-streamlit`](https://github.com/irregularchat/chat-based-community-dashboard/tree/legacy-streamlit) branch.


## 🎯 Why This Matters for Your Community

**Are you a community organizer struggling with:**
- Managing member accounts across different platforms?
- Onboarding new members efficiently?
- Keeping track of who has access to what?
- Bridging conversations between Signal, Matrix, and other chat platforms?

**This dashboard solves these problems** by giving you a simple web interface to:
- ✅ Create and manage user accounts in one place
- ✅ Send automated welcome messages and invitations
- ✅ Bridge chats between Signal, Matrix, and other platforms
- ✅ Track member activity and permissions
- ✅ Handle password resets and account issues quickly

## 🚀 Perfect for Communities That Want To

- **Start with Signal** (since most people already have it) and expand to other platforms
- **Self-host their community tools** instead of relying on big tech
- **Give members choice** in how they participate (Signal, Matrix, email, etc.)
- **Scale efficiently** without drowning in administrative tasks

## ✨ What You Get

### For Community Builders
- **Web dashboard** - No command line needed, just point and click
- **Member management** - Create accounts, reset passwords, manage permissions
- **Cross-platform bridging** - Connect Signal groups with Matrix rooms
- **Automated onboarding** - Send welcome messages and invites automatically
- **Moderation tools** - Manage moderators and handle conflicts efficiently

### For Developers (Entry to Mid-Level)
- **Python/Streamlit** - Easy to understand and modify
- **Docker setup** - Get running in minutes
- **Clear codebase** - Well-organized with tests
- **API integrations** - Authentik, Matrix, Signal bots
- **Database management** - PostgreSQL with migrations

## 🏃‍♀️ Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+ 
- PostgreSQL (or use Docker)
- Git

### Option 1: Local Development
```bash
# Clone the repository
git clone https://github.com/irregularchat/chat-based-community-dashboard.git
cd chat-based-community-dashboard/modern-stack

# Install dependencies
npm install

# Set up PostgreSQL with Docker
docker-compose up -d

# Copy environment variables
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Seed the database with test data
npx prisma db seed

# Start the development server
npm run dev
```

Open http://localhost:3000 in your browser!

Default credentials:
- Username: `admin`
- Password: `shareme314`

### Option 2: Production Deployment with Docker
```bash
# Clone the repository
git clone https://github.com/irregularchat/chat-based-community-dashboard.git
cd chat-based-community-dashboard

# Setup environment
cp .env-template .env
nano .env  # Add your API tokens (see setup guide below)

# Run with Docker
docker-compose up -d --build
```
Open http://localhost:8501 in your browser!

## 🔧 Setup Guide

### Getting Your API Tokens

**Authentik API Token** (Required for user management):
1. Go to your Authentik admin panel: `https://your-sso-domain.com/if/admin/`
2. Navigate to System → Tokens
3. Create a new token with appropriate permissions
4. Copy the token to your `.env` file

**Matrix Integration** (Optional, for bridging):
- Add your Matrix homeserver URL and access token to `.env`
- See our [Matrix Setup Guide](docs/matrix-setup.md) for details

### Environment Configuration
Edit your `.env` file:
```env
# Required: Authentik integration
AUTHENTIK_API_TOKEN=your_api_token_here
AUTHENTIK_BASE_URL=https://your-sso-domain.com

# Optional: Matrix integration
MATRIX_HOMESERVER=https://matrix.your-domain.com
MATRIX_ACCESS_TOKEN=your_matrix_token

# Database (auto-configured for Docker)
DATABASE_URL=postgresql://user:pass@db:5432/dashboard
```

## 📖 How to Use

### For Community Organizers
1. **Access the dashboard** at http://localhost:8501
2. **Create user accounts** - Fill in member details, system generates secure passwords
3. **Send invitations** - Automated emails with login instructions
4. **Manage permissions** - Add/remove moderators, manage group access
5. **Bridge platforms** - Connect your Signal groups with Matrix rooms

### For Developers
- **Main app**: `app/main.py` - Streamlit interface
- **Database models**: `app/db/` - SQLAlchemy models
- **API integrations**: `app/utils/` - Authentik, Matrix APIs
- **Tests**: `tests/` - Pytest test suite
- **UI components**: `app/ui/` - Reusable Streamlit components

## 🛣️ What's Coming Next

See our [detailed roadmap](ROADMAP.md) for the full picture. Key highlights:

**🔥 Coming Soon (Next 2-4 weeks)**
- Enhanced user list with bulk actions
- Direct email messaging to users
- Admin audit logging

**🚀 This Quarter**
- Signal bot integration for automated announcements
- Conflict resolution room creation
- Advanced Matrix room management

**🌟 Future Vision**
- Support for more identity providers (Keycloak, etc.)
- Mobile-friendly interface
- Advanced analytics and reporting

## 🤝 How to Contribute

**New to open source?** Perfect! This project is designed to be beginner-friendly.

### 🕐 Got 15 minutes?
- Report bugs or suggest features in [Issues](https://github.com/irregularchat/chat-based-community-dashboard/issues)
- Improve documentation (fix typos, clarify instructions)
- Test the setup process and report any problems

### 🕐 Got 1-2 hours?
- Pick up a "good first issue" from our [issue tracker](https://github.com/irregularchat/chat-based-community-dashboard/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- Add tests for existing features
- Improve error messages and user experience

### 🕐 Got more time?
- Implement features from our [roadmap](ROADMAP.md)
- Add new integrations (Discord, Slack, etc.)
- Improve the UI/UX design

**See our [Contributing Guide](CONTRIBUTING.md) for detailed instructions.**

## 🏗️ Technical Details

**Built with:**
- **Frontend**: Streamlit (Python web framework)
- **Backend**: SQLAlchemy + PostgreSQL/SQLite
- **Integrations**: Authentik API, Matrix API, Email (SMTP)
- **Deployment**: Docker + Docker Compose

**System Requirements:**
- Python 3.8+
- Docker (recommended) or PostgreSQL
- 512MB RAM minimum, 1GB recommended

## 📞 Getting Help

- **Community Forum**: [forum.irregularchat.com](https://forum.irregularchat.com/t/forking-authentik-distro-for-better-community-management/647)
- **GitHub Issues**: For bugs and feature requests
- **Documentation**: Check the `docs/` folder for detailed guides

## 📄 License

This project is open source. See [LICENSE](LICENSE) for details.

---

**Ready to transform your community management?** [Get started in 5 minutes](#-quick-start-5-minutes) or [join our community](https://forum.irregularchat.com/) to learn more!
