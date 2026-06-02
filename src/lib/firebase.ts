import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, get, onValue, query, orderByChild, equalTo, type DataSnapshot } from "firebase/database";
import {
  cacheKey,
  installStorageQuotaGuard,
  readCachedValue,
  reclaimStorageForCriticalWrites,
  removeCachedValue,
  writeCachedValue,
} from "@/lib/data-cache";
import { getProgrammeQueryValues } from "@/lib/programme-access";

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
installStorageQuotaGuard();
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// REALTIME DATABASE
reclaimStorageForCriticalWrites();
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

// Only query the canonical uppercase form to avoid 4→2 duplicate round-trips.
const buildProgrammeCandidates = (programme: string): string[] => {
  return getProgrammeQueryValues(programme);
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

export const fetchCollectionByProgrammes = async <T = Record<string, any>>(
  path: string,
  programmes: readonly string[],
  ttlMs = COLLECTION_CACHE_TTL_MS,
): Promise<DatabaseRecord<T>[]> => {
  const normalizedProgrammes = Array.from(
    new Set(programmes.map((programme) => programme.trim().toUpperCase()).filter(Boolean)),
  );

  if (normalizedProgrammes.length === 0) return [];
  if (normalizedProgrammes.length === 1) {
    return fetchCollectionByProgramme<T>(path, normalizedProgrammes[0], ttlMs);
  }

  const cacheName = buildCollectionCacheKey(path, `programmes:${normalizedProgrammes.join("|")}`);
  const cached = readCachedValue<DatabaseRecord<T>[]>(cacheName, ttlMs);
  if (cached) return cached;

  const inFlight = inFlightCollectionRequests.get(cacheName);
  if (inFlight) return inFlight as Promise<DatabaseRecord<T>[]>;

  const request = (async () => {
    try {
      const results = await Promise.all(
        normalizedProgrammes.map((programme) =>
          fetchCollectionByProgramme<T>(path, programme, ttlMs),
        ),
      );

      const mergedRecords = new Map<string, DatabaseRecord<T>>();
      results.flat().forEach((record) => {
        mergedRecords.set(record.id, record);
      });

      const records = Array.from(mergedRecords.values());
      writeCachedValue(cacheName, records);
      return records;
    } catch (err) {
      console.error(`Error fetching programme collections at ${path}:`, err);
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

export const subscribeCollectionByProgramme = <T = Record<string, any>>(
  path: string,
  programme: string,
  onRecords: (records: Record<string, T>) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const programmeCandidates = buildProgrammeCandidates(programme);
  if (programmeCandidates.length === 0) {
    onRecords({});
    return () => {};
  }

  const recordsByQuery = new Map<string, Record<string, T>>();
  const publish = () => {
    const merged: Record<string, T> = {};
    recordsByQuery.forEach((records) => {
      Object.assign(merged, records);
    });
    onRecords(merged);
  };

  const unsubscribers = ["programme", "Programme"].flatMap((fieldName) =>
    programmeCandidates.map((candidate) => {
      const queryKey = `${fieldName}:${candidate}`;
      return onValue(
        query(ref(db, path), orderByChild(fieldName), equalTo(candidate)),
        (snapshot) => {
          const records: Record<string, T> = {};
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (data && typeof data === "object") {
              Object.entries(data as Record<string, T>).forEach(([id, record]) => {
                records[id] = record;
              });
            }
          }
          recordsByQuery.set(queryKey, records);
          publish();
        },
        (error) => {
          onError?.(error);
        },
      );
    }),
  );

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};

export const subscribeCollectionByProgrammes = <T = Record<string, any>>(
  path: string,
  programmes: readonly string[],
  onRecords: (records: Record<string, T>) => void,
  onError?: (error: Error) => void,
): (() => void) => {
  const normalizedProgrammes = Array.from(
    new Set(programmes.map((programme) => programme.trim().toUpperCase()).filter(Boolean)),
  );

  if (normalizedProgrammes.length === 0) {
    onRecords({});
    return () => {};
  }

  const recordsByProgramme = new Map<string, Record<string, T>>();
  const publish = () => {
    const merged: Record<string, T> = {};
    recordsByProgramme.forEach((records) => {
      Object.assign(merged, records);
    });
    onRecords(merged);
  };

  const unsubscribers = normalizedProgrammes.map((programme) =>
    subscribeCollectionByProgramme<T>(
      path,
      programme,
      (records) => {
        recordsByProgramme.set(programme, records);
        publish();
      },
      onError,
    ),
  );

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};

export const invalidateCollectionCache = (path: string): void => {
  const cacheName = buildCollectionCacheKey(path);
  inFlightCollectionRequests.delete(cacheName);
  removeCachedValue(cacheName);
};
