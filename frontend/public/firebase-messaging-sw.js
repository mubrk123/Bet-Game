importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBNY7WCqOEVH8IlJM9_6x6MfHyzAvWNDk",
  authDomain: "cricket-10c01.firebaseapp.com",
  projectId: "cricket-10c01",
  appId: "1:1069188316192:web:94303b19b088825d08d045",
  messagingSenderId: "1069188316192",
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(() => {});
