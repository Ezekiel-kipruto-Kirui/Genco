import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, get } from "firebase/database";
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

// --- Types ---

// Generic type for a database record including its ID
export type DatabaseRecord<T> = T & { id: string };

// --- Config ---

// It is good practice to verify these exist at runtime to fail fast if config is missing
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_DATABASE_URL,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
};

// --- Initialization ---

// MAIN APP
// Check if an app is already initialized to prevent errors during hot-reloads
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// REALTIME DATABASE
export const db = getDatabase(app);

// SECONDARY APP (Used for admin operations without logging out the main user)
// We use a unique name "Secondary" to ensure independence.
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

// NOTE: If you use secondaryAuth ONLY for backend-like actions (like creating users),
// consider setting persistence to 'none' to avoid polluting browser storage:
// import { setPersistence, inMemoryPersistence } from "firebase/auth";
// await setPersistence(secondaryAuth, inMemoryPersistence);

// ANALYTICS
// Prevent analytics crash in non-browser environments (e.g., SSR)
export const analytics =
  typeof window !== "undefined" && typeof import.meta.env.VITE_MEASUREMENT_ID !== "undefined"
    ? getAnalytics(app)
    : null;

// --- Helpers ---

const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const inFlightCollectionRequests = new Map<string, Promise<DatabaseRecord<any>[]>>();

const buildCollectionCacheKey = (path: string) =>
  cacheKey("collection", auth.currentUser?.uid || "anon", path);

/**
 * Helper function to fetch data from Realtime Database.
 *
 * @param path - The database path to fetch from (e.g., "users")
 * @returns An array of objects, each enriched with the record's 'id'.
 */
export const fetchCollection = async <T = Record<string, any>>(
  path: string,
  ttlMs = COLLECTION_CACHE_TTL_MS,
): Promise<DatabaseRecord<T>[]> => {
  const cacheName = buildCollectionCacheKey(path);
  const cached = readCachedValue<DatabaseRecord<T>[]>(cacheName, ttlMs);
  if (cached) return cached;

  const inFlight = inFlightCollectionRequests.get(cacheName);
  if (inFlight) return inFlight as Promise<DatabaseRecord<T>[]>;

  const request = (async () => {
    try {
      const dbRef = ref(db, path);
      const snapshot = await get(dbRef);

      if (!snapshot.exists()) {
        writeCachedValue(cacheName, []);
        return [];
      }

      const data = snapshot.val();

      // Handle the case where data might not be an object (e.g., a primitive value at the path)
      if (typeof data !== "object" || data === null) {
        console.warn(`Path ${path} does not contain a collection/object.`);
        writeCachedValue(cacheName, []);
        return [];
      }

      // Convert object → array with id (Firestore-like structure)
      const records = Object.entries(data).map(([id, value]) => ({
        id,
        ...(value as T),
      }));
      writeCachedValue(cacheName, records);
      return records;
    } catch (err) {
      console.error(`Error fetching collection at ${path}:`, err);
      throw err;
    }
  })();

  inFlightCollectionRequests.set(cacheName, request);

  try {
    return await request;
  } finally {
    inFlightCollectionRequests.delete(cacheName);
  }
};

export const invalidateCollectionCache = (path: string): void => {
  const cacheName = buildCollectionCacheKey(path);
  inFlightCollectionRequests.delete(cacheName);
  removeCachedValue(cacheName);
};

// Interface for the full data fetch payload
export interface AppData {
  livestock: DatabaseRecord<any>[];
  fodder: DatabaseRecord<any>[];
  infrastructure: DatabaseRecord<any>[];
  BoreholeStorage: DatabaseRecord<any>[];
  capacity: DatabaseRecord<any>[];
  lofftake: DatabaseRecord<any>[];
  fofftake: DatabaseRecord<any>[];
  users: DatabaseRecord<any>[];
}

/**
 * Fetches all application data in parallel.
 * This improves performance compared to awaiting each fetch sequentially.
 */
export const fetchData = async (): Promise<AppData> => {
  try {
    const [
      livestock,
      fodder,
      infrastructure,
      BoreholeStorage,
      capacity,
      lofftake,
      fofftake,
      users,
    ] = await Promise.all([
      fetchCollection("farmers"),
      fetchCollection("fodderFarmers"),
      fetchCollection("Infrastructure Data"),
      fetchCollection("BoreholeStorage"),
      fetchCollection("capacityBuilding"),
      fetchCollection("offtakes"),
      fetchCollection("Fodder Offtake Data"),
      fetchCollection("users"),
    ]);

    return {
      livestock,
      fodder,
      infrastructure,
      BoreholeStorage,
      capacity,
      lofftake,
      fofftake,
      users,
    };
  } catch (error) {
    console.error("Error fetching all data:", error);
    // Rethrow so the calling component can handle the error state (e.g., show a toast)
    throw error;
  }
};
