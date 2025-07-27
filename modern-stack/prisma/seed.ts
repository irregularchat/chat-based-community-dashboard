import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Get admin credentials from environment variables
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'shareme314';
  const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  
  console.log(`🔐 Admin username: ${adminUsername}`);
  console.log(`🔐 Admin password: ${adminPassword.replace(/./g, '*')}`);

  try {
    // Create admin user with your existing credentials
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@irregularchat.com' },
      update: {
        isAdmin: true,
        isModerator: true,
        firstName: 'Admin',
        lastName: 'User',
      },
      create: {
        email: 'admin@irregularchat.com',
        firstName: 'Admin',
        lastName: 'User',
        isAdmin: true,
        isModerator: true,
      },
    });

    console.log('✅ Created admin user:', `${adminUser.firstName} ${adminUser.lastName}`);
    console.log('✅ Admin user email:', adminUser.email);
    console.log('✅ Admin user ID:', adminUser.id);
    console.log('✅ Is Admin:', adminUser.isAdmin);
    console.log('✅ Is Moderator:', adminUser.isModerator);

    // Create a test regular user
    const regularUser = await prisma.user.upsert({
      where: { email: 'user@example.com' },
      update: {},
      create: {
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        isAdmin: false,
        isModerator: false,
      },
    });

    console.log('✅ Created regular user:', regularUser.name);

    // Create a test moderator user
    const moderatorUser = await prisma.user.upsert({
      where: { email: 'moderator@example.com' },
      update: {},
      create: {
        email: 'moderator@example.com',
        name: 'Moderator User',
        isAdmin: false,
        isModerator: true,
      },
    });

    console.log('✅ Created moderator user:', moderatorUser.name);

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n👤 Test Users Created:');
    console.log(`   Admin:     email: admin@irregularchat.com`);
    console.log('   Moderator: email: moderator@example.com');  
    console.log('   User:      email: user@example.com');
    
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error; // Re-throw to ensure the process exits with error
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 