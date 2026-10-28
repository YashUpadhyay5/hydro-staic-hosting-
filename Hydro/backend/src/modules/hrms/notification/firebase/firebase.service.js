const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

class FirebaseService {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized || admin.apps.length > 0) {
      this.initialized = true;
      return;
    }
    
    try {
      let serviceAccount = null;

      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch (e) {
          console.warn('[Firebase] Could not parse FIREBASE_SERVICE_ACCOUNT env var as JSON.');
        }
      }

      if (!serviceAccount) {
        const localKeyPath = path.join(__dirname, '../../../../config/firebase-service-account.json');
        if (fs.existsSync(localKeyPath)) {
          serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
          console.log('[Firebase] Loaded service account credentials from backend/src/config/firebase-service-account.json');
        }
      }

      if (!serviceAccount) {
        console.warn('Firebase Service Account not found in environment or config file. Push notifications will not work.');
        return;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      this.initialized = true;
      console.log('Firebase Admin initialized successfully with Project ID:', serviceAccount.project_id);
    } catch (error) {
      console.error('Failed to initialize Firebase Admin:', error);
    }
  }

  getMessaging() {
    if (!this.initialized) {
      this.init();
    }
    if (!this.initialized) {
      throw new Error('Firebase Admin not initialized');
    }
    return admin.messaging();
  }
}

module.exports = new FirebaseService();
