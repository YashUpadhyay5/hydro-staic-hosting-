const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

try {
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Firebase Admin] Initialized successfully.');
  }
} catch (error) {
  console.error('[Firebase Admin Error] Could not initialize:', error.message);
}

module.exports = admin;
