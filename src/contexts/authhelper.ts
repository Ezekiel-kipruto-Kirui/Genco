const normalizeText = (value: string) => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "chief admin") return "chief-admin";
  return normalized;
};

const HR_IDENTIFIERS = new Set([
  "humman resource manager",
  "human resource manager",
  "humman resource manger",
  "human resource manger",
  "hr",
]);

const PROJECT_MANAGER_IDENTIFIERS = new Set(["project manager", "project officer"]);
const FINANCE_IDENTIFIERS = new Set(["finance"]);
const OFFTAKE_IDENTIFIERS = new Set(["offtake officer"]);
const MOBILE_IDENTIFIERS = new Set(["mobile", "mobile user"]);
const ME_IDENTIFIERS = new Set([
  "m&e officer",
  "mne officer",
  "me officer",
  "monitoring and evaluation officer",
  "monitoring & evaluation officer",
]);
const FULL_ACCESS_ATTRIBUTE_IDENTIFIERS = new Set([
  "ceo",
  "chief executive officer",
  "chief operations manager",
  "chief operational manager",
  "chief operational officer",
  "chief operatons manger",
  "m&e officer",
  "mne officer",
  "me officer",
  "monitoring and evaluation officer",
  "monitoring & evaluation officer",
]);
const PROGRAMME_OPTIONS = ["KPMD", "RANGE"] as const;
const DISPLAY_NAME_MAP: Record<string, string> = {
  admin: "Admin",
  "chief-admin": "Chief Admin",
  "chief admin": "Chief Admin",
  mobile: "Mobile User",
  user: "User",
  ceo: "CEO",
  cio: "CEO",
  "chief executive officer": "Chief Executive Officer",
  "project manager": "Project Manager",
  "project officer": "Project Officer",
  "humman resource manager": "Human Resource Manager",
  "human resource manager": "Human Resource Manager",
  "humman resource manger": "Human Resource Manager",
  "human resource manger": "Human Resource Manager",
  finance: "Finance",
  "offtake officer": "Offtake Officer",
  "chief operations manager": "Chief Operations Manager",
  "chief operational manager": "Chief Operations Manager",
  "chief operational officer": "Chief Operations Manager",
  "chief operatons manger": "Chief Operations Manager",
  "chief executive officer": "Chief Executive Officer",
  "m&e officer": "M&E Officer",
  "mne officer": "M&E Officer",
  "me officer": "M&E Officer",
  "monitoring and evaluation officer": "M&E Officer",
  "monitoring & evaluation officer": "M&E Officer",
};

const toTitleCase = (value: string): string =>
  value
    .split("-")
    .join(" ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatDisplayName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = normalizeText(trimmed);
  const mappedDisplayName = DISPLAY_NAME_MAP[normalized];
  if (mappedDisplayName) return mappedDisplayName;

  if (/[A-Z]/.test(trimmed)) return trimmed;
  return toTitleCase(normalized);
};

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

export const isProjectManager = (value: string | null | undefined): boolean => {
  const normalized = normalizeAttribute(value) || normalizeRole(value);
  return PROJECT_MANAGER_IDENTIFIERS.has(normalized);
};

export const isHummanResourceManager = (value: string | null | undefined): boolean => {
  const normalized = normalizeAttribute(value) || normalizeRole(value);
  return HR_IDENTIFIERS.has(normalized);
};

export const isFinance = (value: string | null | undefined): boolean => {
  const normalized = normalizeAttribute(value) || normalizeRole(value);
  return FINANCE_IDENTIFIERS.has(normalized);
};

export const isOfftakeOfficer = (value: string | null | undefined): boolean => {
  const normalized = normalizeAttribute(value) || normalizeRole(value);
  return OFFTAKE_IDENTIFIERS.has(normalized);
};

export const isMobileUser = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  const normalizedRole = normalizeRole(userRole);
  const normalizedAttribute = normalizeAttribute(userAttribute);
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  return (
    MOBILE_IDENTIFIERS.has(normalizedRole) ||
    MOBILE_IDENTIFIERS.has(normalizedAttribute) ||
    MOBILE_IDENTIFIERS.has(principal)
  );
};

export const isMonitoringAndEvaluationOfficer = (
  value: string | null | undefined
): boolean => {
  const normalized = normalizeAttribute(value) || normalizeRole(value);
  return ME_IDENTIFIERS.has(normalized);
};

export const isFullAccessAttribute = (value: string | null | undefined): boolean =>
  FULL_ACCESS_ATTRIBUTE_IDENTIFIERS.has(normalizeAttribute(value));

export const canViewAllProgrammes = (
  userRole: string | null | undefined,
  userAttribute?: string | null,
  allowedProgrammes?: Record<string, boolean> | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  const hasRoleBasedFullAccess = (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isOfftakeOfficer(principal)
  );
  if (!hasRoleBasedFullAccess) return false;

  const assignedProgrammes = PROGRAMME_OPTIONS.filter(
    (programme) => allowedProgrammes?.[programme] === true
  );

  if (assignedProgrammes.length === 0) return true;
  return assignedProgrammes.length >= PROGRAMME_OPTIONS.length;
};

export const canAccessDashboard = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFinance(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isOfftakeOfficer(principal) ||
    isFullAccessAttribute(principal)
  );
};

export const canAccessReports = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (
    isFinance(principal) ||
    isOfftakeOfficer(principal)
  ) {
    return false;
  }

  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal)
  );
};

export const canAccessSiteManagement = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
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

export const canAccessUserManagement = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  return isChiefAdmin(userRole) || isChiefAdmin(userAttribute);
};

export const canAccessFarmerData = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isProjectManager(principal) ||
    isMonitoringAndEvaluationOfficer(principal)
  );
};

export const canAccessInfrastructure = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return canAccessFarmerData(userRole, userAttribute) || isHummanResourceManager(principal);
};

export const canManageInfrastructureRecords = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return isChiefAdmin(principal);
};

export const canAccessFieldActivities = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isFinance(principal) ||
    isMonitoringAndEvaluationOfficer(principal)
  );
};

export const canAccessProjectManagerSection = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isProjectManager(principal) ||
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isMonitoringAndEvaluationOfficer(principal)
  );
};

export const canAccessHrManagement = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isHummanResourceManager(principal) ||
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal)
  );
};

export const canAccessFinanceSection = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isFinance(principal) ||
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal)
  );
};

export const canAccessRequisition = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal) ||
    isProjectManager(principal) ||
    isHummanResourceManager(principal) ||
    isFinance(principal)
  );
};

export const canAccessOrdersSection = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  return (
    isOfftakeOfficer(principal) ||
    isChiefAdmin(principal) ||
    isAdmin(principal) ||
    isFullAccessAttribute(principal)
  );
};

export const getLandingRouteForRole = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): string => {
  if (isMobileUser(userRole, userAttribute)) return "/auth";
  const principal = resolvePermissionPrincipal(userRole, userAttribute);

  if (isOfftakeOfficer(principal)) return "/orders";
  if (canAccessDashboard(userRole, userAttribute)) return "/dashboard";
  return "/auth";
};

export const hasAnyRole = (
  userRole: string | null | undefined,
  allowedRoles: string[],
  userAttribute?: string | null
): boolean => {
  if (isMobileUser(userRole, userAttribute)) return false;
  const normalizedRole = normalizeRole(userRole);
  const normalizedAttribute = normalizeAttribute(userAttribute);
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  const permissionTokens = Array.from(
    new Set([normalizedRole, normalizedAttribute, principal].filter(Boolean))
  );

  return allowedRoles
    .map(normalizeText)
    .some((allowedRole) => {
      if (HR_IDENTIFIERS.has(allowedRole)) return permissionTokens.some((token) => isHummanResourceManager(token));
      if (PROJECT_MANAGER_IDENTIFIERS.has(allowedRole)) return permissionTokens.some((token) => isProjectManager(token));
      if (FINANCE_IDENTIFIERS.has(allowedRole)) return permissionTokens.some((token) => isFinance(token));
      if (OFFTAKE_IDENTIFIERS.has(allowedRole)) return permissionTokens.some((token) => isOfftakeOfficer(token));
      if (FULL_ACCESS_ATTRIBUTE_IDENTIFIERS.has(allowedRole)) return permissionTokens.some((token) => isFullAccessAttribute(token));
      return permissionTokens.includes(allowedRole);
    });
};

export const getRoleDisplayName = (
  userRole: string | null | undefined,
  userAttribute?: string | null
): string => {
  const attribute = typeof userAttribute === "string" ? userAttribute.trim() : "";
  if (attribute) return formatDisplayName(attribute);

  const role = typeof userRole === "string" ? userRole.trim() : "";
  if (!role) return "User";
  return formatDisplayName(role);
};
