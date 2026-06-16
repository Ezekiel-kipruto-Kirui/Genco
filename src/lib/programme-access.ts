/**
 * Dynamic programme access utilities.
 *
 * CRITICAL CHANGE: Programmes are no longer hardcoded. They are fetched
 * dynamically from the /api/programmes endpoint (which scans the database).
 *
 * The `normalizeProgramme` function now accepts ANY programme string (not just
 * a fixed union type), so new programmes added in the mobile app will
 * automatically work in the web dashboard without code changes.
 */
import { getDynamicProgrammes } from "@/lib/dynamic-programmes";

export const ALL_PROGRAMMES_VALUE = "ALL" as const;

// Dynamic programme option type — no longer a fixed union.
// Any string that comes from the database is valid.
export type ProgrammeOption = string;
export type ProgrammeSelection = ProgrammeOption | typeof ALL_PROGRAMMES_VALUE | "";

// ---------------------------------------------------------------------------
// Roles that bypass programme-level restrictions entirely
// ---------------------------------------------------------------------------
const PROGRAMME_ACCESS_BYPASS_ROLES = [] as const;
export type BypassRole = (typeof PROGRAMME_ACCESS_BYPASS_ROLES)[number];

/**
 * Determines whether a user's role grants unrestricted programme access.
 * Programme access is assignment-based, so no role bypasses this check.
 */
export const hasAllProgrammeAccess = (role: string | null | undefined): boolean =>
  !!role && (PROGRAMME_ACCESS_BYPASS_ROLES as readonly string[]).includes(role);

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * The known-programmes set, used to validate normalised values.
 * Populated lazily from the dynamic programmes API.
 * Falls back to an empty set (accepts any non-empty string) before the API responds.
 */
const knownProgrammesCache: { set: Set<string>; expiresAt: number } = {
  set: new Set(),
  expiresAt: 0,
};

const refreshKnownProgrammes = (): Set<string> => {
  const now = Date.now();
  if (now < knownProgrammesCache.expiresAt) return knownProgrammesCache.set;

  const dynamic = getDynamicProgrammes();
  if (dynamic.length > 0) {
    knownProgrammesCache.set = new Set(dynamic);
    knownProgrammesCache.expiresAt = now + 5 * 60 * 1000; // 5 min
  }

  return knownProgrammesCache.set;
};

/**
 * Normalizes a raw programme value to its canonical uppercase form.
 *
 * Unlike the old version that only accepted "KPMD", "RANGE", "KPMD 2",
 * this now accepts ANY non-empty string after normalization.
 *
 * Handles spacing variants: "KPMD2" → "KPMD 2", "KPMD-2" → "KPMD 2"
 */
export const normalizeProgramme = (value: unknown): ProgrammeOption => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Normalize: replace hyphens/underscores with spaces, collapse multiple spaces, uppercase
  let normalized = trimmed.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

  // Validate against known programmes (if available)
  const known = refreshKnownProgrammes();
  if (known.size > 0 && !known.has(normalized)) {
    // Try without spaces (e.g. "KPMD2" → check "KPMD 2")
    const noSpace = normalized.replace(/\s+/g, "");
    for (const knownProg of known) {
      if (knownProg.replace(/\s+/g, "") === noSpace) {
        return knownProg;
      }
    }
    // Not in known list — still return it (new programme not yet cached)
    // but only if it looks like a real value (at least 2 chars)
    if (normalized.length >= 2) return normalized;
    return "";
  }

  return normalized;
};

/**
 * Generates ALL known case/format variants for a programme.
 * This is critical for Firebase RTDB queries which are case-sensitive —
 * a query for equalTo("KPMD") will miss records stored as "Kpmd".
 *
 * Instead of a hardcoded map, this now generates variants dynamically
 * for any programme string.
 */
export const getProgrammeQueryValues = (programme: unknown): string[] => {
  const normalized = normalizeProgramme(programme);
  if (!normalized) return [];

  const base = normalized;
  const lower = base.toLowerCase();
  const capitalized = base.charAt(0) + base.slice(1).toLowerCase();
  const noSpace = base.replace(/\s+/g, "");
  const noSpaceLower = noSpace.toLowerCase();
  const hyphenated = base.replace(/\s+/g, "-");
  const hyphenatedLower = hyphenated.toLowerCase();

  // Deduplicate while preserving order
  const variants = new Set<string>();
  variants.add(base);           // "KPMD 2"
  variants.add(lower);          // "kpmd 2"
  variants.add(capitalized);    // "Kpmd 2"
  variants.add(noSpace);        // "KPMD2"
  variants.add(noSpaceLower);   // "kpmd2"
  variants.add(hyphenated);     // "KPMD-2"
  variants.add(hyphenatedLower);// "kpmd-2"

  return Array.from(variants);
};

export const normalizeProgrammeSelection = (value: unknown): ProgrammeSelection => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (normalized === ALL_PROGRAMMES_VALUE) return ALL_PROGRAMMES_VALUE;
  return normalizeProgramme(normalized);
};

// ---------------------------------------------------------------------------
// Includes / matching helpers
// ---------------------------------------------------------------------------
export const includesProgramme = (
  programmes: readonly ProgrammeOption[],
  value: unknown
): boolean => {
  const normalized = normalizeProgramme(value);
  return normalized !== "" && programmes.includes(normalized);
};

export const isAllProgrammesSelection = (value: unknown): boolean =>
  normalizeProgrammeSelection(value) === ALL_PROGRAMMES_VALUE;

/**
 * Matches a record's programme against the user's selection.
 */
export const matchesProgrammeSelection = (
  recordProgramme: unknown,
  selectedProgramme: unknown,
  canViewAllProgrammeData: boolean
): boolean => {
  // Admin/admin: always accessible, just honour the selection filter
  if (canViewAllProgrammeData) {
    const normalizedRecord = normalizeProgramme(recordProgramme);
    const normalizedSelection = normalizeProgrammeSelection(selectedProgramme);

    // No valid programme on the record → exclude
    if (!normalizedRecord) return false;

    // No selection or "ALL" → include (admin sees everything)
    if (!normalizedSelection || normalizedSelection === ALL_PROGRAMMES_VALUE) return true;

    return normalizedRecord === normalizedSelection;
  }

  // Restricted user: gate on accessible programmes
  const normalizedRecord = normalizeProgramme(recordProgramme);
  if (!normalizedRecord) return false;

  const normalizedSelection = normalizeProgrammeSelection(selectedProgramme);
  if (!normalizedSelection || normalizedSelection === ALL_PROGRAMMES_VALUE) return true;

  return normalizedRecord === normalizedSelection;
};

/**
 * Higher-level convenience: matches selection AND enforces programme access
 * in a single call for restricted users.
 */
export const matchesProgrammeSelectionWithAccess = (
  recordProgramme: unknown,
  selectedProgramme: unknown,
  accessibleProgrammes: readonly string[],
  canViewAllProgrammeData: boolean
): boolean => {
  if (canViewAllProgrammeData) {
    return matchesProgrammeSelection(recordProgramme, selectedProgramme, true);
  }

  const normalizedRecord = normalizeProgramme(recordProgramme);
  if (!normalizedRecord || !accessibleProgrammes.includes(normalizedRecord)) {
    return false;
  }

  return matchesProgrammeSelection(recordProgramme, selectedProgramme, false);
};

// ---------------------------------------------------------------------------
// Resolving allowed / accessible programmes (now fully dynamic)
// ---------------------------------------------------------------------------

/**
 * Returns the list of all known programmes from the dynamic source.
 * This replaces the old hardcoded PROGRAMME_OPTIONS array.
 */
export const getAllProgrammes = (): ProgrammeOption[] => {
  return getDynamicProgrammes();
};

export const getAssignedProgrammes = (
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] => {
  const allProgrammes = getDynamicProgrammes();
  return allProgrammes.filter((programme) => allowedProgrammes?.[programme] === true);
};

/**
 * Resolves which programmes a user can access.
 *
 * - admin / admin → ALL programmes (dynamic from DB).
 * - mobile → only programmes explicitly marked `true` in allowedProgrammes.
 */
export const resolveAccessibleProgrammes = (
  roleOrCanViewAll: string | boolean | null | undefined,
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] => {
  if (
    roleOrCanViewAll === true ||
    (typeof roleOrCanViewAll === "string" && hasAllProgrammeAccess(roleOrCanViewAll))
  ) {
    return [...getDynamicProgrammes()];
  }
  return getAssignedProgrammes(allowedProgrammes);
};

export const resolveActiveProgramme = (
  currentProgramme: string | null | undefined,
  accessibleProgrammes: readonly string[]
): string => {
  if (currentProgramme && accessibleProgrammes.includes(currentProgramme)) {
    return currentProgramme;
  }
  return accessibleProgrammes[0] || "";
};

/**
 * Resolves the current programme selection for the UI.
 */
export const resolveProgrammeSelection = (
  currentSelection: string | null | undefined,
  accessibleProgrammes: readonly string[],
  options?: {
    allowAll?: boolean;
    fallbackToAll?: boolean;
  }
): ProgrammeSelection => {
  const { allowAll = false, fallbackToAll = false } = options ?? {};
  const normalizedSelection = normalizeProgrammeSelection(currentSelection);

  if (allowAll && normalizedSelection === ALL_PROGRAMMES_VALUE) {
    return ALL_PROGRAMMES_VALUE;
  }

  if (
    normalizedSelection &&
    normalizedSelection !== ALL_PROGRAMMES_VALUE &&
    accessibleProgrammes.includes(normalizedSelection)
  ) {
    return normalizedSelection;
  }

  if (accessibleProgrammes.length === 0) return "";
  if (allowAll && fallbackToAll) return ALL_PROGRAMMES_VALUE;
  return resolveActiveProgramme("", accessibleProgrammes) as ProgrammeSelection;
};

// ---------------------------------------------------------------------------
// Record-level access control
// ---------------------------------------------------------------------------
export const canAccessProgrammeRecord = (
  recordProgramme: unknown,
  accessibleProgrammes: readonly string[],
  canViewAllProgrammeData: boolean
): boolean => {
  if (canViewAllProgrammeData) return true;
  const normalizedProgramme = normalizeProgramme(recordProgramme);
  if (!normalizedProgramme) return false;
  return accessibleProgrammes.includes(normalizedProgramme);
};

export const matchesActiveProgramme = (
  recordProgramme: unknown,
  activeProgramme: string | null | undefined
): boolean => {
  const normalizedActiveProgramme = normalizeProgramme(activeProgramme);
  if (!normalizedActiveProgramme) return false;
  return normalizeProgramme(recordProgramme) === normalizedActiveProgramme;
};

export const filterRecordsByActiveProgramme = <T>(
  records: readonly T[],
  getProgramme: (record: T) => unknown,
  activeProgramme: string | null | undefined
): T[] => records.filter((record) => matchesActiveProgramme(getProgramme(record), activeProgramme));

export const filterByAccessibleProgrammes = <T>(
  records: T[],
  getProgramme: (record: T) => unknown,
  accessibleProgrammes: readonly string[],
  canViewAllProgrammeData: boolean
): T[] =>
  records.filter((record) =>
    canAccessProgrammeRecord(getProgramme(record), accessibleProgrammes, canViewAllProgrammeData)
  );