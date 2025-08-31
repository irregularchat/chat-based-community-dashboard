#!/usr/bin/env node

/**
 * Script to create an admin user in the local database
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function createAdmin() {
  const username = 'admin';
  const password = 'admin123'; // Default password
  const email = 'admin@localhost';
  
  try {
    // Check if admin already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { username }
    });

    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log(`  Username: ${username}`);
      console.log(`  Email: ${existingAdmin.email}`);
      
      // Update password if needed
      const hashedPassword = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { username },
        data: { 
          password: hashedPassword,
          isActive: true,
          isAdmin: true
        }
      });
      console.log('  Password updated to: admin123');
      
    } else {
      // Create new admin
      const hashedPassword = await bcrypt.hash(password, 12);
      
      const admin = await prisma.user.create({
        data: {
          username,
          email,
          password: hashedPassword,
          firstName: 'Admin',
          lastName: 'User',
          isActive: true,
          isAdmin: true,
          isModerator: true
        }
      });
      
      console.log('✅ Admin user created successfully!');
      console.log(`  Username: ${username}`);
      console.log(`  Password: ${password}`);
      console.log(`  Email: ${email}`);
    }
    
    console.log('\n📝 You can now login with:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log(`  URL: http://localhost:3003/auth/signin`);
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin().catch(console.error);