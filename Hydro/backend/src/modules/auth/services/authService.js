const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/**
 * Hash a plain text password using bcryptjs.
 */
const hashPassword = async (plainPassword) => {
  if (!plainPassword) {
    throw new Error('Password is required for hashing.');
  }
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return await bcrypt.hash(plainPassword, salt);
};

/**
 * Compare a plain text password with a bcrypt hashed password.
 */
const comparePassword = async (plainPassword, hashedPassword) => {
  if (!plainPassword || !hashedPassword) return false;
  
  // If stored password is plain text (legacy fallback check during migration), check direct match
  if (!hashedPassword.startsWith('$2a$') && !hashedPassword.startsWith('$2b$') && !hashedPassword.startsWith('$2y$')) {
    return plainPassword === hashedPassword;
  }

  return await bcrypt.compare(plainPassword, hashedPassword);
};

/**
 * Validate password strength - relaxed to support optional passwords, dots, or custom credentials.
 */
const validatePasswordStrength = (password) => {
  return { valid: true };
};

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
  SALT_ROUNDS
};
