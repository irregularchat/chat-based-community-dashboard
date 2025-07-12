# Database Schema Design: SQLAlchemy to Prisma Migration

## Overview

This document outlines the complete database schema migration from SQLAlchemy to Prisma ORM. The new schema improves upon the existing structure with better relationships, constraints, naming conventions, and modern database practices.

## Current Schema Analysis

### Existing Models
1. **User** - Core user management with Authentik integration
2. **AdminEvent** - Event logging system
3. **VerificationCode** - Email verification codes
4. **MatrixRoomMember** - Matrix room membership tracking
5. **UserNote** - Moderator notes system
6. **Invite** - Invitation management
7. **Group** - Authentik group management
8. **ModeratorPermission** - Moderator permissions
9. **MatrixUser** - Matrix user caching
10. **MatrixRoom** - Matrix room caching
11. **MatrixRoomMembership** - Matrix room membership relationships
12. **MatrixSyncStatus** - Matrix sync operations tracking
13. **MatrixUserCache** - Denormalized user cache

### Schema Improvements
- **Better Naming**: Consistent camelCase naming convention
- **Enhanced Relationships**: Proper foreign key constraints and cascading
- **Type Safety**: Using appropriate Prisma types
- **Indexing**: Strategic indexes for performance
- **Audit Fields**: Consistent createdAt/updatedAt fields
- **Soft Deletes**: Proper soft delete implementation
- **Enums**: Type-safe enums for status fields

## Prisma Schema

### Core Schema Configuration
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### User Management

```prisma
model User {
  id            String    @id @default(cuid())
  username      String    @unique
  email         String    @unique
  firstName     String?
  lastName      String?
  fullName      String?   // Computed field for search
  isActive      Boolean   @default(true)
  isAdmin       Boolean   @default(false)
  isModerator   Boolean   @default(false)
  
  // Authentication fields
  authentikId   String?   @unique
  passwordHash  String?   // For local authentication
  
  // Profile fields
  avatar        String?
  bio           String?
  intro         String?   // User introduction text
  
  // Matrix integration
  matrixUsername String?  @unique
  signalIdentity String?  // Signal name or phone
  
  // Audit fields
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastLogin     DateTime?
  
  // Relationships
  notes         UserNote[]
  createdNotes  UserNote[]  @relation("CreatedBy")
  
  groups        UserGroup[]
  permissions   ModeratorPermission[]
  
  invitations   Invitation[] @relation("CreatedBy")
  usedInvitation Invitation? @relation("UsedBy")
  
  adminEvents   AdminEvent[] @relation("PerformedBy")
  userEvents    AdminEvent[] @relation("TargetUser")
  
  verificationCodes VerificationCode[]
  
  @@map("users")
  @@index([username])
  @@index([email])
  @@index([isActive])
  @@index([isAdmin])
  @@index([isModerator])
  @@index([lastLogin])
}

model UserNote {
  id            String    @id @default(cuid())
  userId        String
  content       String
  isPrivate     Boolean   @default(false)
  
  // Audit fields
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  createdById   String
  lastEditedById String?
  
  // Relationships
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdBy     User      @relation("CreatedBy", fields: [createdById], references: [id])
  lastEditedBy  User?     @relation("LastEditedBy", fields: [lastEditedById], references: [id])
  
  @@map("user_notes")
  @@index([userId])
  @@index([createdById])
  @@index([createdAt])
}
```

### Authentication & Authorization

```prisma
model Group {
  id              String      @id @default(cuid())
  name            String      @unique
  description     String?
  authentikGroupId String?    @unique
  
  // Audit fields
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  
  // Relationships
  users           UserGroup[]
  
  @@map("groups")
  @@index([name])
}

model UserGroup {
  userId    String
  groupId   String
  
  // Audit fields
  assignedAt DateTime @default(now())
  assignedById String?
  
  // Relationships
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  assignedBy User?   @relation("AssignedBy", fields: [assignedById], references: [id])
  
  @@id([userId, groupId])
  @@map("user_groups")
}

model ModeratorPermission {
  id              String              @id @default(cuid())
  userId          String
  permissionType  PermissionType
  permissionValue String?             // Section name, room ID, or null for global
  
  // Audit fields
  createdAt       DateTime            @default(now())
  createdById     String
  
  // Relationships
  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdBy       User                @relation("PermissionCreatedBy", fields: [createdById], references: [id])
  
  @@map("moderator_permissions")
  @@index([userId])
  @@index([permissionType, permissionValue])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  
  // Session metadata
  userAgent String?
  ipAddress String?
  
  // Audit fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Relationships
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("sessions")
  @@index([userId])
  @@index([expiresAt])
}

enum PermissionType {
  SECTION
  ROOM
  GLOBAL
}
```

### Invitation System

```prisma
model Invitation {
  id          String          @id @default(cuid())
  code        String          @unique
  type        InvitationType
  label       String?
  
  // Expiration and usage limits
  expiresAt   DateTime?
  maxUses     Int?
  usedCount   Int             @default(0)
  isActive    Boolean         @default(true)
  
  // Metadata
  metadata    Json?
  
  // Audit fields
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  createdById String
  usedById    String?
  usedAt      DateTime?
  
  // Relationships
  createdBy   User            @relation("CreatedBy", fields: [createdById], references: [id])
  usedBy      User?           @relation("UsedBy", fields: [usedById], references: [id])
  
  @@map("invitations")
  @@index([code])
  @@index([type])
  @@index([expiresAt])
  @@index([isActive])
}

enum InvitationType {
  REGISTRATION
  ROOM_INVITE
  ADMIN_INVITE
}
```

### Event Logging & Audit

```prisma
model AdminEvent {
  id            String      @id @default(cuid())
  type          EventType
  userId        String?     // Target user (optional)
  performedById String      // User who performed the action
  
  // Event details
  description   String?
  details       Json?       // Structured event data
  
  // Audit fields
  createdAt     DateTime    @default(now())
  ipAddress     String?
  userAgent     String?
  
  // Relationships
  user          User?       @relation("TargetUser", fields: [userId], references: [id])
  performedBy   User        @relation("PerformedBy", fields: [performedById], references: [id])
  
  @@map("admin_events")
  @@index([type])
  @@index([userId])
  @@index([performedById])
  @@index([createdAt])
}

enum EventType {
  USER_CREATED
  USER_UPDATED
  USER_DELETED
  USER_ACTIVATED
  USER_DEACTIVATED
  USER_LOGIN
  USER_LOGOUT
  
  PERMISSION_GRANTED
  PERMISSION_REVOKED
  
  INVITATION_CREATED
  INVITATION_USED
  INVITATION_EXPIRED
  
  MATRIX_INVITATION
  MATRIX_BULK_INVITATION
  MATRIX_MESSAGE_SENT
  
  BULK_USER_UPDATE
  BULK_USER_DELETE
  
  SYSTEM_SYNC
  SYSTEM_BACKUP
  
  ADMIN_ACTION
  MODERATOR_ACTION
}
```

### Matrix Integration

```prisma
model MatrixUser {
  id            String                @id // Matrix user ID (@user:domain.com)
  displayName   String?
  avatarUrl     String?
  isSignalUser  Boolean               @default(false)
  
  // Activity tracking
  lastSeen      DateTime?
  isOnline      Boolean               @default(false)
  
  // Audit fields
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  
  // Relationships
  memberships   MatrixRoomMembership[]
  
  @@map("matrix_users")
  @@index([displayName])
  @@index([isSignalUser])
  @@index([lastSeen])
}

model MatrixRoom {
  id            String                @id // Matrix room ID (!room:domain.com)
  name          String?
  displayName   String?
  topic         String?
  canonicalAlias String?
  
  // Room metadata
  memberCount   Int                   @default(0)
  roomType      MatrixRoomType?
  isDirect      Boolean               @default(false)
  isEncrypted   Boolean               @default(false)
  isPublic      Boolean               @default(false)
  
  // Sync tracking
  lastSynced    DateTime?
  
  // Audit fields
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  
  // Relationships
  memberships   MatrixRoomMembership[]
  
  @@map("matrix_rooms")
  @@index([name])
  @@index([memberCount])
  @@index([roomType])
  @@index([isDirect])
  @@index([isPublic])
  @@index([lastSynced])
}

model MatrixRoomMembership {
  id              String              @id @default(cuid())
  roomId          String
  userId          String
  
  // Membership details
  membership      MembershipStatus    @default(JOIN)
  powerLevel      Int                 @default(0)
  
  // Timestamps
  joinedAt        DateTime?
  leftAt          DateTime?
  
  // Audit fields
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  
  // Relationships
  room            MatrixRoom          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user            MatrixUser          @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([roomId, userId])
  @@map("matrix_room_memberships")
  @@index([roomId])
  @@index([userId])
  @@index([membership])
}

model MatrixSyncStatus {
  id              String            @id @default(cuid())
  syncType        MatrixSyncType
  status          SyncStatus        @default(PENDING)
  
  // Progress tracking
  totalItems      Int               @default(0)
  processedItems  Int               @default(0)
  errorMessage    String?
  
  // Timing
  startedAt       DateTime?
  completedAt     DateTime?
  durationSeconds Int?
  
  // Audit fields
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  
  @@map("matrix_sync_status")
  @@index([syncType])
  @@index([status])
  @@index([createdAt])
}

enum MatrixRoomType {
  DIRECT
  PUBLIC
  PRIVATE
  SPACE
}

enum MembershipStatus {
  JOIN
  LEAVE
  INVITE
  BAN
  KNOCK
}

enum MatrixSyncType {
  USERS
  ROOMS
  MEMBERSHIPS
  FULL_SYNC
}

enum SyncStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}
```

### Verification & Security

```prisma
model VerificationCode {
  id        String   @id @default(cuid())
  userId    String   // Can be username or user ID
  code      String
  type      VerificationType
  
  // Expiration
  expiresAt DateTime
  isUsed    Boolean  @default(false)
  usedAt    DateTime?
  
  // Audit fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  // Relationships
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("verification_codes")
  @@index([userId])
  @@index([code])
  @@index([expiresAt])
  @@index([isUsed])
}

enum VerificationType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  TWO_FACTOR_AUTH
}
```

### System Settings

```prisma
model Setting {
  id          String    @id @default(cuid())
  key         String    @unique
  value       Json
  type        SettingType
  description String?
  
  // Audit fields
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  updatedById String?
  
  // Relationships
  updatedBy   User?     @relation(fields: [updatedById], references: [id])
  
  @@map("settings")
  @@index([key])
  @@index([type])
}

enum SettingType {
  STRING
  INTEGER
  BOOLEAN
  JSON
  ARRAY
}
```

## Migration Strategy

### Phase 1: Database Setup
```bash
# Initialize Prisma
npx prisma init

# Generate schema
npx prisma generate

# Create migration
npx prisma migrate dev --name init
```

### Phase 2: Data Migration Script
```typescript
// scripts/migrate-data.ts
import { PrismaClient } from '@prisma/client'
import { getUsersFromSQLAlchemy } from './legacy-db'

const prisma = new PrismaClient()

async function migrateUsers() {
  const legacyUsers = await getUsersFromSQLAlchemy()
  
  for (const legacyUser of legacyUsers) {
    await prisma.user.create({
      data: {
        username: legacyUser.username,
        email: legacyUser.email,
        firstName: legacyUser.first_name,
        lastName: legacyUser.last_name,
        fullName: `${legacyUser.first_name} ${legacyUser.last_name}`.trim(),
        isActive: legacyUser.is_active,
        isAdmin: legacyUser.is_admin,
        isModerator: legacyUser.is_moderator,
        authentikId: legacyUser.authentik_id,
        matrixUsername: legacyUser.matrix_username,
        signalIdentity: legacyUser.signal_identity,
        createdAt: legacyUser.date_joined,
        lastLogin: legacyUser.last_login
      }
    })
  }
}

async function migrateUserNotes() {
  // Migrate user notes with proper relationships
  const legacyNotes = await getUserNotesFromSQLAlchemy()
  
  for (const note of legacyNotes) {
    const user = await prisma.user.findUnique({
      where: { id: note.user_id.toString() }
    })
    
    const createdByUser = await prisma.user.findUnique({
      where: { username: note.created_by }
    })
    
    if (user && createdByUser) {
      await prisma.userNote.create({
        data: {
          userId: user.id,
          content: note.content,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
          createdById: createdByUser.id
        }
      })
    }
  }
}

async function migrateMatrix() {
  // Migrate Matrix users
  const legacyMatrixUsers = await getMatrixUsersFromSQLAlchemy()
  
  for (const user of legacyMatrixUsers) {
    await prisma.matrixUser.create({
      data: {
        id: user.user_id,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        isSignalUser: user.is_signal_user,
        lastSeen: user.last_seen,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }
    })
  }
  
  // Migrate Matrix rooms
  const legacyRooms = await getMatrixRoomsFromSQLAlchemy()
  
  for (const room of legacyRooms) {
    await prisma.matrixRoom.create({
      data: {
        id: room.room_id,
        name: room.name,
        displayName: room.display_name,
        topic: room.topic,
        canonicalAlias: room.canonical_alias,
        memberCount: room.member_count,
        roomType: mapRoomType(room.room_type),
        isDirect: room.is_direct,
        isEncrypted: room.is_encrypted,
        lastSynced: room.last_synced,
        createdAt: room.created_at,
        updatedAt: room.updated_at
      }
    })
  }
}

// Main migration function
async function main() {
  try {
    console.log('Starting database migration...')
    
    await migrateUsers()
    console.log('✓ Users migrated')
    
    await migrateUserNotes()
    console.log('✓ User notes migrated')
    
    await migrateMatrix()
    console.log('✓ Matrix data migrated')
    
    // Continue with other migrations...
    
    console.log('Migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
```

### Phase 3: Testing and Validation
```typescript
// tests/migration-validation.test.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

describe('Migration Validation', () => {
  test('should have migrated all users', async () => {
    const userCount = await prisma.user.count()
    expect(userCount).toBeGreaterThan(0)
  })
  
  test('should maintain user relationships', async () => {
    const userWithNotes = await prisma.user.findFirst({
      include: {
        notes: true
      }
    })
    
    expect(userWithNotes).toBeDefined()
    if (userWithNotes?.notes.length > 0) {
      expect(userWithNotes.notes[0].userId).toBe(userWithNotes.id)
    }
  })
  
  test('should have proper Matrix relationships', async () => {
    const membership = await prisma.matrixRoomMembership.findFirst({
      include: {
        room: true,
        user: true
      }
    })
    
    if (membership) {
      expect(membership.room).toBeDefined()
      expect(membership.user).toBeDefined()
    }
  })
})
```

## Key Improvements

### 1. Type Safety
- **Enums**: Using Prisma enums for better type safety
- **Proper Types**: Using appropriate field types (DateTime, Json, etc.)
- **Constraints**: Unique constraints and proper relationships

### 2. Performance
- **Strategic Indexes**: Added indexes for common query patterns
- **Efficient Relationships**: Proper foreign key relationships
- **Pagination Support**: Cursor-based pagination support

### 3. Audit Trail
- **Consistent Timestamps**: All models have createdAt/updatedAt
- **User Tracking**: Who created/modified records
- **Event Logging**: Comprehensive audit logging

### 4. Data Integrity
- **Cascade Deletes**: Proper cascade behavior
- **Unique Constraints**: Prevent duplicate data
- **Foreign Key Constraints**: Maintain referential integrity

### 5. Modern Patterns
- **CUID**: Using collision-resistant IDs
- **Soft Deletes**: Implementing via isActive flags
- **JSON Fields**: Flexible metadata storage

## Usage Examples

### Basic Queries
```typescript
// Get user with notes
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    notes: {
      include: {
        createdBy: true
      }
    },
    groups: {
      include: {
        group: true
      }
    }
  }
})

// Paginated user list
const users = await prisma.user.findMany({
  where: {
    isActive: true,
    OR: [
      { username: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } }
    ]
  },
  skip: (page - 1) * pageSize,
  take: pageSize,
  orderBy: { createdAt: 'desc' }
})
```

### Complex Queries
```typescript
// Matrix room recommendations
const roomsWithActivity = await prisma.matrixRoom.findMany({
  where: {
    isPublic: true,
    memberCount: { gte: 5 }
  },
  include: {
    memberships: {
      where: {
        membership: 'JOIN'
      },
      include: {
        user: true
      }
    }
  },
  orderBy: {
    memberCount: 'desc'
  }
})

// Admin dashboard stats
const stats = await prisma.$transaction([
  prisma.user.count(),
  prisma.user.count({ where: { isActive: true } }),
  prisma.adminEvent.count({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    }
  })
])
```

## Migration Timeline

### Week 1: Schema Design & Setup
- [ ] Finalize Prisma schema
- [ ] Set up development database
- [ ] Create initial migration

### Week 2: Data Migration Scripts
- [ ] Write migration scripts
- [ ] Test migration with sample data
- [ ] Validate data integrity

### Week 3: Testing & Optimization
- [ ] Performance testing
- [ ] Index optimization
- [ ] Backup and rollback procedures

### Week 4: Production Migration
- [ ] Production migration
- [ ] Monitor performance
- [ ] Fix any issues

---

*This schema design provides a solid foundation for the modern Community Dashboard with improved performance, maintainability, and type safety.* 