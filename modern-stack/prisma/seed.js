const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcryptjs');

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
      where: { username: adminUsername },
      update: {
        password: hashedPassword,
        isAdmin: true,
        isModerator: true,
        isActive: true,
        email: 'admin@irregularchat.com', // Ensure email is set on update too
      },
      create: {
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

    console.log('✅ Created admin user:', adminUser.username);
    console.log('✅ Admin user email:', adminUser.email);
    console.log('✅ Admin user ID:', adminUser.id);
    console.log('✅ Is Admin:', adminUser.isAdmin);
    console.log('✅ Is Active:', adminUser.isActive);

    // Create a test regular user
    const regularUser = await prisma.user.upsert({
      where: { username: 'user' },
      update: {},
      create: {
        username: 'user',
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: await bcrypt.hash('user123', 12),
        isAdmin: false,
        isModerator: false,
        isActive: true,
      },
    });

    console.log('✅ Created regular user:', regularUser.username);

    // Create a test moderator user
    const moderatorUser = await prisma.user.upsert({
      where: { username: 'moderator' },
      update: {},
      create: {
        username: 'moderator',
        email: 'moderator@example.com',
        firstName: 'Moderator',
        lastName: 'User',
        password: await bcrypt.hash('mod123', 12),
        isAdmin: false,
        isModerator: true,
        isActive: true,
      },
    });

    console.log('✅ Created moderator user:', moderatorUser.username);

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n👤 Test Users Created:');
    console.log(`   Admin:     username: ${adminUsername}     | password: ${adminPassword}`);
    console.log('   Moderator: username: moderator | password: mod123');  
    console.log('   User:      username: user      | password: user123');
    
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error; // Re-throw to ensure the process exits with error
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  }); 