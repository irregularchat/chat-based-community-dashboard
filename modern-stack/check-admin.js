const { PrismaClient } = require('./src/generated/prisma');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function checkAdmin() {
  try {
    console.log('🔍 Checking admin user status...\n');
    
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'shareme314';
    
    console.log(`🔐 Expected admin username: ${adminUsername}`);
    console.log(`🔐 Expected admin password: ${adminPassword.replace(/./g, '*')}\n`);
    
    // Check if admin user exists
    const adminUser = await prisma.user.findUnique({
      where: { username: adminUsername }
    });
    
    if (!adminUser) {
      console.log('❌ Admin user not found!');
      console.log('💡 To create admin user, run: node create-admin.js');
      process.exit(1);
    }
    
    console.log('✅ Admin user found:');
    console.log(`   Username: ${adminUser.username}`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Is Admin: ${adminUser.isAdmin}`);
    console.log(`   Is Active: ${adminUser.isActive}`);
    console.log(`   Is Moderator: ${adminUser.isModerator}`);
    console.log(`   Date Joined: ${adminUser.dateJoined}`);
    console.log(`   Has Password: ${adminUser.password ? 'Yes' : 'No'}`);
    
    // Test password if provided
    if (adminUser.password) {
      const passwordMatch = await bcrypt.compare(adminPassword, adminUser.password);
      console.log(`   Password Match: ${passwordMatch ? '✅ Yes' : '❌ No'}`);
      
      if (!passwordMatch) {
        console.log('\n⚠️  Password mismatch! Run: node create-admin.js to update password');
      }
    }
    
    // Check total user count
    const totalUsers = await prisma.user.count();
    console.log(`\n📊 Total users in database: ${totalUsers}`);
    
    // Check other admin users
    const allAdmins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { username: true, email: true, isActive: true }
    });
    
    console.log(`\n👥 All admin users (${allAdmins.length}):`);
    allAdmins.forEach(admin => {
      console.log(`   - ${admin.username} (${admin.email}) - ${admin.isActive ? 'Active' : 'Inactive'}`);
    });
    
    console.log('\n🎉 Admin user check completed successfully!');
    
  } catch (error) {
    console.error('❌ Error checking admin user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdmin(); 