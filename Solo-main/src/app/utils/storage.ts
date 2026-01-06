import { AppState } from "../types";
import { db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

// Key used for localStorage fallback. Namespaced to avoid collisions with other apps.
const STORAGE_KEY = "levelday_app_state";

// Firestore: each user has one doc snapshot of their app state.
const COLLECTION_NAME = "appState";

/**
 * Persist app state to localStorage. This is kept for offline fallback.
 */
export const saveToStorage = (state: AppState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save to localStorage:", error);
  }
};

/**
 * Load app state from localStorage.
 */
export const loadFromStorage = (): AppState | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? (JSON.parse(data) as AppState) : null;
  } catch (error) {
    console.error("Failed to load from localStorage:", error);
    return null;
  }
};

/**
 * Remove persisted state from localStorage.
 */
export const clearStorage = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * Very small runtime normalization so a weird Firestore document won't crash the UI.
 */
function normalizeAppState(raw: any): AppState | null {
  if (!raw || typeof raw !== "object") return null;

  return {
    user: raw.user ?? null,
    quests: Array.isArray(raw.quests) ? raw.quests : [],
    habits: Array.isArray(raw.habits) ? raw.habits : [],
    focusSessions: Array.isArray(raw.focusSessions) ? raw.focusSessions : [],
    badges: Array.isArray(raw.badges) ? raw.badges : [],
    currentPage: typeof raw.currentPage === "string" ? raw.currentPage : "dashboard",
    isOnboarded: !!raw.isOnboarded,
    moodByDate: raw.moodByDate && typeof raw.moodByDate === "object" ? raw.moodByDate : undefined,
    lastDailyReset: typeof raw.lastDailyReset === "string" ? raw.lastDailyReset : undefined,
  };
}

/**
 * Load application state from Firestore for a given user.
 */
export const loadFromFirebase = async (userId: string): Promise<AppState | null> => {
  try {
    const ref = doc(db, COLLECTION_NAME, userId);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    return normalizeAppState(snapshot.data());
  } catch (error) {
    console.error("Failed to load from Firebase:", error);
    return null;
  }
};

// --- Debounced Firestore saving ---

const SAVE_DEBOUNCE_MS = 600;

type Resolver = { resolve: () => void; reject: (err: unknown) => void };

type PendingSave = {
  timer?: ReturnType<typeof setTimeout>;
  lastState?: AppState;
  waiting: Resolver[];
  inFlight?: Promise<void>;
};

const pendingByUser = new Map<string, PendingSave>();

async function performSave(userId: string, state: AppState): Promise<void> {
  // If offline, skip Firestore and rely on localStorage; app will resync when online.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const ref = doc(db, COLLECTION_NAME, userId);
  await setDoc(ref, state);
}

/**
 * Save the application state to Firestore.
 * 
 * IMPORTANT: this is debounced to avoid excessive writes (page navigation,
 * typing, rapid taps on mobile). It also serializes writes to avoid race bugs.
 */
export const saveToFirebase = (userId: string, state: AppState): Promise<void> => {
  return new Promise((resolve, reject) => {
    const entry: PendingSave = pendingByUser.get(userId) ?? { waiting: [] };
    entry.lastState = state;
    entry.waiting.push({ resolve, reject });

    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(async () => {
      entry.timer = undefined;
      const latest = entry.lastState;
      if (!latest) {
        const waiters = entry.waiting.splice(0, entry.waiting.length);
        waiters.forEach((w) => w.resolve());
        return;
      }

      try {
        // serialize: wait previous write (if any)
        if (entry.inFlight) {
          try {
            await entry.inFlight;
          } catch {
            // ignore
          }
        }

        entry.inFlight = performSave(userId, latest)
          .catch((err) => {
            console.error("Failed to save to Firebase:", err);
            throw err;
          })
          .finally(() => {
            entry.inFlight = undefined;
          });

        await entry.inFlight;
        const waiters = entry.waiting.splice(0, entry.waiting.length);
        waiters.forEach((w) => w.resolve());
      } catch (err) {
        const waiters = entry.waiting.splice(0, entry.waiting.length);
        waiters.forEach((w) => w.reject(err));
      }
    }, SAVE_DEBOUNCE_MS);

    pendingByUser.set(userId, entry);
  });
};

/**
 * Force any pending debounced write to run immediately.
 * Useful on `beforeunload` / `visibilitychange`.
 */
export const flushFirebaseWrites = async (userId: string): Promise<void> => {
  const entry = pendingByUser.get(userId);
  if (!entry) return;

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  const latest = entry.lastState;
  if (!latest) return;

  try {
    if (entry.inFlight) {
      try {
        await entry.inFlight;
      } catch {
        // ignore
      }
    }

    entry.inFlight = performSave(userId, latest)
      .catch((err) => {
        console.error("Failed to save to Firebase:", err);
        throw err;
      })
      .finally(() => {
        entry.inFlight = undefined;
      });

    await entry.inFlight;
  } finally {
    const waiters = entry.waiting.splice(0, entry.waiting.length);
    waiters.forEach((w) => w.resolve());
  }
};
