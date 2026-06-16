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

export type DatabaseRecord<T> = T & { id: string };

// --- Config ---

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

installStorageQuotaGuard();
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

reclaimStorageForCriticalWrites();
export const db = getDatabase(app);

const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

export const analytics =
  typeof window !== "undefined" && typeof import.meta.env.VITE_MEASUREMENT_ID !== "undefined"
    ? getAnalytics(app)
    : null;

// --- Server data proxy cache ---

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

// Track the last server version we got for each collection path.
// Used for 304 Not Modified support.
const serverVersions = new Map<string, number>();

interface ServerDataResponse {
  version: number;
  count: number;
  data: any[];
}

/**
 * Fetch a collection through the server-cached proxy.
 * Falls back to direct RTDB if the server call fails.
 *
 * This reduces RTDB costs because:
 * 1. The server caches in-memory (2min) + RTDB persistent cache
 * 2. Vercel edge caches the HTTP response (2min)
 * 3. Multiple browser tabs share the same server-side cache
 * 4. 304 responses cost zero RTDB reads
 */
const fetchFromServer = async (
  collectionPath: string,
  programme?: string,
): Promise<ServerDataResponse | null> => {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;

    const params = new URLSearchParams({path: collectionPath});
    if (programme) params.set("programme", programme);

    const lastVersion = serverVersions.get(collectionPath);
    if (lastVersion) params.set("sinceVersion", String(lastVersion));

    const response = await fetch(`${API_BASE_URL}/api/data?${params}`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (response.status === 304) {
      // Server has same data, use our local cache
      return null;
    }

    if (!response.ok) return null;

    const result = await response.json();
    if (result?.version) {
      serverVersions.set(collectionPath, result.version);
    }
    return result;
  } catch {
    return null;
  }
};

// --- Helpers ---

const COLLECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_CACHE_TTL_MS = 3 * 60 * 1000; // Server data is fresher, cache longer
const inFlightCollectionRequests = new Map<string, Promise<DatabaseRecord<any>[]>>();

const buildCollectionCacheKey = (path: string, scope = "all") =>
  cacheKey("collection", auth.currentUser?.uid || "anon", path, scope);

const snapshotToRecords = <T = Record<string, any>>(snapshot: DataSnapshot): DatabaseRecord<T>[] => {
  if (!snapshot.exists()) return [];
  const data = snapshot.val();
  if (typeof data !== "object" || data === null) return [];
  return Object.entries(data).map(([id, value]) => ({
    id,
    ...(value as T),
  }));
};

const buildProgrammeCandidates = (programme: string): string[] => {
  return getProgrammeQueryValues(programme);
};

const serverResponseToRecords = <T = Record<string, any>>(
  response: ServerDataResponse,
): DatabaseRecord<T>[] =>
  (response.data || []).map((item: any) => ({
    id: item.id,
    ...item,
  })) as DatabaseRecord<T>[];

/**
 * Fetch collection via server proxy (cache-first), fallback to direct RTDB.
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
    // Try server proxy first (cheaper)
    const serverResult = await fetchFromServer(path);
    if (serverResult) {
      const records = serverResponseToRecords<T>(serverResult);
      writeCachedValue(cacheName, records);
      return records;
    }

    // Fallback: direct RTDB read
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

/**
 * Fetch collection filtered by programme via server proxy (cache-first), fallback to direct RTDB.
 */
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
    // Try server proxy first
    const serverResult = await fetchFromServer(path, normalizedProgramme);
    if (serverResult) {
      const records = serverResponseToRecords<T>(serverResult);
      writeCachedValue(cacheName, records);
      return records;
    }

    // Fallback: direct RTDB queries
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

/**
 * Fetch collection filtered by multiple programmes via server proxy, fallback to direct RTDB.
 */
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
    // If requesting all known programmes, use server proxy without programme filter
    // (single RTDB read instead of per-programme reads). Dynamic: uses whatever
    // programmes the user has access to — no hardcoded list.
    const { getDynamicProgrammes } = await import("@/lib/dynamic-programmes");
    const allKnownProgrammes = getDynamicProgrammes();
    const isAllProgrammes = allKnownProgrammes.length > 0 &&
      allKnownProgrammes.every((p) => normalizedProgrammes.includes(p));

    if (isAllProgrammes) {
      const serverResult = await fetchFromServer(path);
      if (serverResult) {
        const records = serverResponseToRecords<T>(serverResult);
        writeCachedValue(cacheName, records);
        return records;
      }
    }

    // Try each programme individually via server
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

/**
 * Optimized subscribe: seeds initial data from server proxy,
 * then establishes a lightweight realtime listener for live updates only.
 * This avoids the expensive initial full-download RTDB query.
 */
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

  // Seed from server cache first (fast, no RTDB cost)
  let hasSeededFromServer = false;
  const seedFromServer = async () => {
    try {
      const serverResult = await fetchFromServer(path, programme);
      if (serverResult && !hasSeededFromServer) {
        hasSeededFromServer = true;
        const records: Record<string, T> = {};
        (serverResult.data || []).forEach((item: any) => {
          if (item.id) {
            const {id, ...rest} = item;
            records[id] = rest as T;
          }
        });
        onRecords(records);
      }
    } catch {
      // Silent fallback — the realtime listener will handle it
    }
  };
  seedFromServer();

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
  // Also clear server version so next fetch gets fresh data
  serverVersions.delete(path);
};