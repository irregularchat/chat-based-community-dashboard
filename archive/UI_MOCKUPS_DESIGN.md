# UI Mockups & Design Specifications

## Overview

This document provides comprehensive UI/UX design specifications for the modern Community Dashboard. It includes wireframes, component designs, responsive layouts, and interaction patterns that will guide the frontend implementation.

## Design Philosophy

### Design Principles
- **Clean & Minimal**: Uncluttered interface focused on functionality
- **Responsive First**: Mobile-first approach with progressive enhancement
- **Accessibility**: WCAG 2.1 AA compliant design
- **Consistent**: Unified design language across all components
- **Intuitive**: User-friendly navigation and interactions

### Visual Style
- **Modern**: Contemporary design with subtle shadows and clean lines
- **Professional**: Business-appropriate color scheme and typography
- **Branded**: Consistent with organization identity
- **Scalable**: Design system that grows with the application

### Color Palette
```
Primary Colors:
- Primary: #2563eb (Blue 600)
- Primary Light: #dbeafe (Blue 100)
- Primary Dark: #1d4ed8 (Blue 700)

Secondary Colors:
- Secondary: #059669 (Emerald 600)
- Secondary Light: #d1fae5 (Emerald 100)
- Secondary Dark: #047857 (Emerald 700)

Neutral Colors:
- Background: #ffffff (White)
- Surface: #f8fafc (Slate 50)
- Border: #e2e8f0 (Slate 200)
- Text: #0f172a (Slate 900)
- Text Secondary: #64748b (Slate 500)
- Muted: #f1f5f9 (Slate 100)

Status Colors:
- Success: #10b981 (Emerald 500)
- Warning: #f59e0b (Amber 500)
- Error: #ef4444 (Red 500)
- Info: #3b82f6 (Blue 500)
```

### Typography
```
Font Family: Inter, system-ui, sans-serif

Headings:
- H1: 2.5rem (40px) - font-bold
- H2: 2rem (32px) - font-semibold
- H3: 1.5rem (24px) - font-semibold
- H4: 1.25rem (20px) - font-medium
- H5: 1.125rem (18px) - font-medium
- H6: 1rem (16px) - font-medium

Body Text:
- Large: 1.125rem (18px) - font-normal
- Base: 1rem (16px) - font-normal
- Small: 0.875rem (14px) - font-normal
- Tiny: 0.75rem (12px) - font-normal
```

## Layout Structure

### Overall Layout
```
┌─────────────────────────────────────────────────────────────────┐
│                          Header                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Logo    Navigation Links    User Menu   Theme Toggle    │    ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────────────────────────────────┐  │
│  │             │  │                                         │  │
│  │   Sidebar   │  │             Main Content               │  │
│  │             │  │                                         │  │
│  │ Navigation  │  │  ┌─────────────────────────────────┐   │  │
│  │             │  │  │                                 │   │  │
│  │  - Home     │  │  │          Page Content          │   │  │
│  │  - Users    │  │  │                                 │   │  │
│  │  - Admin    │  │  │                                 │   │  │
│  │  - Settings │  │  │                                 │   │  │
│  │             │  │  └─────────────────────────────────┘   │  │
│  │             │  │                                         │  │
│  └─────────────┘  └─────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Responsive Breakpoints
```
Mobile:    < 768px  (1 column layout)
Tablet:    768px+   (2 column layout)
Desktop:   1024px+  (3 column layout)
Wide:      1280px+  (Full layout with margins)
```

## Authentication Pages

### Sign-In Page
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    ┌─────────────────────┐                     │
│                    │                     │                     │
│                    │   Community        │                     │
│                    │   Dashboard        │                     │
│                    │   [Logo]           │                     │
│                    │                     │                     │
│                    │  ┌───────────────┐  │                     │
│                    │  │   Sign In     │  │                     │
│                    │  └───────────────┘  │                     │
│                    │                     │                     │
│                    │  ┌─────────────────┐│                     │
│                    │  │ SSO  │  Local   ││                     │
│                    │  └─────────────────┘│                     │
│                    │                     │                     │
│                    │  [Sign in with     │                     │
│                    │   Authentik]       │                     │
│                    │                     │                     │
│                    │  ┌─────────────────┐│                     │
│                    │  │ Username        ││                     │
│                    │  ├─────────────────┤│                     │
│                    │  │ Password        ││                     │
│                    │  ├─────────────────┤│                     │
│                    │  │   [Sign In]     ││                     │
│                    │  └─────────────────┘│                     │
│                    │                     │                     │
│                    └─────────────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Sign-In Component Specifications
```typescript
// SignInPage Component Structure
interface SignInPageProps {
  providers: Provider[]
  csrfToken: string
  callbackUrl?: string
  error?: string
}

// Layout Elements:
- Card container (max-width: 400px)
- Tabbed interface (SSO / Local)
- Error alert banner
- Loading states
- Form validation
- Responsive design
```

## Main Dashboard Layout

### Header Component
```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]  Home  Users  Admin  Settings    [🔍] [🔔] [👤] [🌙]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Header Specifications
```typescript
interface HeaderProps {
  user: User
  notifications: Notification[]
  onSearch: (query: string) => void
  onThemeToggle: () => void
}

// Features:
- Logo with home link
- Navigation menu
- Search functionality
- Notification dropdown
- User profile dropdown
- Theme toggle
- Responsive hamburger menu (mobile)
```

### Sidebar Navigation
```
┌─────────────────┐
│  Navigation     │
│                 │
│  🏠 Home        │
│  👥 Users       │
│   ├ Create User │
│   ├ Manage Users│
│   └ Bulk Actions│
│                 │
│  💬 Matrix      │
│   ├ Messages    │
│   ├ Rooms       │
│   └ Invites     │
│                 │
│  🎫 Invitations │
│   ├ Create      │
│   └ Manage      │
│                 │
│  ⚙️ Settings    │
│                 │
│  🛡️ Admin       │
│   ├ Dashboard   │
│   ├ Events      │
│   └ System      │
│                 │
└─────────────────┘
```

### Sidebar Specifications
```typescript
interface SidebarProps {
  user: User
  currentPath: string
  isCollapsed: boolean
  onNavigate: (path: string) => void
}

// Features:
- Collapsible design
- Active state indicators
- Role-based visibility
- Nested navigation
- Mobile overlay
```

## Core Pages

### Home Dashboard
```
┌─────────────────────────────────────────────────────────────────┐
│  Community Dashboard                                            │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │    1,234    │ │     987     │ │     456     │ │     123     │ │
│  │ Total Users │ │Active Users │ │ New Users   │ │ Invitations │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Recent Activity                          │ │
│  │ ┌─────────────────────────────────────────────────────────┐ │ │
│  │ │ 🟢 John Doe joined 2 hours ago                          │ │ │
│  │ │ 🔵 New user created by admin                           │ │ │
│  │ │ 🟡 System sync completed                               │ │ │
│  │ │ 🔴 Failed login attempt                                │ │ │
│  │ └─────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Quick Actions                            │ │
│  │                                                             │ │
│  │  [Create User]  [Send Invites]  [Sync Data]  [View Reports]│ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### User Management Page
```
┌─────────────────────────────────────────────────────────────────┐
│  User Management                                       [+ Create]│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 🔍 Search users...    [Filter ▼]  [Sort ▼]  [Export ▼]     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ☐ │ Avatar │ Username │ Email      │ Role  │ Status │ Actions│ │
│  │───┼────────┼──────────┼────────────┼───────┼────────┼────────│ │
│  │ ☐ │   👤   │ john_doe │ john@ex.com│ User  │ Active │ [•••]  │ │
│  │ ☐ │   👤   │ jane_s   │ jane@ex.com│ Admin │ Active │ [•••]  │ │
│  │ ☐ │   👤   │ bob_m    │ bob@ex.com │ Mod   │ Active │ [•••]  │ │
│  │ ☐ │   👤   │ alice_w  │ alice@ex.com│ User │ Inactive│ [•••]  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Showing 1-10 of 1,234 users                                │ │
│  │                            [Previous] [1][2][3][4] [Next]  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### User Creation Form
```
┌─────────────────────────────────────────────────────────────────┐
│  Create New User                                                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Personal Information                                        │ │
│  │                                                             │ │
│  │ Username *          ┌─────────────────────────────────────┐ │ │
│  │                     │ john_doe                            │ │ │
│  │                     └─────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │ Email *             ┌─────────────────────────────────────┐ │ │
│  │                     │ john@example.com                    │ │ │
│  │                     └─────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │ Full Name *         ┌─────────────────────────────────────┐ │ │
│  │                     │ John Doe                            │ │ │
│  │                     └─────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │ Introduction        ┌─────────────────────────────────────┐ │ │
│  │                     │ Tell us about yourself...           │ │ │
│  │                     │                                     │ │ │
│  │                     │                                     │ │ │
│  │                     └─────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │ ☐ Send welcome email                                       │ │
│  │ ☐ Auto-invite to Matrix rooms                             │ │
│  │                                                             │ │
│  │                           [Cancel]  [Create User]         │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Matrix Integration Page
```
┌─────────────────────────────────────────────────────────────────┐
│  Matrix Integration                                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Room Management                                             │ │
│  │                                                             │ │
│  │ ┌─────────────────────────────────────────────────────────┐ │ │
│  │ │ 🔍 Search rooms...                    [Sync Rooms]     │ │ │
│  │ └─────────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │ ┌─────────────────────────────────────────────────────────┐ │ │
│  │ │ Room Name        │ Members │ Type    │ Last Activity    │ │ │
│  │ │──────────────────┼─────────┼─────────┼─────────────────│ │ │
│  │ │ #general         │   45    │ Public  │ 2 hours ago     │ │ │
│  │ │ #tech-support    │   23    │ Public  │ 1 hour ago      │ │ │
│  │ │ #announcements   │   89    │ Public  │ 5 hours ago     │ │ │
│  │ │ #random          │   67    │ Public  │ 30 minutes ago  │ │ │
│  │ └─────────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ User Invitations                                            │ │
│  │                                                             │ │
│  │ Select User:  [John Doe            ▼]                      │ │
│  │                                                             │ │
│  │ Recommended Rooms:                                          │ │
│  │ ☐ #general         (Public discussion)                     │ │
│  │ ☐ #tech-support    (Technical help)                        │ │
│  │ ☐ #announcements   (Important updates)                     │ │
│  │                                                             │ │
│  │ ☐ Send welcome message                                     │ │
│  │                                                             │ │
│  │                                      [Invite to Rooms]     │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Admin Dashboard
```
┌─────────────────────────────────────────────────────────────────┐
│  Admin Dashboard                                                │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │  📊 Stats   │ │  📈 Growth  │ │  🔄 Sync    │ │  🚨 Alerts  │ │
│  │    1,234    │ │    +15%     │ │ 2h ago      │ │     3       │ │
│  │ Total Users │ │ This Month  │ │ Completed   │ │   Active    │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                        System Status                        │ │
│  │                                                             │ │
│  │ Database:      🟢 Connected    │ Matrix API:    🟢 Online   │ │
│  │ Authentik:     🟢 Connected    │ Email Service: 🟡 Slow    │ │
│  │ Storage:       🟢 Normal       │ Background Jobs: 🟢 Running│ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      Recent Events                          │ │
│  │                                                             │ │
│  │ [📅 Last 24 hours] [Filter ▼] [Export ▼]                  │ │
│  │                                                             │ │
│  │ Time     │ Event            │ User      │ Details           │ │
│  │──────────┼──────────────────┼───────────┼──────────────────│ │
│  │ 10:30 AM │ User Created     │ admin     │ john_doe         │ │
│  │ 10:15 AM │ Login Success    │ jane_s    │ SSO Auth         │ │
│  │ 09:45 AM │ Matrix Sync      │ system    │ 45 users synced  │ │
│  │ 09:30 AM │ Failed Login     │ unknown   │ Invalid password │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Component Library

### Button Components
```typescript
// Primary Button
<Button variant="primary" size="md">
  Create User
</Button>

// Secondary Button
<Button variant="secondary" size="md">
  Cancel
</Button>

// Ghost Button
<Button variant="ghost" size="sm">
  <Icon name="edit" /> Edit
</Button>

// Danger Button
<Button variant="danger" size="md">
  Delete
</Button>

// Loading Button
<Button variant="primary" loading>
  Saving...
</Button>
```

### Form Components
```typescript
// Input Field
<Input
  label="Username"
  placeholder="Enter username"
  required
  error="Username is required"
/>

// Textarea
<Textarea
  label="Description"
  placeholder="Enter description"
  rows={4}
/>

// Select
<Select
  label="Role"
  placeholder="Select role"
  options={[
    { value: 'user', label: 'User' },
    { value: 'admin', label: 'Admin' }
  ]}
/>

// Checkbox
<Checkbox
  label="Send welcome email"
  checked={sendEmail}
  onChange={setSendEmail}
/>
```

### Data Display Components
```typescript
// Data Table
<DataTable
  data={users}
  columns={columns}
  pagination
  sorting
  filtering
  selection
  actions
/>

// Card
<Card>
  <CardHeader>
    <CardTitle>User Statistics</CardTitle>
  </CardHeader>
  <CardContent>
    <p>Total Users: 1,234</p>
  </CardContent>
</Card>

// Alert
<Alert variant="success">
  <AlertTitle>Success</AlertTitle>
  <AlertDescription>
    User created successfully!
  </AlertDescription>
</Alert>
```

### Navigation Components
```typescript
// Breadcrumb
<Breadcrumb>
  <BreadcrumbItem href="/">Home</BreadcrumbItem>
  <BreadcrumbItem href="/users">Users</BreadcrumbItem>
  <BreadcrumbItem active>Create</BreadcrumbItem>
</Breadcrumb>

// Pagination
<Pagination
  currentPage={page}
  totalPages={totalPages}
  onPageChange={setPage}
/>

// Tab Navigation
<Tabs defaultValue="profile">
  <TabsList>
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="settings">Settings</TabsTrigger>
  </TabsList>
  <TabsContent value="profile">
    Profile content
  </TabsContent>
</Tabs>
```

## Mobile Responsive Design

### Mobile Navigation
```
┌─────────────────────────────────────┐
│ [☰] Community Dashboard        [👤] │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐ │
│  │           Main Content          │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  │                                 │ │
│  └─────────────────────────────────┘ │
│                                     │
├─────────────────────────────────────┤
│  [🏠] [👥] [💬] [⚙️] [👤]          │
└─────────────────────────────────────┘
```

### Mobile Specifications
```typescript
// Mobile-first responsive design
interface MobileNavProps {
  isOpen: boolean
  onToggle: () => void
  items: NavigationItem[]
}

// Features:
- Collapsible hamburger menu
- Bottom navigation bar
- Swipe gestures
- Touch-friendly buttons (44px min)
- Simplified layouts
- Optimized typography
```

## Accessibility Features

### WCAG 2.1 AA Compliance
- **Keyboard Navigation**: All interactive elements accessible via keyboard
- **Screen Reader Support**: Proper ARIA labels and semantic HTML
- **Color Contrast**: Minimum 4.5:1 contrast ratio
- **Focus Management**: Clear focus indicators
- **Alternative Text**: Images have descriptive alt text
- **Error Handling**: Clear error messages and validation

### Accessibility Specifications
```typescript
// Example accessible component
<Button
  aria-label="Create new user"
  aria-describedby="create-user-help"
  onClick={handleCreateUser}
>
  Create User
</Button>
<div id="create-user-help" className="sr-only">
  Opens a form to create a new user account
</div>
```

## Animation & Interactions

### Micro-interactions
```typescript
// Button hover effects
.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

// Loading states
.loading {
  opacity: 0.7;
  pointer-events: none;
}

// Form validation
.input-error {
  border-color: #ef4444;
  animation: shake 0.3s ease-in-out;
}

@keyframes shake {
  0%, 20%, 40%, 60%, 80% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
}
```

### Page Transitions
```typescript
// Smooth page transitions
.page-enter {
  opacity: 0;
  transform: translateX(20px);
}

.page-enter-active {
  opacity: 1;
  transform: translateX(0);
  transition: all 0.3s ease;
}

.page-exit {
  opacity: 1;
  transform: translateX(0);
}

.page-exit-active {
  opacity: 0;
  transform: translateX(-20px);
  transition: all 0.3s ease;
}
```

## Dark Mode Support

### Theme Configuration
```typescript
// Theme variables
const themes = {
  light: {
    background: '#ffffff',
    foreground: '#0f172a',
    primary: '#2563eb',
    secondary: '#64748b',
    accent: '#f1f5f9',
    border: '#e2e8f0',
    input: '#ffffff',
    ring: '#2563eb',
  },
  dark: {
    background: '#0f172a',
    foreground: '#f8fafc',
    primary: '#3b82f6',
    secondary: '#94a3b8',
    accent: '#1e293b',
    border: '#334155',
    input: '#1e293b',
    ring: '#3b82f6',
  }
}
```

### Dark Mode Toggle
```
Light Mode:  [☀️ 🌙]
Dark Mode:   [☀️ 🌙]
```

## Performance Considerations

### Optimization Strategies
- **Lazy Loading**: Load components and images on demand
- **Code Splitting**: Split bundles by route/feature
- **Caching**: Cache API responses and static assets
- **Compression**: Optimize images and assets
- **Tree Shaking**: Remove unused code

### Loading States
```typescript
// Skeleton Loading
<div className="animate-pulse">
  <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
  <div className="h-4 bg-gray-300 rounded w-1/2"></div>
</div>

// Spinner Loading
<div className="flex items-center justify-center">
  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
</div>
```

## Implementation Guidelines

### Development Workflow
1. **Design System First**: Build reusable components
2. **Mobile First**: Start with mobile layouts
3. **Accessibility**: Test with screen readers
4. **Performance**: Monitor bundle sizes
5. **Testing**: Visual regression testing

### Code Standards
```typescript
// Component naming convention
export function UserManagementPage() {
  return (
    <PageLayout>
      <PageHeader title="User Management" />
      <PageContent>
        <UserTable />
      </PageContent>
    </PageLayout>
  )
}

// Props interface
interface UserTableProps {
  users: User[]
  onUserSelect: (user: User) => void
  onUserDelete: (userId: string) => void
  loading?: boolean
  error?: string
}
```

### Testing Strategy
```typescript
// Component testing
describe('UserTable', () => {
  it('renders user data correctly', () => {
    render(<UserTable users={mockUsers} />)
    expect(screen.getByText('john_doe')).toBeInTheDocument()
  })
  
  it('handles user selection', () => {
    const onSelect = jest.fn()
    render(<UserTable users={mockUsers} onUserSelect={onSelect} />)
    fireEvent.click(screen.getByText('john_doe'))
    expect(onSelect).toHaveBeenCalledWith(mockUsers[0])
  })
})
```

## Migration from Streamlit

### Visual Improvements
- **Modern Design**: Contemporary UI vs Streamlit's basic styling
- **Responsive Layout**: Mobile-first vs desktop-only
- **Consistent Branding**: Unified design language
- **Better UX**: Intuitive navigation and interactions

### Functionality Enhancements
- **Real-time Updates**: Live data without page refresh
- **Better Performance**: Faster loading and interactions
- **Accessibility**: WCAG compliant design
- **Keyboard Navigation**: Full keyboard support

### Migration Steps
1. **Component Audit**: Map Streamlit components to modern equivalents
2. **Design System**: Create consistent component library
3. **Layout Migration**: Recreate page layouts with modern patterns
4. **Feature Parity**: Ensure all features are preserved
5. **User Testing**: Validate with actual users

## Conclusion

This UI design specification provides a comprehensive blueprint for creating a modern, accessible, and user-friendly Community Dashboard. The design system ensures consistency across all components while providing flexibility for future enhancements.

The migration from Streamlit to this modern interface will significantly improve user experience, performance, and maintainability while preserving all existing functionality.

---

*This design specification serves as the foundation for implementing the modern Community Dashboard user interface.* 