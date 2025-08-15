import { render, screen, waitFor } from '@testing-library/react'
import { trpc } from '@/lib/trpc/client'
import UsersPage from '@/app/users/page'

// Define types for test mock data
type MockQueryResult<T> = {
  data: T | undefined
  isLoading: boolean
  error: { message: string } | null
}

// Mock the tRPC API
jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    user: {
      list: {
        useQuery: jest.fn(),
      },
    },
  },
}))

const mockTrpc = trpc as jest.Mocked<typeof trpc>

describe('UsersPage', () => {
  const mockUsers = [
    {
      id: '1',
      username: 'testuser1',
      email: 'test1@example.com',
      fullName: 'Test User 1',
      isActive: true,
      isAdmin: false,
      isModerator: false,
      lastLogin: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
    },
    {
      id: '2',
      username: 'testuser2',
      email: 'test2@example.com',
      fullName: 'Test User 2',
      isActive: false,
      isAdmin: true,
      isModerator: false,
      lastLogin: new Date('2024-01-02'),
      createdAt: new Date('2024-01-02'),
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders loading state initially', () => {
    mockTrpc.user.list.useQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as MockQueryResult<{ users: typeof mockUsers; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>)

    render(<UsersPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders users list when data is loaded', async () => {
    mockTrpc.user.list.useQuery.mockReturnValue({
      data: {
        users: mockUsers,
        pagination: {
          page: 1,
          pageSize: 50,
          total: 2,
          totalPages: 1,
        },
      },
      isLoading: false,
      error: null,
    } as MockQueryResult<{ users: typeof mockUsers; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>)

    render(<UsersPage />)

    await waitFor(() => {
      expect(screen.getByText('testuser1')).toBeInTheDocument()
      expect(screen.getByText('testuser2')).toBeInTheDocument()
    })
  })

  it('renders error state when API fails', () => {
    mockTrpc.user.list.useQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: { message: 'Failed to load users' },
    } as MockQueryResult<{ users: typeof mockUsers; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>)

    render(<UsersPage />)
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('displays user information correctly', async () => {
    mockTrpc.user.list.useQuery.mockReturnValue({
      data: {
        users: mockUsers,
        pagination: {
          page: 1,
          pageSize: 50,
          total: 2,
          totalPages: 1,
        },
      },
      isLoading: false,
      error: null,
    } as MockQueryResult<{ users: typeof mockUsers; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>)

    render(<UsersPage />)

    await waitFor(() => {
      expect(screen.getByText('testuser1')).toBeInTheDocument()
      expect(screen.getByText('test1@example.com')).toBeInTheDocument()
      expect(screen.getByText('Test User 1')).toBeInTheDocument()
    })
  })
}) 