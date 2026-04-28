import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, get, query, orderByChild, equalTo, type DataSnapshot } from "firebase/database";
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

const buildCollectionCacheKey = (path: string, scope = "all") =>
  cacheKey("collection", auth.currentUser?.uid || "anon", path, scope);

const snapshotToRecords = <T = Record<string, any>>(snapshot: DataSnapshot): DatabaseRecord<T>[] => {
  if (!snapshot.exists()) return [];

  const data = snapshot.val();
  if (typeof data !== "object" || data === null) {
    return [];
  }

  return Object.entries(data).map(([id, value]) => ({
    id,
    ...(value as T),
  }));
};

// Programmes are always stored in uppercase (KPMD, RANGE, MTLDK).
// Only query the canonical uppercase form to avoid 4→2 duplicate round-trips.
const buildProgrammeCandidates = (programme: string): string[] => {
  const upper = programme.trim().toUpperCase();
  return upper ? [upper] : [];
};

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
      const records = snapshotToRecords<T>(await get(ref(db, path)));
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

export const fetchCollectionByProgramme = async <T = Record<string, any>>(
  path: string,
  programme: string,
  ttlMs = COLLECTION_CACHE_TTL_MS,
): Promise<DatabaseRecord<T>[]> => {
  const normalizedProgramme = programme.trim().toUpperCase();
  if (!normalizedProgramme) return [];

  const cacheName = buildCollectionCacheKey(path, `programme:${normalizedProgramme}`);
  const cached = readCachedValue<DatabaseRecord<T>[]>(cacheName, ttlMs);
  if (cached) return cached;

  const inFlight = inFlightCollectionRequests.get(cacheName);
  if (inFlight) return inFlight as Promise<DatabaseRecord<T>[]>;

  const request = (async () => {
    try {
      const snapshots = await Promise.all(
        ["programme", "Programme"].flatMap((fieldName) =>
          buildProgrammeCandidates(programme).map((candidate) =>
            get(query(ref(db, path), orderByChild(fieldName), equalTo(candidate))),
          ),
        ),
      );

      const mergedRecords = new Map<string, DatabaseRecord<T>>();
      snapshots.forEach((snapshot) => {
        snapshotToRecords<T>(snapshot).forEach((record) => {
          mergedRecords.set(record.id, record);
        });
      });

      const records = Array.from(mergedRecords.values());
      writeCachedValue(cacheName, records);
      return records;
    } catch (err) {
      console.error(`Error fetching programme collection at ${path}:`, err);
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
