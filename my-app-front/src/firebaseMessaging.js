import { FIREBASE_VAPID_KEY, firebaseConfig, isFirebaseConfigured } from './config';

const FIREBASE_SCRIPT_URLS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js',
];

let firebaseLoaderPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (event) => reject(event));
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.loaded = 'false';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', (event) => reject(event));
    document.head.appendChild(script);
  });
}

async function ensureFirebaseLoaded() {
  if (!firebaseLoaderPromise) {
    firebaseLoaderPromise = Promise.all(FIREBASE_SCRIPT_URLS.map((url) => loadScript(url))).then(() => {
      if (!window.firebase) {
        throw new Error('Firebase SDK를 로드하지 못했습니다.');
      }
      return window.firebase;
    });
  }

  return firebaseLoaderPromise;
}

function ensureFirebaseApp(firebase) {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase 설정이 누락되었습니다. .env 파일에 Firebase 환경 변수를 추가해주세요.');
  }

  if (!firebase.apps || firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
  }

  return firebase.app();
}

async function ensureServiceWorkerInitialized(registration) {
  if (!registration) {
    return;
  }

  const activeWorker = registration.active || (await navigator.serviceWorker.ready).active;
  if (!activeWorker) {
    return;
  }

  activeWorker.postMessage({
    type: 'FIREBASE_INIT',
    payload: {
      config: firebaseConfig,
    },
  });
}

export async function requestFcmDeviceToken() {
  if (!('Notification' in window)) {
    throw new Error('이 브라우저는 알림 권한을 지원하지 않습니다.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('알림 권한을 허용해야 FCM 토큰을 발급받을 수 있습니다.');
  }

  if (!('serviceWorker' in navigator)) {
    throw new Error('이 브라우저는 서비스 워커를 지원하지 않습니다.');
  }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  await ensureServiceWorkerInitialized(registration);

  const firebase = await ensureFirebaseLoaded();

  if (typeof firebase.messaging?.isSupported !== 'function' || !firebase.messaging.isSupported()) {
    throw new Error('현재 브라우저에서는 Firebase Cloud Messaging을 사용할 수 없습니다.');
  }

  ensureFirebaseApp(firebase);

  const messaging = firebase.messaging();
  const token = await messaging.getToken({
    vapidKey: FIREBASE_VAPID_KEY || undefined,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error('Firebase에서 FCM 토큰을 발급받지 못했습니다.');
  }

  return token;
}

export function isFirebaseMessagingReady() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  return isFirebaseConfigured() && 'Notification' in window && 'serviceWorker' in navigator;
}
