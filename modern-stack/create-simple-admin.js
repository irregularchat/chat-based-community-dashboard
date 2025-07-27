const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    console.log('🔍 Checking for existing admin user...');
    
    const adminEmail = 'admin@example.com';
    
    const existingAdmin = await prisma.user.findFirst({
      where: { email: adminEmail }
    });
    
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log('📧 Email:', existingAdmin.email);
      console.log('🔑 Is Admin:', existingAdmin.isAdmin);
      
      // Update admin status if needed
      if (!existingAdmin.isAdmin) {
        await prisma.user.update({
          where: { id: existingAdmin.id },
          data: {
            isAdmin: true,
            isModerator: true,
          }
        });
        console.log('✅ Admin privileges updated');
      }
      return;
    }
    
    console.log('🔐 Creating admin user...');
    
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin User',
        isAdmin: true,
        isModerator: true,
        emailVerified: new Date(),
      }
    });
    
    console.log('✅ Admin user created successfully!');
    console.log('📧 Email:', adminUser.email);
    console.log('👤 Name:', adminUser.name);
    console.log('🔑 Is Admin:', adminUser.isAdmin);
    console.log('🔑 Is Moderator:', adminUser.isModerator);
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
