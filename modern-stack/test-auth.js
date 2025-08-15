const bcrypt = require('bcrypt');
const { PrismaClient } = require('./src/generated/prisma');

const prisma = new PrismaClient();

async function testAuth() {
  try {
    // Test the password directly
    const testPassword = 'shareme314';
    const hashedPassword = await bcrypt.hash(testPassword, 12);
    console.log('Test hash:', hashedPassword);
    
    // Get the admin user
    const user = await prisma.user.findUnique({
      where: { username: 'admin' }
    });
    
    if (!user) {
      console.log('Admin user not found');
      return;
    }
    
    console.log('Admin user found:', {
      id: user.id,
      username: user.username,
      email: user.email,
      hasPassword: !!user.password,
      isAdmin: user.isAdmin
    });
    
    if (user.password) {
      // Test password comparison
      const isValid = await bcrypt.compare(testPassword, user.password);
      console.log('Password validation result:', isValid);
      
      // Try with the stored password directly
      console.log('Stored password hash (first 20 chars):', user.password.substring(0, 20));
    } else {
      console.log('User has no password set');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAuth();