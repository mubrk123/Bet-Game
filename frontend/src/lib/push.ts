import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import type { Messaging } from "firebase/messaging";
import { supabase } from "./supabase";

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_VAPID_KEY,
} = import.meta.env;

const hasFirebaseConfig =
  VITE_FIREBASE_API_KEY &&
  VITE_FIREBASE_AUTH_DOMAIN &&
  VITE_FIREBASE_PROJECT_ID &&
  VITE_FIREBASE_APP_ID &&
  VITE_FIREBASE_MESSAGING_SENDER_ID &&
  VITE_FIREBASE_VAPID_KEY;

let messaging: Messaging | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let registering = false;

const PROMPT_KEY = "push_last_prompt_at";
const PROMPT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

async function ensureServiceWorker() {
  if (swRegistration || registering) return swRegistration;
  registering = true;
  // Expect a static SW at /firebase-messaging-sw.js (placed in /public)
  swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  registering = false;
  return swRegistration;
}

function shouldRePrompt() {
  const last = Number(localStorage.getItem(PROMPT_KEY) || "0");
  return Date.now() - last > PROMPT_COOLDOWN_MS;
}

function recordPromptTime() {
  localStorage.setItem(PROMPT_KEY, Date.now().toString());
}

async function initFirebaseMessaging() {
  if (!hasFirebaseConfig) return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  if (!getApps().length) {
    initializeApp({
      apiKey: VITE_FIREBASE_API_KEY,
      authDomain: VITE_FIREBASE_AUTH_DOMAIN,
      projectId: VITE_FIREBASE_PROJECT_ID,
      appId: VITE_FIREBASE_APP_ID,
      messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
    });
  }
  messaging = getMessaging();
  return messaging;
}

async function requestAndSaveToken(userId: string) {
  if (!messaging) return;
  const reg = await ensureServiceWorker();
  const token = await getToken(messaging, {
    vapidKey: VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: reg ?? undefined,
  });
  if (!token) return;
  await supabase.from("user_devices").upsert(
    {
      user_id: userId,
      token,
      platform: "web",
      provider: "fcm",
      is_active: true,
    },
    { onConflict: "token" }
  );
}

export async function ensurePushForUser(userId: string | null | undefined) {
  if (!userId) return;
  if (!("Notification" in window) || !hasFirebaseConfig) return;

  await initFirebaseMessaging();

  const perm = Notification.permission;
  if (perm === "granted") {
    await requestAndSaveToken(userId);
    return;
  }

  if (perm === "denied") {
    if (shouldRePrompt()) {
      // Let browser decide; may still be blocked
      const result = await Notification.requestPermission();
      recordPromptTime();
      if (result === "granted") {
        await requestAndSaveToken(userId);
      }
    }
    return;
  }

  // default state
  const result = await Notification.requestPermission();
  recordPromptTime();
  if (result === "granted") {
    await requestAndSaveToken(userId);
  }
}
