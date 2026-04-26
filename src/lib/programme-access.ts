export const PROGRAMME_OPTIONS = ["KPMD", "RANGE", "MTLDK"] as const;

export type ProgrammeOption = (typeof PROGRAMME_OPTIONS)[number];

export const normalizeProgramme = (value: unknown): ProgrammeOption | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (normalized === "KPMD" || normalized === "RANGE" || normalized === "MTLDK") return normalized;
  return "";
};

export const includesProgramme = (
  programmes: readonly ProgrammeOption[],
  value: unknown
): boolean => {
  const normalized = normalizeProgramme(value);
  return normalized !== "" && programmes.includes(normalized);
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
