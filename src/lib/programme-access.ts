export const PROGRAMME_OPTIONS = ["KPMD", "RANGE"] as const;

export type ProgrammeOption = (typeof PROGRAMME_OPTIONS)[number];

export const normalizeProgramme = (value: unknown): ProgrammeOption | "" => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toUpperCase();
  if (normalized === "KPMD" || normalized === "RANGE") return normalized;
  return "";
};

export const getAssignedProgrammes = (
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] =>
  PROGRAMME_OPTIONS.filter((programme) => allowedProgrammes?.[programme] === true);

export const resolveAccessibleProgrammes = (
  canViewAllProgrammeData: boolean,
  allowedProgrammes: Record<string, boolean> | null | undefined
): ProgrammeOption[] => {
  const assignedProgrammes = getAssignedProgrammes(allowedProgrammes);
  if (assignedProgrammes.length > 0) return assignedProgrammes;
  return canViewAllProgrammeData ? [...PROGRAMME_OPTIONS] : [];
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
