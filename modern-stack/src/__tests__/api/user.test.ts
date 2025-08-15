import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { appRouter } from '@/lib/trpc/root'

// Mock the database
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { db as mockDb } from '@/lib/db'

describe('User Router', () => {
  const mockUser = {
    id: '1',
    username: 'testuser',
    email: 'test@example.com',
    fullName: 'Test User',
    isActive: true,
    isAdmin: false,
    isModerator: false,
    lastLogin: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
  }

  const mockContext = {
    prisma: mockDb,
    session: {
      user: {
        id: 'admin',
        isAdmin: true,
        isModerator: true,
      },
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('list', () => {
    it('should return users with pagination', async () => {
      mockDb.user.findMany.mockResolvedValue([mockUser])
      mockDb.user.count.mockResolvedValue(1)

      const caller = appRouter.createCaller(mockContext)
      const result = await caller.user.list({
        page: 1,
        pageSize: 50,
      })

      expect(result.users).toHaveLength(1)
      expect(result.pagination.total).toBe(1)
      expect(result.pagination.page).toBe(1)
    })

    it('should filter users by search term', async () => {
      mockDb.user.findMany.mockResolvedValue([mockUser])
      mockDb.user.count.mockResolvedValue(1)

      const caller = appRouter.createCaller(mockContext)
      await caller.user.list({
        page: 1,
        pageSize: 50,
        search: 'test',
      })

      expect(mockDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { username: { contains: 'test', mode: 'insensitive' } },
              { email: { contains: 'test', mode: 'insensitive' } },
              { fullName: { contains: 'test', mode: 'insensitive' } },
            ]),
          }),
        })
      )
    })
  })

  describe('getById', () => {
    it('should return user by id', async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser)

      const caller = appRouter.createCaller(mockContext)
      const result = await caller.user.getById({ id: '1' })

      expect(result).toEqual(mockUser)
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: expect.any(Object),
      })
    })

    it('should throw error if user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const caller = appRouter.createCaller(mockContext)
      await expect(caller.user.getById({ id: '999' })).rejects.toThrow(
        'User not found'
      )
    })
  })

  describe('create', () => {
    it('should create new user', async () => {
      mockDb.user.findFirst.mockResolvedValue(null)
      mockDb.user.create.mockResolvedValue(mockUser)

      const caller = appRouter.createCaller(mockContext)
      const result = await caller.user.create({
        username: 'testuser',
        email: 'test@example.com',
        fullName: 'Test User',
      })

      expect(result).toEqual(mockUser)
      expect(mockDb.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'testuser',
          email: 'test@example.com',
          fullName: 'Test User',
        }),
      })
    })

    it('should throw error if username already exists', async () => {
      mockDb.user.findFirst.mockResolvedValue(mockUser)

      const caller = appRouter.createCaller(mockContext)
      await expect(
        caller.user.create({
          username: 'testuser',
          email: 'test@example.com',
          fullName: 'Test User',
        })
      ).rejects.toThrow('Username or email already exists')
    })
  })

  describe('update', () => {
    it('should update user', async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser)
      mockDb.user.update.mockResolvedValue({ ...mockUser, fullName: 'Updated User' })

      const caller = appRouter.createCaller(mockContext)
      const result = await caller.user.update({
        id: '1',
        fullName: 'Updated User',
      })

      expect(result.fullName).toBe('Updated User')
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { fullName: 'Updated User' },
      })
    })

    it('should throw error if user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const caller = appRouter.createCaller(mockContext)
      await expect(
        caller.user.update({
          id: '999',
          fullName: 'Updated User',
        })
      ).rejects.toThrow('User not found')
    })
  })

  describe('delete', () => {
    it('should soft delete user', async () => {
      mockDb.user.findUnique.mockResolvedValue(mockUser)
      mockDb.user.update.mockResolvedValue({ ...mockUser, isActive: false })

      const caller = appRouter.createCaller(mockContext)
      const result = await caller.user.delete({ id: '1' })

      expect(result.success).toBe(true)
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { isActive: false },
      })
    })

    it('should throw error if user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      const caller = appRouter.createCaller(mockContext)
      await expect(caller.user.delete({ id: '999' })).rejects.toThrow(
        'User not found'
      )
    })
  })
}) 