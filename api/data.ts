/**
 * /api/data - Server-cached collection data proxy.
 *
 * Instead of every browser tab hitting Firebase RTDB directly for every collection,
 * this endpoint reads once and caches in-memory (per cold-start) + returns
 * Cache-Control headers so Vercel's edge caches the response.
 *
 * Usage:  GET /api/data?path=farmers&programme=KPMD&sinceVersion=1234
 */
import type {VercelRequest, VercelResponse} from "@vercel/node";
import {
  initializeAdmin,
  getAuth,
  getDatabase,
  getAllowedOrigin,
  setCorsHeaders,
  getBearerToken,
} from "./_lib/firebase-admin";

// --- In-memory cache (survives for the lifetime of a serverless instance) ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in-memory (reduced RTDB reads)
const EDGE_CACHE_TTL = 300; // 5 minutes edge cache
const CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
  version: number;
  data: any[];
  expiresAt: number;
}

const collectionCache = new Map<string, CacheEntry>();

// --- Helpers ---
const snapshotToArray = (snapshot: any): any[] => {
  if (!snapshot.exists()) return [];
  const value = snapshot.val();
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, any>).map(([id, record]) => ({
    id,
    ...(record as Record<string, any>),
  }));
};

const normalizeProgramme = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

/**
 * Generates ALL known case/format variants for a programme string.
 * Instead of a hardcoded map, this works for ANY programme —
 * so new programmes added in the database work automatically.
 */
const generateQueryVariants = (programme: string): string[] => {
  const base = programme;
  const lower = base.toLowerCase();
  const capitalized = base.charAt(0) + base.slice(1).toLowerCase();
  const noSpace = base.replace(/\s+/g, "");
  const noSpaceLower = noSpace.toLowerCase();
  const hyphenated = base.replace(/\s+/g, "-");
  const hyphenatedLower = hyphenated.toLowerCase();

  // Deduplicate while preserving order
  const variants = new Set<string>();
  variants.add(base);
  variants.add(lower);
  variants.add(capitalized);
  variants.add(noSpace);
  variants.add(noSpaceLower);
  variants.add(hyphenated);
  variants.add(hyphenatedLower);

  return Array.from(variants);
};

const getQueryValues = (programme: string): string[] =>
  generateQueryVariants(programme);

// Fetch all records from a path (cached)
const getAllRecords = async (collectionPath: string): Promise<{version: number; data: any[]}> => {
  const cacheKey = `all:${collectionPath}`;
  const now = Date.now();

  // Evict expired entries to prevent memory bloat
  if (collectionCache.size > CACHE_MAX_ENTRIES) {
    for (const [key, entry] of collectionCache) {
      if (entry.expiresAt <= now) collectionCache.delete(key);
    }
    if (collectionCache.size > CACHE_MAX_ENTRIES) {
      const oldest = [...collectionCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (let i = 0; i < collectionCache.size - CACHE_MAX_ENTRIES; i++) {
        collectionCache.delete(oldest[i][0]);
      }
    }
  }

  const cached = collectionCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {version: cached.version, data: cached.data};
  }

  const snapshot = await getDatabase().ref(collectionPath).get();
  const data = snapshotToArray(snapshot);

  const entry: CacheEntry = {
    version: now,
    data,
    expiresAt: now + CACHE_TTL_MS,
  };
  collectionCache.set(cacheKey, entry);

  return {version: entry.version, data};
};

// Filter records by programme
const filterByProgramme = (records: any[], programme: string): any[] => {
  if (!programme || programme === "ALL") return records;
  const normalized = normalizeProgramme(programme);
  const candidates = getQueryValues(normalized);
  return records.filter((record) => {
    const p = normalizeProgramme(record.programme || record.Programme);
    if (!p) return true; // Include records with no programme field
    return candidates.includes(p);
  });
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, req.headers.origin, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({error: "Method not allowed"});
  }

  try {
    const {path: collectionPath, programme, sinceVersion} = req.query;

    if (!collectionPath || typeof collectionPath !== "string") {
      return res.status(400).json({error: "Missing 'path' query parameter"});
    }

    // Auth check
    initializeAdmin();
    const idToken = getBearerToken(req.headers.authorization);
    if (idToken) {
      try {
        await getAuth().verifyIdToken(idToken);
      } catch {
        return res.status(401).json({error: "Invalid or expired token"});
      }
    }

    // Check if client has a fresh version
    const clientVersion = sinceVersion ? Number(sinceVersion) : 0;
    if (Number.isFinite(clientVersion) && clientVersion > 0) {
      const cached = collectionCache.get(`all:${collectionPath}`);
      if (cached && cached.version <= clientVersion) {
        return res.status(304).end();
      }
    }

    const {version, data} = await getAllRecords(collectionPath);

    let records = data;
    if (programme && typeof programme === "string") {
      records = filterByProgramme(data, programme);
    }

    // Cache-Control for Vercel edge
    res.setHeader("Cache-Control", `public, s-maxage=${EDGE_CACHE_TTL}, stale-while-revalidate=30`);

    return res.status(200).json({
      version,
      count: records.length,
      data: records,
    });
  } catch (error) {
    console.error("[data] request failed", error);
    const message = error instanceof Error ? error.message : "Data fetch failed";
    return res.status(500).json({error: message});
  }
}