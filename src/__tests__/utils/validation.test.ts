import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'

// Test validation schemas
const userSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email address'),
  fullName: z.string().min(1, 'Full name is required'),
})

const matrixMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(1000, 'Message too long'),
  roomId: z.string().min(1, 'Room ID is required'),
})

describe('Validation Schemas', () => {
  describe('User Schema', () => {
    it('should validate correct user data', () => {
      const validUser = {
        username: 'testuser',
        email: 'test@example.com',
        fullName: 'Test User',
      }

      const result = userSchema.safeParse(validUser)
      expect(result.success).toBe(true)
    })

    it('should reject invalid email', () => {
      const invalidUser = {
        username: 'testuser',
        email: 'invalid-email',
        fullName: 'Test User',
      }

      const result = userSchema.safeParse(invalidUser)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Invalid email address')
      }
    })

    it('should reject short username', () => {
      const invalidUser = {
        username: 'ab',
        email: 'test@example.com',
        fullName: 'Test User',
      }

      const result = userSchema.safeParse(invalidUser)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Username must be at least 3 characters')
      }
    })

    it('should reject empty full name', () => {
      const invalidUser = {
        username: 'testuser',
        email: 'test@example.com',
        fullName: '',
      }

      const result = userSchema.safeParse(invalidUser)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Full name is required')
      }
    })
  })

  describe('Matrix Message Schema', () => {
    it('should validate correct message data', () => {
      const validMessage = {
        message: 'Hello, world!',
        roomId: '!room123:example.com',
      }

      const result = matrixMessageSchema.safeParse(validMessage)
      expect(result.success).toBe(true)
    })

    it('should reject empty message', () => {
      const invalidMessage = {
        message: '',
        roomId: '!room123:example.com',
      }

      const result = matrixMessageSchema.safeParse(invalidMessage)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Message cannot be empty')
      }
    })

    it('should reject message that is too long', () => {
      const invalidMessage = {
        message: 'a'.repeat(1001),
        roomId: '!room123:example.com',
      }

      const result = matrixMessageSchema.safeParse(invalidMessage)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Message too long')
      }
    })

    it('should reject missing room ID', () => {
      const invalidMessage = {
        message: 'Hello, world!',
        roomId: '',
      }

      const result = matrixMessageSchema.safeParse(invalidMessage)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Room ID is required')
      }
    })
  })
})

describe('Utility Functions', () => {
  it('should format username correctly', () => {
    const formatUsername = (username: string) => {
      return username.toLowerCase().replace(/[^a-z0-9]/g, '')
    }
    
    expect(formatUsername('Test User 123')).toBe('testuser123')
    expect(formatUsername('John.Doe@example.com')).toBe('johndoeexamplecom')
    expect(formatUsername('user-name_123')).toBe('username123')
  })

  it('should validate email format', () => {
    const isValidEmail = (email: string) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email)
    }
    
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true)
    expect(isValidEmail('invalid-email')).toBe(false)
    expect(isValidEmail('test@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
  })

  it('should truncate long text', () => {
    const truncateText = (text: string, maxLength: number) => {
      if (text.length <= maxLength) return text
      return text.slice(0, maxLength) + '...'
    }
    
    expect(truncateText('Short text', 20)).toBe('Short text')
    expect(truncateText('This is a very long text that should be truncated', 20)).toBe('This is a very long...')
    expect(truncateText('', 10)).toBe('')
  })
}) 