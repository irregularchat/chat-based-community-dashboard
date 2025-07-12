import { PrismaClient } from '../src/generated/prisma';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a test admin user
  const hashedPassword = await bcrypt.hash('admin123', 12);
  
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      isAdmin: true,
      isModerator: true,
      isActive: true,
    },
  });

  console.log('✅ Created admin user:', adminUser.username);

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
  console.log('   Admin:     username: admin     | password: admin123');
  console.log('   Moderator: username: moderator | password: mod123');  
  console.log('   User:      username: user      | password: user123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 