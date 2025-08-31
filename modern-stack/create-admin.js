const { PrismaClient } = require('./src/generated/prisma');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    console.log('🔍 Checking for existing admin user...');
    
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'shareme314';
    
    console.log(`🔐 Admin username: ${adminUsername}`);
    console.log(`🔐 Admin password: ${adminPassword.replace(/./g, '*')}`);
    
    const existingAdmin = await prisma.user.findUnique({
      where: { username: adminUsername }
    });
    
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log('📧 Email:', existingAdmin.email);
      console.log('🔑 Is Admin:', existingAdmin.isAdmin);
      console.log('🔑 Is Active:', existingAdmin.isActive);
      
      // Update password if needed
      console.log('🔄 Updating admin password...');
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      
      await prisma.user.update({
        where: { username: adminUsername },
        data: {
          password: hashedPassword,
          isAdmin: true,
          isModerator: true,
          isActive: true,
        }
      });
      
      console.log('✅ Admin user password updated');
      return;
    }
    
    console.log('🔐 Creating admin user...');
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    const adminUser = await prisma.user.create({
      data: {
        username: adminUsername,
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
    console.log('🔑 Password:', adminPassword);
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin(); 