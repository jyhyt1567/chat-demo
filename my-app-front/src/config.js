export const BACKEND_BASE_URL = process.env.REACT_APP_BACKEND_BASE_URL || 'http://localhost:8080';

export const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '',
};

export const FIREBASE_VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY || '';

export function isFirebaseConfigured() {
  if (!firebaseConfig) {
    return false;
  }

  return Object.values(firebaseConfig).every((value) => typeof value === 'string' && value.trim().length > 0);
}
