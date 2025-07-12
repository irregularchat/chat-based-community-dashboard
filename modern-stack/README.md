# Community Dashboard - Modern Stack

A modern Next.js-based community dashboard with user management, Matrix integration, and admin analytics.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 19, TypeScript
- **UI**: Shadcn/ui, Tailwind CSS, Lucide Icons
- **Backend**: tRPC, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js (OIDC + Local)
- **Deployment**: Docker, Docker Compose

## Quick Start with Docker

1. **Copy environment file**:
   ```bash
   cp .env.example .env
   ```

2. **Update environment variables** in `.env`:
   - Set `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`)
   - Configure Authentik OIDC settings
   - Update database, email, and Matrix settings

3. **Start the application**:
   ```bash
   docker compose up -d --build
   ```

4. **Access the application**:
   - Dashboard: http://localhost:8504
   - Database: localhost:5436 (external access)

## Development Setup

For local development without Docker:

```bash
# Install dependencies
npm install

# Set up database
npx prisma generate
npx prisma db push
npm run db:seed

# Start development server
npm run dev
```

## Features

- ✅ User management with pagination and search
- ✅ Matrix integration for messaging and room management
- ✅ Admin dashboard with analytics
- ✅ Settings and configuration management
- ✅ Dual authentication (OIDC + Local)
- ✅ Role-based access control
- ✅ Testing framework with Jest

## API Documentation

The application uses tRPC for type-safe API communication. Available routers:

- **auth**: Authentication and session management
- **user**: User CRUD operations and management
- **matrix**: Matrix messaging and room integration
- **admin**: Admin analytics and system management
- **settings**: Configuration management

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [tRPC Documentation](https://trpc.io/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [NextAuth.js Documentation](https://next-auth.js.org)
- [Shadcn/ui Documentation](https://ui.shadcn.com)
