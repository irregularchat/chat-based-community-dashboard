# Component Mapping Guide: Streamlit to Modern Stack

## Overview

This document provides a comprehensive mapping of all Streamlit components used in the Community Dashboard to their modern stack equivalents. Each mapping includes implementation details, migration complexity, and code examples.

## Authentication & Session Management

### Session State Management
**Current (Streamlit)**:
```python
# Authentication state
st.session_state['is_authenticated'] = True
st.session_state['is_admin'] = False
st.session_state['user_info'] = user_data
st.session_state['access_token'] = token

# Form state
st.session_state['form_data'] = {...}
st.session_state['selected_users'] = []
```

**Modern Stack (NextAuth.js + Zustand)**:
```typescript
// Authentication state (NextAuth.js)
const { data: session, status } = useSession()
const isAuthenticated = status === 'authenticated'
const user = session?.user
const isAdmin = user?.role === 'admin'

// Application state (Zustand)
interface AppState {
  selectedUsers: string[]
  formData: Record<string, any>
  setSelectedUsers: (users: string[]) => void
  setFormData: (data: Record<string, any>) => void
}

const useAppStore = create<AppState>((set) => ({
  selectedUsers: [],
  formData: {},
  setSelectedUsers: (users) => set({ selectedUsers: users }),
  setFormData: (data) => set({ formData: data })
}))
```

**Migration Complexity**: High
**Files Affected**: All auth files, main.py, UI components

### Authentication Middleware
**Current (Streamlit)**:
```python
# app/auth/auth_middleware.py
def auth_middleware(page_function):
    def wrapper(*args, **kwargs):
        if not is_authenticated():
            display_login_button()
            return
        return page_function(*args, **kwargs)
    return wrapper
```

**Modern Stack (Next.js Middleware)**:
```typescript
// middleware.ts
import { withAuth } from 'next-auth/middleware'

export default withAuth(
  function middleware(req) {
    // Additional logic if needed
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Check if user is authenticated
        if (!token) return false
        
        // Check admin routes
        if (req.nextUrl.pathname.startsWith('/admin')) {
          return token.role === 'admin'
        }
        
        return true
      }
    }
  }
)

export const config = {
  matcher: ['/admin/:path*', '/protected/:path*']
}
```

**Migration Complexity**: Medium
**Files Affected**: auth_middleware.py, main.py

## UI Components

### Forms
**Current (Streamlit)**:
```python
# app/ui/forms.py
with st.form("user_form"):
    username = st.text_input("Username", key="username")
    email = st.text_input("Email", key="email")
    full_name = st.text_input("Full Name", key="full_name")
    
    col1, col2 = st.columns(2)
    with col1:
        submit = st.form_submit_button("Create User")
    with col2:
        cancel = st.form_submit_button("Cancel")
```

**Modern Stack (React Hook Form + Zod)**:
```typescript
// components/forms/UserForm.tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const userSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Invalid email'),
  fullName: z.string().min(1, 'Full name is required')
})

type UserFormData = z.infer<typeof userSchema>

export function UserForm() {
  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      username: '',
      email: '',
      fullName: ''
    }
  })

  const onSubmit = (data: UserFormData) => {
    // Handle form submission
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex gap-2">
          <Button type="submit">Create User</Button>
          <Button type="button" variant="outline">Cancel</Button>
        </div>
      </form>
    </Form>
  )
}
```

**Migration Complexity**: High
**Files Affected**: app/ui/forms.py, app/ui/forms_components/create_user.py

### Data Tables
**Current (Streamlit)**:
```python
# app/ui/forms.py
st.dataframe(
    users_df,
    use_container_width=True,
    height=400,
    column_config={
        "username": st.column_config.TextColumn("Username"),
        "email": st.column_config.TextColumn("Email"),
        "status": st.column_config.CheckboxColumn("Active")
    }
)

# Pagination workaround
page_size = st.selectbox("Page size", [50, 100, 250])
page = st.selectbox("Page", range(1, total_pages + 1))
```

**Modern Stack (TanStack Table)**:
```typescript
// components/tables/UserTable.tsx
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel } from '@tanstack/react-table'

const columns = [
  {
    accessorKey: 'username',
    header: 'Username',
    cell: ({ row }) => <div>{row.getValue('username')}</div>
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => <div>{row.getValue('email')}</div>
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={row.getValue('status') ? 'default' : 'secondary'}>
        {row.getValue('status') ? 'Active' : 'Inactive'}
      </Badge>
    )
  }
]

export function UserTable({ data }: { data: User[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  return (
    <div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map(row => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map(cell => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows per page</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={value => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 30, 40, 50].map(pageSize => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Migration Complexity**: Medium
**Files Affected**: app/ui/forms.py, app/ui/admin.py

### Navigation
**Current (Streamlit)**:
```python
# app/main.py
st.sidebar.title("Navigation")
page_options = ["Create User", "List & Manage Users", "Admin Dashboard"]
selected_page = st.sidebar.selectbox("Select Page", page_options)

if selected_page == "Create User":
    render_create_user_page()
elif selected_page == "List & Manage Users":
    render_user_list_page()
```

**Modern Stack (Next.js Navigation)**:
```typescript
// components/navigation/Sidebar.tsx
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const navigation = [
  { name: 'Create User', href: '/users/create', icon: UserPlus },
  { name: 'Manage Users', href: '/users', icon: Users },
  { name: 'Admin Dashboard', href: '/admin', icon: Shield }
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-gray-50">
      <div className="flex flex-col grow pt-5 pb-4 overflow-y-auto">
        <nav className="flex-1 px-2 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'group flex items-center px-2 py-2 text-sm font-medium rounded-md',
                  isActive 
                    ? 'bg-gray-200 text-gray-900' 
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <item.icon className="mr-3 h-6 w-6" />
                {item.name}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
```

**Migration Complexity**: Medium
**Files Affected**: app/main.py

### Layout Components
**Current (Streamlit)**:
```python
# Layout patterns
col1, col2, col3 = st.columns([1, 2, 1])
with col1:
    st.write("Left column")
with col2:
    st.write("Center column")
with col3:
    st.write("Right column")

# Expandable sections
with st.expander("Advanced Options"):
    st.write("Expandable content")

# Tabs
tab1, tab2, tab3 = st.tabs(["Tab 1", "Tab 2", "Tab 3"])
with tab1:
    st.write("Tab 1 content")
```

**Modern Stack (Tailwind CSS + Shadcn/ui)**:
```typescript
// Layout with CSS Grid/Flexbox
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <div className="col-span-1">Left column</div>
  <div className="col-span-2">Center column</div>
  <div className="col-span-1">Right column</div>
</div>

// Expandable sections (Accordion)
<Accordion type="single" collapsible>
  <AccordionItem value="advanced">
    <AccordionTrigger>Advanced Options</AccordionTrigger>
    <AccordionContent>
      Expandable content
    </AccordionContent>
  </AccordionItem>
</Accordion>

// Tabs
<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
    <TabsTrigger value="tab3">Tab 3</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Tab 1 content</TabsContent>
  <TabsContent value="tab2">Tab 2 content</TabsContent>
  <TabsContent value="tab3">Tab 3 content</TabsContent>
</Tabs>
```

**Migration Complexity**: Low
**Files Affected**: All UI files

## Input Components

### Text Inputs
**Current (Streamlit)**:
```python
username = st.text_input("Username", key="username")
email = st.text_input("Email", key="email")
description = st.text_area("Description", key="description", height=100)
```

**Modern Stack (Shadcn/ui)**:
```typescript
<div className="space-y-4">
  <div>
    <Label htmlFor="username">Username</Label>
    <Input
      id="username"
      type="text"
      placeholder="Enter username"
      {...register('username')}
    />
  </div>
  
  <div>
    <Label htmlFor="email">Email</Label>
    <Input
      id="email"
      type="email"
      placeholder="Enter email"
      {...register('email')}
    />
  </div>
  
  <div>
    <Label htmlFor="description">Description</Label>
    <Textarea
      id="description"
      placeholder="Enter description"
      rows={4}
      {...register('description')}
    />
  </div>
</div>
```

**Migration Complexity**: Low
**Files Affected**: All form files

### Select Components
**Current (Streamlit)**:
```python
status = st.selectbox("Status", ["Active", "Inactive"], key="status")
users = st.multiselect("Select Users", user_options, key="selected_users")
```

**Modern Stack (Shadcn/ui)**:
```typescript
<div className="space-y-4">
  <div>
    <Label>Status</Label>
    <Select onValueChange={setValue}>
      <SelectTrigger>
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="inactive">Inactive</SelectItem>
      </SelectContent>
    </Select>
  </div>
  
  <div>
    <Label>Select Users</Label>
    <MultiSelect
      options={userOptions}
      value={selectedUsers}
      onValueChange={setSelectedUsers}
      placeholder="Select users"
    />
  </div>
</div>
```

**Migration Complexity**: Low
**Files Affected**: All form files

### File Upload
**Current (Streamlit)**:
```python
uploaded_file = st.file_uploader("Choose a file", type=['csv', 'txt'])
if uploaded_file is not None:
    # Process file
    content = uploaded_file.read()
```

**Modern Stack (Custom Component)**:
```typescript
// components/ui/FileUpload.tsx
export function FileUpload({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onFileSelect(file)
    }
  }

  return (
    <div className="flex items-center justify-center w-full">
      <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <Upload className="w-10 h-10 mb-3 text-gray-400" />
          <p className="mb-2 text-sm text-gray-500">
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-500">CSV or TXT files only</p>
        </div>
        <input
          type="file"
          className="hidden"
          accept=".csv,.txt"
          onChange={handleFileChange}
        />
      </label>
    </div>
  )
}
```

**Migration Complexity**: Medium
**Files Affected**: Files with file upload functionality

## Display Components

### Alerts and Messages
**Current (Streamlit)**:
```python
st.success("User created successfully!")
st.error("Failed to create user")
st.warning("Please check the input")
st.info("Information message")
```

**Modern Stack (Shadcn/ui)**:
```typescript
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'

// Success
<Alert className="border-green-200 bg-green-50">
  <CheckCircle className="h-4 w-4 text-green-600" />
  <AlertDescription className="text-green-800">
    User created successfully!
  </AlertDescription>
</Alert>

// Error
<Alert variant="destructive">
  <XCircle className="h-4 w-4" />
  <AlertDescription>
    Failed to create user
  </AlertDescription>
</Alert>

// Warning
<Alert className="border-yellow-200 bg-yellow-50">
  <AlertTriangle className="h-4 w-4 text-yellow-600" />
  <AlertDescription className="text-yellow-800">
    Please check the input
  </AlertDescription>
</Alert>
```

**Migration Complexity**: Low
**Files Affected**: All UI files

### Progress Indicators
**Current (Streamlit)**:
```python
progress_bar = st.progress(0)
for i in range(100):
    progress_bar.progress(i + 1)
    time.sleep(0.1)

# Spinner
with st.spinner("Loading..."):
    # Long running operation
    time.sleep(5)
```

**Modern Stack (Shadcn/ui)**:
```typescript
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'

// Progress bar
<Progress value={progress} className="w-full" />

// Spinner
<div className="flex items-center justify-center">
  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  <span>Loading...</span>
</div>

// Loading button
<Button disabled={isLoading}>
  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  {isLoading ? 'Loading...' : 'Submit'}
</Button>
```

**Migration Complexity**: Low
**Files Affected**: Files with progress indicators

## Data Fetching & Caching

### Caching
**Current (Streamlit)**:
```python
@st.cache_data
def get_users():
    return fetch_users_from_db()

@st.cache_data
def get_user_details(user_id):
    return fetch_user_details(user_id)
```

**Modern Stack (React Query)**:
```typescript
// hooks/useUsers.ts
import { useQuery } from '@tanstack/react-query'

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 5 * 60 * 1000 // 5 minutes
  })
}

export function useUserDetails(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUserDetails(userId),
    enabled: !!userId
  })
}

// Component usage
function UserList() {
  const { data: users, isLoading, error } = useUsers()
  
  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  
  return (
    <div>
      {users?.map(user => (
        <UserCard key={user.id} user={user} />
      ))}
    </div>
  )
}
```

**Migration Complexity**: Medium
**Files Affected**: All files with data fetching

## Custom Styling

### CSS Injection
**Current (Streamlit)**:
```python
st.markdown("""
<style>
.custom-class {
    background-color: #f0f0f0;
    padding: 20px;
    border-radius: 10px;
}
</style>
""", unsafe_allow_html=True)
```

**Modern Stack (Tailwind CSS)**:
```typescript
// Direct styling with Tailwind classes
<div className="bg-gray-100 p-5 rounded-lg">
  Content
</div>

// Custom CSS classes (if needed)
// styles/globals.css
@layer components {
  .custom-card {
    @apply bg-gray-100 p-5 rounded-lg shadow-md;
  }
}
```

**Migration Complexity**: Low
**Files Affected**: app/ui/components.py, app/streamlit_app.py

## API Integration

### API Calls
**Current (Streamlit)**:
```python
# Direct API calls in components
def create_user_api(user_data):
    response = requests.post(f"{API_URL}/users", json=user_data)
    return response.json()

# In component
if st.button("Create User"):
    result = create_user_api(form_data)
    if result['success']:
        st.success("User created!")
```

**Modern Stack (tRPC)**:
```typescript
// server/api/routers/users.ts
export const userRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      username: z.string(),
      email: z.string().email(),
      fullName: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.user.create({
        data: input
      })
      return user
    }),
    
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return await ctx.db.user.findMany()
    })
})

// Client usage
function CreateUserForm() {
  const utils = api.useUtils()
  const createUser = api.user.create.useMutation({
    onSuccess: () => {
      toast.success('User created successfully!')
      utils.user.list.invalidate()
    },
    onError: (error) => {
      toast.error(error.message)
    }
  })
  
  const handleSubmit = (data: UserFormData) => {
    createUser.mutate(data)
  }
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
      <Button type="submit" disabled={createUser.isLoading}>
        {createUser.isLoading ? 'Creating...' : 'Create User'}
      </Button>
    </form>
  )
}
```

**Migration Complexity**: High
**Files Affected**: All files with API calls

## Migration Priority Matrix

| Component Category | Complexity | Priority | Estimated Effort |
|-------------------|------------|----------|------------------|
| Session State | High | High | 2 weeks |
| Authentication | High | High | 2 weeks |
| Forms | High | High | 2 weeks |
| Data Tables | Medium | High | 1 week |
| Navigation | Medium | Medium | 1 week |
| API Integration | High | Medium | 1 week |
| Layout Components | Low | Medium | 3 days |
| Input Components | Low | Low | 3 days |
| Display Components | Low | Low | 2 days |
| Custom Styling | Low | Low | 2 days |

## Next Steps

1. **Week 1**: Complete detailed analysis of each component
2. **Week 2**: Create reusable component library
3. **Week 3-4**: Implement authentication system
4. **Week 5-8**: Migrate core functionality
5. **Week 9-12**: Advanced features and integrations

---

*This mapping guide will be updated as the migration progresses and new patterns are identified.* 