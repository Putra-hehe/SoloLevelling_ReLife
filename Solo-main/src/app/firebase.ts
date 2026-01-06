import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";

/**
 * Firebase init (Vite + Vercel safe)
 * - Config via env (VITE_*)
 * - Prevents double-initialize (HMR)
 * - Firestore ignores undefined props (prevents silent save failures)
 * - Auth persistence so login stays on mobile after refresh
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

const requiredKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

const missing = requiredKeys.filter((k) => !(import.meta.env as any)[k]);
if (missing.length) {
  console.warn(
    `[Firebase] Missing env vars: ${missing.join(", ")}. ` +
      "Pastikan .env.local ada di folder Solo-main (satu level dengan package.json) dan sudah diisi."
  );
}

// Initialize Firebase app; avoid re-init during HMR
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firestore: ignoreUndefinedProperties prevents setDoc from failing when optional fields are undefined
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

// Auth
export const auth = getAuth(app);

// Keep session across refresh (helps mobile + deployed env)
setPersistence(auth, browserLocalPersistence).catch((err) => {
  // Do not crash app if persistence isn't available (e.g., private mode)
  console.warn("[Firebase] Auth persistence warning:", err);
});

/**
 * Optional: Safe Analytics init.
 * Analytics can crash in some environments (adblock, unsupported APIs) if called eagerly.
 * Use: `initAnalytics()` once on app mount, production only.
 */
export async function initAnalytics() {
  try {
    if (!import.meta.env.PROD) return null;
    if (typeof window === "undefined") return null;
    if (!firebaseConfig.measurementId) return null;

    const mod = await import("firebase/analytics");
    const supported = await mod.isSupported();
    if (!supported) return null;

    return mod.getAnalytics(app);
  } catch (err) {
    console.warn("[Firebase] Analytics disabled:", err);
    return null;
  }
}
