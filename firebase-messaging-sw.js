/* global importScripts, firebase */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Deploy ortamında gerçek Firebase config ile doldurun.
const FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

const hasFirebaseConfig = !!(
  FIREBASE_CONFIG.apiKey &&
  FIREBASE_CONFIG.projectId &&
  FIREBASE_CONFIG.messagingSenderId &&
  FIREBASE_CONFIG.appId
);

if (hasFirebaseConfig) {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload && payload.notification ? payload.notification : {};
    const title = notification.title || '💊 İlaç Hatırlatma';
    const options = {
      body: notification.body || 'İlacınızı almayı unutmayın.',
      icon: notification.icon || '/icon.png',
      badge: notification.badge || '/icon.png',
      data: payload && payload.data ? payload.data : {},
    };

    self.registration.showNotification(title, options);
  });
}
