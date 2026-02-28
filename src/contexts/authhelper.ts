const normalizeText = (value: string) => value.toLowerCase().trim().replace(/\s+/g, " ");

const HR_IDENTIFIERS = new Set([
  "humman resource manager",
  "human resource manager",
  "humman resource manger",
  "human resource manger",
  "hr",
]);

const PROJECT_MANAGER_IDENTIFIERS = new Set(["project manager"]);
const FINANCE_IDENTIFIERS = new Set(["finance"]);
const OFFTAKE_IDENTIFIERS = new Set(["offtake officer"]);
const ME_IDENTIFIERS = new Set([
  "m&e officer",
  "mne officer",
  "me officer",
  "monitoring and evaluation officer",
  "monitoring & evaluation officer",
]);
const FULL_ACCESS_ATTRIBUTE_IDENTIFIERS = new Set([
  "ceo",
  "chief operations manager",
  "chief operational manager",
  "chief operatons manger",
  "m&e officer",
  "mne officer",
]);

const toTitleCase = (value: string): string =>
  value
    .split("-")
    .join(" ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const normalizeRole = (userRole: string | null | undefined): string => {
  if (!userRole) return "";
  return normalizeText(userRole);
};

export const normalizeAttribute = (userAttribute: string | null | undefined): string => {
  if (!userAttribute) return "";
  return normalizeText(userAttribute);
};

export const resolvePermissionPrincipal = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): string => {
  const normalizedAttribute = normalizeAttribute(userAttribute);
  if (normalizedAttribute) return normalizedAttribute;
  return normalizeRole(userRole);
};

export const isChiefAdmin = (value: string | null | undefined): boolean => normalizeRole(value) === "chief-admin";

export const isAdmin = (value: string | null | undefined): boolean => normalizeRole(value) === "admin";

export const isProjectManager = (value: string | null | undefined): boolean =>
  PROJECT_MANAGER_IDENTIFIERS.has(normalizeRole(value));

export const isHummanResourceManager = (value: string | null | undefined): boolean =>
  HR_IDENTIFIERS.has(normalizeRole(value));

export const isFinance = (value: string | null | undefined): boolean =>
  FINANCE_IDENTIFIERS.has(normalizeRole(value));

export const isOfftakeOfficer = (value: string | null | undefined): boolean =>
  OFFTAKE_IDENTIFIERS.has(normalizeRole(value));

export const isMonitoringAndEvaluationOfficer = (
  value: string | null | undefined
): boolean => ME_IDENTIFIERS.has(normalizeRole(value));

export const isFullAccessAttribute = (value: string | null | undefined): boolean =>
  FULL_ACCESS_ATTRIBUTE_IDENTIFIERS.has(normalizeRole(value));

export const canViewAllProgrammes = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (
    isFinance(principal) ||
    isOfftakeOfficer(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal)
  ) {
    return false;
  }

  return isChiefAdmin(principal) || isAdmin(principal) || isFullAccessAttribute(principal);
};

export const canAccessDashboard = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  if (isFinance(principal) || isOfftakeOfficer(principal)) return false;
  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isFullAccessAttribute(principal)
  );
};

export const canAccessReports = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isFinance(principal) ||
    isOfftakeOfficer(principal)
  ) {
    return false;
  }

  return isChiefAdmin(principal) || isAdmin(principal) || isFullAccessAttribute(principal);
};

export const canAccessSiteManagement = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isFinance(principal) ||
    isOfftakeOfficer(principal)
  ) {
    return false;
  }

  return isChiefAdmin(principal) || isAdmin(principal) || isFullAccessAttribute(principal);
};

export const getLandingRouteForRole = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): string => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (isFinance(principal)) return "/requisition";
  if (isOfftakeOfficer(principal)) return "/orders";
  if (canAccessDashboard(userRole, userAttribute)) return "/dashboard";
  return "/auth";
};

export const hasAnyRole = (
  userRole: string | null | undefined,
  allowedRoles: string[],
  userAttribute?: string | null
): boolean => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  return allowedRoles
    .map(normalizeText)
    .some((allowedRole) => {
      if (HR_IDENTIFIERS.has(allowedRole)) return isHummanResourceManager(principal);
      if (PROJECT_MANAGER_IDENTIFIERS.has(allowedRole)) return isProjectManager(principal);
      if (FINANCE_IDENTIFIERS.has(allowedRole)) return isFinance(principal);
      if (OFFTAKE_IDENTIFIERS.has(allowedRole)) return isOfftakeOfficer(principal);
      if (FULL_ACCESS_ATTRIBUTE_IDENTIFIERS.has(allowedRole)) return isFullAccessAttribute(principal);
      return allowedRole === principal;
    });
};

export const getRoleDisplayName = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): string => {
  const attribute = normalizeAttribute(userAttribute);
  if (attribute) return toTitleCase(attribute);

  const role = normalizeRole(userRole);
  if (!role) return "User";
  return toTitleCase(role);
};
