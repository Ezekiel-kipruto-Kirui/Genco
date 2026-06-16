/**
 * Dynamic programmes — fetches the list of programmes from the server
 * endpoint /api/programmes, which scans the database for all unique values.
 *
 * This means adding a new programme in the mobile app / database
 * automatically makes it appear in the web dashboard — NO code change needed.
 *
 * Usage:
 *   import { getDynamicProgrammes, fetchAndCacheProgrammes } from "@/lib/dynamic-programmes";
 *
 *   // Get current cached programmes (synchronous, may be empty before first fetch)
 *   const programmes = getDynamicProgrammes();
 *
 *   // Fetch from server (call once on app init)
 *   await fetchAndCacheProgrammes();
 */

import { auth } from "@/lib/firebase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

// Fallback programmes used before the API responds.
// This ensures the app works even if the API is temporarily unavailable.
const FALLBACK_PROGRAMMES: string[] = ["KPMD", "RANGE", "KPMD 2"];

// In-memory cache
let cachedProgrammes: string[] = [];
let fetchPromise: Promise<string[]> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes client-side

/**
 * Returns the current cached list of programmes.
 * Synchronous — may return fallback values before the first server fetch.
 */
export const getDynamicProgrammes = (): string[] => {
  if (cachedProgrammes.length > 0) return cachedProgrammes;
  return FALLBACK_PROGRAMMES;
};

/**
 * Fetches programmes from the /api/programmes endpoint and caches the result.
 * Deduplicates concurrent calls — only one fetch happens at a time.
 */
export const fetchAndCacheProgrammes = async (): Promise<string[]> => {
  const now = Date.now();

  // Return cached if still fresh
  if (cachedProgrammes.length > 0 && now < lastFetchTime + CACHE_TTL_MS) {
    return cachedProgrammes;
  }

  // Deduplicate concurrent fetches
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        console.warn("[dynamic-programmes] No auth token, using fallback programmes");
        return FALLBACK_PROGRAMMES;
      }

      const response = await fetch(`${API_BASE_URL}/api/programmes`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        console.warn(`[dynamic-programmes] API returned ${response.status}, using fallback`);
        return FALLBACK_PROGRAMMES;
      }

      const result = await response.json();
      const programmes: string[] = Array.isArray(result?.programmes)
        ? result.programmes
        : FALLBACK_PROGRAMMES;

      cachedProgrammes = programmes;
      lastFetchTime = Date.now();

      console.log(`[dynamic-programmes] Fetched ${programmes.length} programmes:`, programmes);
      return programmes;
    } catch (error) {
      console.warn("[dynamic-programmes] Fetch failed, using fallback:", error);
      return FALLBACK_PROGRAMMES;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
};

/**
 * Invalidates the programmes cache, forcing a fresh fetch next time.
 * Call this when you know the programme list has changed (e.g. after
 * an admin creates a new programme).
 */
export const invalidateProgrammesCache = (): void => {
  cachedProgrammes = [];
  lastFetchTime = 0;
};