const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Simple password hashing function using crypto
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function createAdmin() {
  try {
    console.log('🔍 Checking for existing admin user...');
    
    const existingAdmin = await prisma.user.findUnique({
      where: { username: 'admin' }
    });
    
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      return;
    }
    
    console.log('🔐 Creating admin user...');
    const hashedPassword = hashPassword('shareme314');
    
    const adminUser = await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@irregularchat.com',
        firstName: 'Admin',
        lastName: 'User',
        password: hashedPassword,
        isAdmin: true,
        isModerator: true,
        isActive: true,
      },
    });
    
    console.log('✅ Admin user created successfully:', adminUser.username);
    console.log('📧 Email:', adminUser.email);
    console.log('🔑 Password: shareme314');
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin(); 