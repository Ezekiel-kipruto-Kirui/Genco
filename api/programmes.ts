/**
 * /api/programmes - Dynamic programme list endpoint.
 *
 * Scans the "farmers" collection for all unique programme values so that
 * adding a new programme in the mobile app / database automatically makes
 * it appear in the web dashboard — no code change required.
 *
 * Response: { programmes: string[] }
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
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cachedProgrammes: { data: string[]; expiresAt: number } | null = null;

/**
 * Scans a Firebase path for all unique programme values.
 * Handles both "programme" and "Programme" field names and
 * various case/format variants (KPMD, Kpmd, kpmd, KPMD 2, KPMD2, KPMD-2, etc.).
 */
const scanCollectionForProgrammes = async (
  db: ReturnType<typeof getDatabase>,
  collectionPath: string,
): Promise<Set<string>> => {
  const snapshot = await db.ref(collectionPath).get();
  if (!snapshot.exists()) return new Set();

  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return new Set();

  const seen = new Set<string>();

  for (const record of Object.values(raw) as Record<string, unknown>[]) {
    if (!record || typeof record !== "object") continue;

    // Check both common field name casings
    const rawValue = record.programme ?? record.Programme ?? record.PROGRAMME ?? "";
    if (typeof rawValue !== "string" || !rawValue.trim()) continue;

    // Normalize: trim whitespace, uppercase
    const normalized = rawValue.trim().toUpperCase();

    // Normalize spacing variants: "KPMD 2" / "KPMD2" / "KPMD-2" → "KPMD 2"
    const spaced = normalized.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

    if (spaced) seen.add(spaced);
  }

  return seen;
};

/**
 * Normalizes a raw programme value to a canonical form.
 * E.g. "KPMD2" → "KPMD 2", "kpmd" → "KPMD", "range" → "RANGE"
 */
const canonicalize = (value: string): string =>
  value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

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

    // Check cache
    const now = Date.now();
    if (cachedProgrammes && cachedProgrammes.expiresAt > now) {
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=60");
      return res.status(200).json({
        programmes: cachedProgrammes.data,
        fromCache: true,
      });
    }

    const db = getDatabase();

    // Scan multiple collections for maximum programme coverage.
    // "farmers" is the largest and most reliable source.
    const collectionPaths = ["farmers", "offtakes", "orders"];

    const allProgrammes = new Set<string>();

    // Scan collections in parallel for speed
    const results = await Promise.allSettled(
      collectionPaths.map((path) => scanCollectionForProgrammes(db, path)),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const programme of result.value) {
          allProgrammes.add(canonicalize(programme));
        }
      }
    }

    // Sort alphabetically for consistent display
    const programmes = Array.from(allProgrammes).sort();

    // Update cache
    cachedProgrammes = {
      data: programmes,
      expiresAt: now + CACHE_TTL_MS,
    };

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=60");
    return res.status(200).json({
      programmes,
      fromCache: false,
    });
  } catch (error) {
    console.error("[programmes] request failed", error);
    const message = error instanceof Error ? error.message : "Failed to fetch programmes";
    return res.status(500).json({error: message});
  }
}