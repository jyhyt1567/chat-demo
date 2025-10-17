const FIREBASE_APP_SCRIPT = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
const FIREBASE_MESSAGING_SCRIPT = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js';

let firebaseInitialized = false;

function importFirebaseScripts() {
  importScripts(FIREBASE_APP_SCRIPT, FIREBASE_MESSAGING_SCRIPT);
}

function initializeFirebase(config) {
  if (firebaseInitialized || !config) {
    return;
  }

  importFirebaseScripts();
  firebase.initializeApp(config);
  firebase.messaging();
  firebaseInitialized = true;
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'FIREBASE_INIT') {
    return;
  }

  const { config } = data.payload || {};
  if (!config) {
    return;
  }

  initializeFirebase(config);
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  const payload = event.data.json();
  const notification = payload.notification || {};
  const title = notification.title || '알림';
  const options = {
    body: notification.body || '',
    icon: notification.icon || '/favicon.ico',
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url;

  if (targetUrl) {
    event.waitUntil(self.clients.openWindow(targetUrl));
  }
});
