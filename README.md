# Chat-Based Community Dashboard

> **A modern, powerful tool to help community builders manage their members across Signal, Matrix, and other platforms - built with Next.js for speed and reliability.**

See [forum post about this project](https://forum.irregularchat.com/t/forking-authentik-distro-for-better-community-management/647?u=sac) for more information.

## 🎯 Why This Matters for Your Community

**Are you a community organizer struggling with:**
- Managing member accounts across different platforms?
- Onboarding new members efficiently?
- Keeping track of who has access to what?
- Bridging conversations between Signal, Matrix, and other chat platforms?

**This dashboard solves these problems** by giving you a modern web interface to:
- ✅ Create and manage user accounts in one place
- ✅ Send automated welcome messages and invitations
- ✅ Bridge chats between Signal, Matrix, and other platforms
- ✅ Track member activity and permissions with real-time analytics
- ✅ Handle password resets and account issues quickly
- ✅ Mobile-responsive design that works everywhere

## 🚀 Perfect for Communities That Want To

- **Start with Signal** (since most people already have it) and expand to other platforms
- **Self-host their community tools** instead of relying on big tech
- **Give members choice** in how they participate (Signal, Matrix, email, etc.)
- **Scale efficiently** without drowning in administrative tasks
- **Have a modern, fast, and secure platform**

## ✨ What You Get

### For Community Builders
- **Modern web dashboard** - Fast, responsive, mobile-friendly interface
- **Comprehensive user management** - Create accounts, manage roles, bulk operations
- **Advanced analytics** - User metrics, registration trends, activity insights
- **Cross-platform integration** - Matrix messaging, Signal bridge, email automation
- **Real-time updates** - Live data and instant feedback
- **Professional design** - Clean, accessible interface built with modern standards

### For Developers
- **Modern Next.js stack** - React, TypeScript, Tailwind CSS
- **Type-safe APIs** - tRPC with end-to-end type safety
- **Docker deployment** - Get running in minutes
- **Prisma ORM** - Type-safe database operations
- **NextAuth.js** - Secure authentication with multiple providers
- **Comprehensive testing** - Unit, integration, and E2E tests

## 🏃‍♀️ Quick Start (5 Minutes)

### Ready to Go Setup
```bash
# Clone the repository
git clone https://github.com/irregularchat/chat-based-community-dashboard.git
cd chat-based-community-dashboard

# Setup environment
cp .env-template .env
nano .env  # Add your API tokens (see setup guide below)

# Run with Docker
docker compose up -d --build
```
Open http://localhost:8504 in your browser!

### Development Setup
```bash
# Clone and enter the project
git clone https://github.com/irregularchat/chat-based-community-dashboard.git
cd chat-based-community-dashboard

# Setup environment
cp .env-template .env
nano .env  # Configure your settings

# Run the database
docker compose up -d db

# Install dependencies and run development server
cd chat-based-community-dashboard
npm install
npm run dev
```
Open http://localhost:3000 for development!

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
# Required: Database configuration
POSTGRES_USER=dashboarduser
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=dashboarddb
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

# Required: NextAuth.js (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=http://localhost:8504

# Required: Authentik OIDC authentication
AUTHENTIK_CLIENT_ID=community_dashboard
AUTHENTIK_CLIENT_SECRET=your_client_secret_here
AUTHENTIK_ISSUER=https://your-sso-domain.com/application/o/community_dashboard

# Optional: Matrix integration
MATRIX_HOMESERVER=https://matrix.your-domain.com
MATRIX_ACCESS_TOKEN=your_matrix_token
MATRIX_USER_ID=@botname:your-domain.com

# Optional: Email configuration
SMTP_HOST=smtp.your-domain.com
SMTP_USER=username
SMTP_PASS=password
SMTP_FROM=no-reply@your-domain.com
```

## 📖 How to Use

### For Community Organizers
1. **Access the dashboard** at http://localhost:8504
2. **User Management** - Create accounts, assign roles, manage permissions with modern interface
3. **Matrix Integration** - Send messages, invite users, manage rooms with real-time updates
4. **Admin Dashboard** - View analytics, monitor system health, export data
5. **Settings** - Configure email, Matrix, and authentication settings

### For Developers
- **Application**: Root directory - Next.js application
- **Database**: Prisma ORM with PostgreSQL
- **API routes**: `src/lib/trpc/routers/` - tRPC endpoints
- **Components**: `src/components/` - React components
- **Pages**: `src/app/` - Next.js app router pages
- **Legacy code**: `legacy-streamlit/` - Archived Streamlit application

## 🏗️ Architecture

### Modern Stack (Current)
- **Frontend**: Next.js 14 + React + TypeScript
- **UI Library**: Shadcn/ui + Tailwind CSS  
- **Authentication**: NextAuth.js + Authentik OIDC
- **Database**: PostgreSQL + Prisma ORM
- **API**: tRPC with type safety
- **State**: Zustand + React Query

### Performance Benefits
- **2-3x faster** page loads vs legacy Streamlit
- **Mobile responsive** design
- **Type-safe** development
- **Real-time updates** with optimistic UI
- **Modern security** practices

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
