export const PROGRAMME_OPTIONS = ["KPMD", "RANGE", "MTLDK"] as const;
export const ALL_PROGRAMMES_VALUE = "ALL" as const;

export type ProgrammeOption = (typeof PROGRAMME_OPTIONS)[number];
export type ProgrammeSelection = ProgrammeOption | typeof ALL_PROGRAMMES_VALUE | "";

// ---------------------------------------------------------------------------
// Roles that bypass programme-level restrictions entirely
// ---------------------------------------------------------------------------
const PROGRAMME_ACCESS_BYPASS_ROLES = ["admin", "chief-admin"] as const;
export type BypassRole = (typeof PROGRAMME_ACCESS_BYPASS_ROLES)[number];

/**
 * Determines whether a user's role grants unrestricted access to all
 * programmes. Only admin and chief-admin roles bypass the restriction.
 * Mobile users are ALWAYS scoped to their allowedProgrammes.
 */
export const hasAllProgrammeAccess = (role: string | null | undefined): boolean =>
  !!role && (PROGRAMME_ACCESS_BYPASS_ROLES as readonly string[]).includes(role);

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------
export const normalizeProgramme = (value: unknown): ProgrammeOption | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (normalized === "KPMD" || normalized === "RANGE" || normalized === "MTLDK") return normalized;
  return "";
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
 *
 * For users with all-programme access (admin/chief-admin), the record is
 * always included regardless of its programme — the selection filter is
 * purely a UI convenience for them.
 *
 * For restricted users (mobile), the record's programme MUST be in their
 * accessible set BEFORE the selection filter is applied.
 */
export const matchesProgrammeSelection = (
  recordProgramme: unknown,
  selectedProgramme: unknown,
  canViewAllProgrammeData: boolean
): boolean => {
  // Admin/chief-admin: always accessible, just honour the selection filter
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
  // NOTE: caller MUST pass accessibleProgrammes separately to the higher-level
  // helper `matchesProgrammeSelectionWithAccess`, or pre-filter records first
  // using `filterByAccessibleProgrammes`.
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
// Resolving allowed / accessible programmes
// ---------------------------------------------------------------------------
export const getAssignedProgrammes = (
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] =>
  PROGRAMME_OPTIONS.filter((programme) => allowedProgrammes?.[programme] === true);

/**
 * Resolves which programmes a user can access.
 *
 * - admin / chief-admin → ALL programmes (bypass).
 * - mobile → only programmes explicitly marked `true` in allowedProgrammes.
 */
export const resolveAccessibleProgrammes = (
  role: string | null | undefined,
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] => {
  if (hasAllProgrammeAccess(role)) return [...PROGRAMME_OPTIONS];
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
 *
 * - `allowAll`:       lets the selection be "ALL" (meaningful for admins
 *                      who truly see all programmes, and for mobile users
 *                      whose "ALL" means "all of my assigned programmes").
 * - `fallbackToAll`:  if the stored selection is no longer valid, fall back
 *                      to "ALL" instead of the first individual programme.
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

export const filterByAccessibleProgrammes = <T>(
  records: T[],
  getProgramme: (record: T) => unknown,
  accessibleProgrammes: readonly string[],
  canViewAllProgrammeData: boolean
): T[] =>
  records.filter((record) =>
    canAccessProgrammeRecord(getProgramme(record), accessibleProgrammes, canViewAllProgrammeData)
  );