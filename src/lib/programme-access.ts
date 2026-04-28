export const PROGRAMME_OPTIONS = ["KPMD", "RANGE", "MTLDK"] as const;
export const ALL_PROGRAMMES_VALUE = "ALL" as const;

export type ProgrammeOption = (typeof PROGRAMME_OPTIONS)[number];
export type ProgrammeSelection = ProgrammeOption | typeof ALL_PROGRAMMES_VALUE | "";

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

export const includesProgramme = (
  programmes: readonly ProgrammeOption[],
  value: unknown
): boolean => {
  const normalized = normalizeProgramme(value);
  return normalized !== "" && programmes.includes(normalized);
};

export const isAllProgrammesSelection = (value: unknown): boolean =>
  normalizeProgrammeSelection(value) === ALL_PROGRAMMES_VALUE;

export const matchesProgrammeSelection = (
  recordProgramme: unknown,
  selectedProgramme: unknown
): boolean => {
  const normalizedSelection = normalizeProgrammeSelection(selectedProgramme);
  if (!normalizedSelection || normalizedSelection === ALL_PROGRAMMES_VALUE) return true;
  return normalizeProgramme(recordProgramme) === normalizedSelection;
};

export const getAssignedProgrammes = (
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] =>
  PROGRAMME_OPTIONS.filter((programme) => allowedProgrammes?.[programme] === true);

export const resolveAccessibleProgrammes = (
  canViewAllProgrammeData: boolean,
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] => {
  if (canViewAllProgrammeData) return [...PROGRAMME_OPTIONS];
  return getAssignedProgrammes(allowedProgrammes);
};

export const resolveActiveProgramme = (
  currentProgramme: string | null | undefined,
  accessibleProgrammes: readonly string[]
): string => {
  if (currentProgramme && accessibleProgrammes.includes(currentProgramme)) return currentProgramme;
  return accessibleProgrammes[0] || "";
};

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
