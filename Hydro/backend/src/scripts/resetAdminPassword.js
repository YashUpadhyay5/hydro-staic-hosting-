/**
 * Emergency CLI Tool: Reset Administrator Password
 * Usage: node src/scripts/resetAdminPassword.js <email-or-id> <new-password>
 * Example: node src/scripts/resetAdminPassword.js anshup@gmail.com MyNewSecret123
 */

require('dotenv').config();
const { Employee } = require('../shared/models');
const { hashPassword } = require('../modules/auth/services/authService');
const { Op } = require('sequelize');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('\n❌ Usage: node src/scripts/resetAdminPassword.js <email-or-id> <new-password>');
    console.log('Example: node src/scripts/resetAdminPassword.js anshup@gmail.com NewAdminPass@2026\n');
    process.exit(1);
  }

  const [identifier, newPassword] = args;

  if (newPassword.length < 8) {
    console.error('❌ Password must be at least 8 characters long.');
    process.exit(1);
  }

  try {
    const user = await Employee.findOne({
      where: {
        [Op.or]: [
          { email: identifier.trim().toLowerCase() },
          { id: identifier.trim() },
          { empCode: identifier.trim() }
        ]
      }
    });

    if (!user) {
      console.error(`❌ No user found matching: ${identifier}`);
      process.exit(1);
    }

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    user.currentToken = null; // Invalidate active session
    await user.save();

    console.log('\n✅ Password reset successfully!');
    console.log(`👤 Name: ${user.name}`);
    console.log(`📧 Email: ${user.email}`);
    console.log(`🆔 ID / Code: ${user.id} / ${user.empCode || '-'}`);
    console.log(`👑 Role: ${user.role}`);
    console.log('🔑 New Password has been encrypted with bcrypt.');
    console.log('🚪 Any active login session has been cleared.\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error resetting password:', err.message);
    process.exit(1);
  }
}

main();
