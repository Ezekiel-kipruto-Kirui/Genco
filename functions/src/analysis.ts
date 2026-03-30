/* eslint-disable max-len */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";

const PROGRAMME_OPTIONS = ["KPMD", "RANGE"] as const;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CHART_COLORS = {
  male: "#1e3a8a",
  female: "#f97316",
  goats: "#16a34a",
  sheep: "#f97316",
  fallback: "#f59e0b",
};
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type AnalysisScope =
  | "overview"
  | "livestock-analytics"
  | "performance-report"
  | "sales-report";

const VALID_SCOPES = new Set<AnalysisScope>([
  "overview",
  "livestock-analytics",
  "performance-report",
  "sales-report",
]);

interface AnalysisRequest {
  scope?: AnalysisScope | string;
  programme?: string | null;
  dateRange?: {startDate?: string; endDate?: string} | null;
  timeFrame?: "weekly" | "monthly" | "yearly" | string | null;
  selectedYear?: number | string | null;
  target?: number | null;
  salesInputs?: {pricePerKg?: number | string | null; expenses?: number | string | null} | null;
}

interface AnalysisProfile {
  uid: string;
  role: string;
  userAttribute: string;
  allowedProgrammes: string[];
}

interface CacheEntry {
  expiresAt: number;
  value: any;
}

const cache = new Map<string, CacheEntry>();

const normalize = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const toProgramme = (value: unknown): string => {
  const normalized = normalize(value);
  if (!normalized) return "";
  if (normalized === "all") return "ALL";
  return normalized.toUpperCase();
};

const parseNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  return false;
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object" && value !== null) {
    const maybeDate = value as {seconds?: number; toDate?: () => Date};
    if (typeof maybeDate.toDate === "function") {
      const parsed = maybeDate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof maybeDate.seconds === "number" && Number.isFinite(maybeDate.seconds)) {
      const parsed = new Date(maybeDate.seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
};

const dateInRange = (
  value: unknown,
  startDate?: string,
  endDate?: string,
): boolean => {
  if (!startDate && !endDate) return true;
  const parsed = parseDate(value);
  if (!parsed) return false;

  const current = new Date(parsed);
  current.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);

  if (start && current < start) return false;
  if (end && current > end) return false;
  return true;
};

const getGoatTotal = (goats: unknown): number => {
  if (typeof goats === "number" || typeof goats === "string") return parseNumber(goats);
  if (typeof goats === "object" && goats !== null) {
    const record = goats as {total?: unknown; male?: unknown; female?: unknown};
    if (record.total !== undefined) return parseNumber(record.total);
    return parseNumber(record.male) + parseNumber(record.female);
  }
  return 0;
};

const getFieldNumber = (record: Record<string, unknown>, ...fields: string[]): number => {
  for (const field of fields) {
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    const parsed = parseNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const getArrayLikeSize = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
};

const normalizeLooseText = (value: unknown): string =>
  typeof value === "string" ?
    value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ") :
    "";

const getLeaderName = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
};

const getOfftakeGoatsTotal = (record: Record<string, unknown>): number =>
  Math.max(
    getFieldNumber(record, "totalGoats"),
    getFieldNumber(record, "goatsBought"),
    getArrayLikeSize(record.goats),
    getArrayLikeSize(record.Goats),
    getFieldNumber(record, "goats"),
    0,
  );

const getOrderEntries = (orders: unknown): Record<string, unknown>[] => {
  if (Array.isArray(orders)) return orders.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  if (orders && typeof orders === "object") {
    return Object.values(orders).filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
  }
  return [];
};

const getOrderReferenceId = (record: Record<string, unknown>): string => {
  const recordId = String(record.id || "").trim();
  const candidates = [
    record.parentOrderId,
    record.requestId,
    record.targetOrderId,
    record.offtakeOrderId,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized && normalized !== recordId) return normalized;
  }

  return "";
};

const getOrderTotalGoats = (record: Record<string, unknown>): number => {
  const itemsTotal = getOrderEntries(record.orders).reduce(
    (sum, item) => sum + getFieldNumber(item, "goats"),
    0,
  );

  return Math.max(
    itemsTotal,
    getFieldNumber(record, "totalGoats"),
    getFieldNumber(record, "goats"),
    getFieldNumber(record, "goatsBought") + getFieldNumber(record, "remainingGoats"),
    0,
  );
};

const isBatchOrderRecord = (record: Record<string, unknown>): boolean => {
  if (getOrderReferenceId(record)) return false;

  const hasEmbeddedOrders = getOrderEntries(record.orders).length > 0;
  const hasTarget = getOrderTotalGoats(record) > 0;
  const sourcePage = normalizeLooseText(record.sourcePage);

  if (sourcePage && sourcePage !== "orders" && !hasEmbeddedOrders && getFieldNumber(record, "totalGoats") <= 0) {
    return false;
  }

  return hasEmbeddedOrders || hasTarget;
};

const getOrderRecordDate = (record: Record<string, unknown>): unknown =>
  record.date || record.completedAt || record.createdAt || record.timestamp;

const getRequisitionRequestedAmount = (record: Record<string, unknown>): number => {
  const recordType = normalize(record.type);
  if (recordType === "fuel and service") {
    return Math.max(getFieldNumber(record, "fuelAmount"), getFieldNumber(record, "totalAmount"), 0);
  }

  return Math.max(getFieldNumber(record, "total"), getFieldNumber(record, "totalAmount"), 0);
};

const getRequisitionRecordDate = (record: Record<string, unknown>): unknown =>
  record.submittedAt ||
  record.createdAt ||
  record.approvedAt ||
  record.authorizedAt ||
  record.transactionCompletedAt ||
  record.completedAt ||
  record.rejectedAt;

const getActivityTotalDoses = (record: Record<string, unknown>): number => {
  if (Array.isArray(record.vaccines)) {
    return record.vaccines.reduce((sum, vaccine) => {
      if (!vaccine || typeof vaccine !== "object") return sum;
      return sum + parseNumber((vaccine as Record<string, unknown>).doses);
    }, 0);
  }

  return getFieldNumber(record, "number_doses");
};

const getActivityLocationName = (record: Record<string, unknown>): string =>
  String(
    record.location ||
      record.Location ||
      record.subcounty ||
      record.Subcounty ||
      record.county ||
      record.County ||
      "Unknown",
  ).trim() || "Unknown";

const getInfrastructureRecordDate = (record: Record<string, unknown>): Date | null =>
  parseDate(record.date ?? record.Date ?? record.created_at ?? record.createdAt);

const getInfrastructureStatuses = (record: Record<string, unknown>) => ({
  drilled: parseBoolean(record.drilled ?? record.Drilled),
  equipped: parseBoolean(record.equipped ?? record.Equipped),
  rehabilitated: parseBoolean(record.rehabilitated ?? record.Rehabilitated),
  maintained: parseBoolean(record.maintained ?? record.Maintained),
});

const getOverviewComparisonYears = (referenceDate: Date = new Date()) => ({
  year1: referenceDate.getFullYear(),
  year2: referenceDate.getFullYear() - 1,
});

const buildOverviewVaccinationTrend = (
  animalHealthRecords: Record<string, unknown>[],
  comparisonYears = getOverviewComparisonYears(),
) => {
  const trend = MONTH_LABELS.map((name) => ({name, year1: 0, year2: 0}));

  for (const record of animalHealthRecords) {
    const date = parseDate(record.date || record.createdAt);
    const totalDoses = getActivityTotalDoses(record);
    if (!date || totalDoses <= 0) continue;

    const monthIndex = date.getMonth();
    if (date.getFullYear() === comparisonYears.year1) trend[monthIndex].year1 += totalDoses;
    if (date.getFullYear() === comparisonYears.year2) trend[monthIndex].year2 += totalDoses;
  }

  return trend;
};

const buildInfrastructureComparison = (
  records: Record<string, unknown>[],
  comparisonYears = getOverviewComparisonYears(),
) => {
  let firstYearValue = 0;
  let secondYearValue = 0;

  for (const record of records) {
    const statuses = getInfrastructureStatuses(record);
    if (!statuses.rehabilitated) {
      continue;
    }

    const date = getInfrastructureRecordDate(record);
    if (!date) continue;

    if (date.getFullYear() === comparisonYears.year1) firstYearValue += 1;
    if (date.getFullYear() === comparisonYears.year2) secondYearValue += 1;
  }

  return [
    {name: "Year 1", value: firstYearValue, color: "#2710a1"},
    {name: "Year 2", value: secondYearValue, color: "#f89b0d"},
  ];
};

const buildOverviewRegistrationComparison = (
  farmers: Record<string, unknown>[],
  comparisonYears = getOverviewComparisonYears(),
) => {
  let currentYearRegistrations = 0;
  let lastYearRegistrations = 0;

  for (const farmer of farmers) {
    const date = parseDate(farmer.createdAt || farmer.registrationDate);
    if (!date) continue;

    if (date.getFullYear() === comparisonYears.year1) currentYearRegistrations += 1;
    if (date.getFullYear() === comparisonYears.year2) lastYearRegistrations += 1;
  }

  return [
    {name: "Year 1", value: currentYearRegistrations, color: "#2710a1"},
    {name: "Year 2", value: lastYearRegistrations, color: "#f89b0d"},
  ];
};

const buildOverviewRecentLocations = (activities: Record<string, unknown>[]) => {
  const seen = new Set<string>();

  return [...activities]
    .map((record) => {
      const visitedDate = parseDate(record.date || record.createdAt);
      const location = String(record.location || record.activityName || "").trim();
      const county = String(record.county || record.region || "").trim();

      return {
        name: location || county || "Unknown location",
        county: county || "Unknown county",
        visitedAt: visitedDate ? visitedDate.toISOString() : "",
        timestamp: visitedDate?.getTime() || 0,
      };
    })
    .filter((entry) => entry.name && entry.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((entry) => {
      const key = `${entry.name}|${entry.county}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map(({timestamp, ...entry}) => entry);
};

const getRecordProgramme = (record: Record<string, unknown>): string =>
  toProgramme(record.programme ?? record.Programme);

const filterRecordsByDateRange = <T extends Record<string, unknown>>(
  records: T[],
  getDateValue: (record: T) => unknown,
  dateRange?: {startDate?: string; endDate?: string} | null,
): T[] => records.filter((record) =>
    dateInRange(getDateValue(record), dateRange?.startDate, dateRange?.endDate),
  );

const snapshotToArray = (snapshot: admin.database.DataSnapshot): any[] => {
  if (!snapshot.exists()) return [];
  const value = snapshot.val();
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, any>).map(([id, record]) => ({
    id,
    ...(record as Record<string, any>),
  }));
};

const fetchCollectionByProgrammes = async (
  collectionPath: string,
  programmes: string[],
): Promise<any[]> => {
  const uniqueProgrammes = [...new Set(
    programmes.map((programme) => toProgramme(programme)).filter((programme) => programme && programme !== "ALL"),
  )];

  if (uniqueProgrammes.length === 0) return [];

  const records = await getCollectionRecords(collectionPath);
  return records.filter((record) => {
    const programme = getRecordProgramme(record);
    return Boolean(programme) && uniqueProgrammes.includes(programme);
  });
};

const getAllowedProgrammes = (user: any): string[] => {
  const allowedProgrammes = user?.allowedProgrammes;
  if (!allowedProgrammes || typeof allowedProgrammes !== "object") return [];

  return Object.entries(allowedProgrammes)
    .filter(([, allowed]) => allowed === true)
    .map(([programme]) => toProgramme(programme))
    .filter((programme) => programme && programme !== "ALL");
};

const canViewAllProgrammes = (user: any): boolean => {
  return normalize(user?.role) === "chief-admin";
};

const loadProfile = async (uid: string): Promise<AnalysisProfile | null> => {
  const cachedProfile = getCached(profileCacheKey(uid));
  if (cachedProfile) return cachedProfile as AnalysisProfile;

  const directSnapshot = await admin.database().ref(`users/${uid}`).get();
  let userData = directSnapshot.exists() ? directSnapshot.val() : null;

  if (!userData) {
    const fallbackSnapshot = await admin
      .database()
      .ref("users")
      .orderByChild("uid")
      .equalTo(uid)
      .limitToFirst(1)
      .get();

    if (fallbackSnapshot.exists()) {
      const fallbackData = fallbackSnapshot.val() as Record<string, any>;
      userData = Object.values(fallbackData)[0] || null;
    }
  }

  if (!userData) return null;

  const profile = {
    uid,
    role: normalize(userData.role),
    userAttribute: normalize(userData.accessControl?.customAttribute),
    allowedProgrammes: getAllowedProgrammes(userData),
  };
  setCached(profileCacheKey(uid), profile);
  return profile;
};

const resolveProgrammes = (
  profile: AnalysisProfile,
  requestedProgramme?: string | null,
): string[] => {
  const requested = toProgramme(requestedProgramme);
  const principalProfile = {
    role: profile.role,
    accessControl: {customAttribute: profile.userAttribute},
    allowedProgrammes: profile.allowedProgrammes.reduce<Record<string, boolean>>((accumulator, programme) => {
      accumulator[programme] = true;
      return accumulator;
    }, {}),
  };
  const fullAccess = canViewAllProgrammes(principalProfile);
  const allowed = profile.allowedProgrammes
    .map((programme) => toProgramme(programme))
    .filter((programme) => programme && programme !== "ALL");

  if (fullAccess) {
    if (requested && requested !== "ALL") {
      return PROGRAMME_OPTIONS.includes(requested as (typeof PROGRAMME_OPTIONS)[number]) ?
        [requested] :
        [...PROGRAMME_OPTIONS];
    }
    return [...PROGRAMME_OPTIONS];
  }

  if (allowed.length === 0) return [];
  if (requested && requested !== "ALL") {
    return allowed.includes(requested) ? [requested] : [];
  }
  return allowed;
};

const cacheKey = (uid: string, request: AnalysisRequest): string => {
  const programme = toProgramme(request.programme) || "ALL";
  const startDate = request.dateRange?.startDate || "";
  const endDate = request.dateRange?.endDate || "";
  const timeFrame = request.timeFrame || "";
  const selectedYear = request.selectedYear ?? "";
  const target = request.target ?? "";
  const pricePerKg = request.salesInputs?.pricePerKg ?? "";
  const expenses = request.salesInputs?.expenses ?? "";

  return [
    uid,
    request.scope || "",
    programme,
    startDate,
    endDate,
    timeFrame,
    selectedYear,
    target,
    pricePerKg,
    expenses,
  ].join("|");
};

const profileCacheKey = (uid: string): string => `profile|${uid}`;

const collectionCacheKey = (collectionPath: string): string =>
  `collection|${collectionPath}`;

const getCached = (key: string): any | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const setCached = (key: string, value: any): void => {
  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
};

const getCollectionRecords = async (collectionPath: string): Promise<any[]> => {
  const key = collectionCacheKey(collectionPath);
  const cachedRecords = getCached(key);
  if (cachedRecords) return cachedRecords as any[];

  const snapshot = await admin.database().ref(collectionPath).get();
  const records = snapshotToArray(snapshot);
  setCached(key, records);
  return records;
};

const emptyOverview = () => ({
  scope: "overview",
  resolvedProgrammes: [],
  stats: {
    totalFarmers: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    trainedFarmers: 0,
    maleGoats: 0,
    femaleGoats: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    totalAnimals: 0,
    totalGoatsPurchased: 0,
    regionsVisited: 0,
  },
  topRegions: [],
  comparisonYears: getOverviewComparisonYears(),
  maintainedInfrastructure: [
    {name: "Year 1", value: 0, color: "#2710a1"},
    {name: "Year 2", value: 0, color: "#f89b0d"},
  ],
  registrationComparison: [
    {name: "Year 1", value: 0, color: "#2710a1"},
    {name: "Year 2", value: 0, color: "#f89b0d"},
  ],
  animalCensusVsPurchased: [
    {name: "Goats on record", value: 0, color: "#ffc107"},
    {name: "Goats purchased", value: 0, color: "#a80d10"},
  ],
  vaccinationTrend: MONTH_LABELS.map((name) => ({name, year1: 0, year2: 0})),
  countyCoverage: [],
  recentLocations: [],
  recentActivities: [],
  pendingActivitiesCount: 0,
});

const emptyLivestock = () => ({
  scope: "livestock-analytics",
  resolvedProgrammes: [],
  total: 0,
  trained: 0,
  totalAnimals: 0,
  trainingRate: 0,
  maleFarmers: 0,
  femaleFarmers: 0,
  totalTrainedFromCapacity: 0,
  genderData: [],
  animalCensusData: [],
  weeklyPerformanceData: [],
  subcountyPerformanceData: [],
  userProgressData: [],
});

const emptyPerformance = () => ({
  scope: "performance-report",
  resolvedProgrammes: [],
  totalFarmers: 0,
  maleFarmers: 0,
  femaleFarmers: 0,
  malePercentage: "0.0",
  femalePercentage: "0.0",
  totalAnimals: 0,
  totalGoats: 0,
  totalSheep: 0,
  goatsPercentage: "0.0",
  sheepPercentage: "0.0",
  totalTrainedFarmers: 0,
  countyPerformanceData: [],
  subcountyPerformanceData: [],
  registrationTrendData: [],
  topLocations: [],
  topCustomers: [],
  totalGoatsPurchased: 0,
  topFieldOfficers: [],
  topStaffAwarded: [],
  totalDosesGivenOut: 0,
  uniqueCounties: 0,
  totalBreedsDistributed: 0,
  breedsMale: 0,
  breedsFemale: 0,
  breedsMalePercentage: "0.0",
  breedsFemalePercentage: "0.0",
  farmersWithBreedData: 0,
  vaccinationRate: "0.0",
  vaccinatedAnimals: 0,
  vaccinatedFarmersCount: 0,
  breedsByCountyData: [],
  breedsBySubcountyData: [],
  breedsByLocationData: [],
  vaccinationByCountyData: [],
  vaccinationBySubcountyData: [],
  dosesByLocationData: [],
});

const emptySales = () => ({
  scope: "sales-report",
  resolvedProgrammes: [],
  filteredCount: 0,
  stats: {
    totalPurchaseCost: 0,
    totalRevenue: 0,
    costPerGoat: 0,
    totalAnimals: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    totalLiveWeight: 0,
    avgLiveWeight: 0,
    totalCarcassWeight: 0,
    avgCarcassWeight: 0,
    pricePerKg: 0,
    expenses: 0,
    netProfit: 0,
    avgCostPerKgCarcass: 0,
    totalGoatOrdersPlaced: 0,
    requisitionExpenses: 0,
    totalRequisitions: 0,
  },
  genderData: [],
  countyData: [],
  topLocations: [],
  topFarmers: [],
  monthlyTrend: [],
  requisitionTrend: [],
  top3Months: [],
});

const createOverview = async (
  profile: AnalysisProfile,
  requestedProgramme?: string | null,
) => {
  const programmes = resolveProgrammes(profile, requestedProgramme);
  if (programmes.length === 0) return emptyOverview();
  const comparisonYears = getOverviewComparisonYears();

  const [farmers, activities, capacity, offtakes, animalHealthActivities, boreholes] = await Promise.all([
    fetchCollectionByProgrammes("farmers", programmes),
    fetchCollectionByProgrammes("Recent Activities", programmes),
    fetchCollectionByProgrammes("capacityBuilding", programmes),
    fetchCollectionByProgrammes("offtakes", programmes),
    fetchCollectionByProgrammes("AnimalHealthActivities", programmes),
    fetchCollectionByProgrammes("BoreholeStorage", programmes),
  ]);

  let maleFarmers = 0;
  let femaleFarmers = 0;
  let totalGoats = 0;
  let maleGoats = 0;
  let femaleGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  const regionMap: Record<string, number> = {};

  for (const farmer of farmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    else if (gender === "female") femaleFarmers += 1;

    const goats = getGoatTotal(farmer.goats);
    totalGoats += goats;
    if (farmer.goats && typeof farmer.goats === "object") {
      const goatRecord = farmer.goats as {male?: number; female?: number};
      maleGoats += parseNumber(goatRecord.male);
      femaleGoats += parseNumber(goatRecord.female);
    }
    totalSheep += getFieldNumber(farmer, "sheep");
    totalCattle += getFieldNumber(farmer, "cattle");

    const region = String(farmer.region || farmer.county || "").trim();
    if (region) regionMap[region] = (regionMap[region] || 0) + 1;
  }

  const topRegions = Object.entries(regionMap)
    .map(([name, farmerCount]) => ({name, farmerCount}))
    .sort((a, b) => b.farmerCount - a.farmerCount)
    .slice(0, 4);

  const recentActivities = [...activities]
    .sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0))
    .slice(0, 3)
    .map((record) => ({
      id: record.id,
      activityName: String(record.activityName || ""),
      date: record.date || "",
      status: String(record.status || "pending"),
      location: String(record.location || ""),
      numberOfPersons: parseNumber(record.numberOfPersons),
      county: String(record.county || ""),
      programme: getRecordProgramme(record),
    }));

  const pendingActivitiesCount = activities.filter((record) =>
    String(record.status || "").trim().toLowerCase() === "pending",
  ).length;
  const trainedFarmers = capacity.reduce(
    (sum, record) => sum + parseNumber(record.totalFarmers),
    0,
  );
  const totalAnimals = totalGoats + totalSheep + totalCattle;
  const totalGoatsPurchased = offtakes.reduce(
    (sum, record) => sum + getOfftakeGoatsTotal(record),
    0,
  );
  const countyCoverage = topRegions.map((region, index) => ({
    name: region.name,
    value: region.farmerCount,
    color: ["#2710a1", "#f89b0d", "#ffea00", "#2cb100"][index % 4],
  }));

  return {
    scope: "overview",
    resolvedProgrammes: programmes,
    stats: {
      totalFarmers: farmers.length,
      maleFarmers,
      femaleFarmers,
      trainedFarmers,
      maleGoats,
      femaleGoats,
      totalGoats,
      totalSheep,
      totalCattle,
      totalAnimals,
      totalGoatsPurchased,
      regionsVisited: Object.keys(regionMap).length,
    },
    topRegions,
    comparisonYears,
    maintainedInfrastructure: buildInfrastructureComparison(boreholes, comparisonYears),
    registrationComparison: buildOverviewRegistrationComparison(farmers, comparisonYears),
    animalCensusVsPurchased: [
      {name: "Goats on record", value: totalGoats, color: "#ffc107"},
      {name: "Goats purchased", value: totalGoatsPurchased, color: "#a80d10"},
    ],
    vaccinationTrend: buildOverviewVaccinationTrend(animalHealthActivities, comparisonYears),
    countyCoverage,
    recentLocations: buildOverviewRecentLocations(activities),
    recentActivities,
    pendingActivitiesCount,
  };
};

const createLivestockAnalytics = async (
  profile: AnalysisProfile,
  requestedProgramme?: string | null,
  dateRange?: {startDate?: string; endDate?: string} | null,
  target?: number | null,
) => {
  const programmes = resolveProgrammes(profile, requestedProgramme);
  if (programmes.length === 0) return emptyLivestock();

  const [farmers, training] = await Promise.all([
    fetchCollectionByProgrammes("farmers", programmes),
    fetchCollectionByProgrammes("capacityBuilding", programmes),
  ]);

  const filteredFarmers = filterRecordsByDateRange(
    farmers,
    (farmer) => farmer.createdAt || farmer.registrationDate,
    dateRange,
  );
  const filteredTraining = filterRecordsByDateRange(
    training,
    (record) => record.createdAt || record.startDate,
    dateRange,
  );

  let maleFarmers = 0;
  let femaleFarmers = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  const weeklyBuckets: Record<number, {farmers: number; animals: number}> = {
    1: {farmers: 0, animals: 0},
    2: {farmers: 0, animals: 0},
    3: {farmers: 0, animals: 0},
    4: {farmers: 0, animals: 0},
  };
  const subcountyMap: Record<string, number> = {};
  const userMap: Record<string, {count: number; counties: Set<string>}> = {};

  for (const farmer of filteredFarmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    else if (gender === "female") femaleFarmers += 1;

    const goats = getGoatTotal(farmer.goats);
    const sheep = getFieldNumber(farmer, "sheep");
    totalGoats += goats;
    totalSheep += sheep;

    const date = parseDate(farmer.createdAt || farmer.registrationDate);
    if (date) {
      const week = Math.ceil(date.getDate() / 7);
      if (week >= 1 && week <= 4) {
        weeklyBuckets[week].farmers += 1;
        weeklyBuckets[week].animals += goats + sheep;
      }
    }

    const subcounty = String(farmer.subcounty || "Unknown").trim() || "Unknown";
    subcountyMap[subcounty] = (subcountyMap[subcounty] || 0) + 1;

    const username = String(farmer.username || "Unknown User").trim() || "Unknown User";
    if (!userMap[username]) {
      userMap[username] = {count: 0, counties: new Set<string>()};
    }
    userMap[username].count += 1;
    const county = String(farmer.county || "").trim();
    if (county) userMap[username].counties.add(county);
  }

  const totalTrainedFromCapacity = filteredTraining.reduce(
    (sum, record) => sum + parseNumber(record.totalFarmers),
    0,
  );
  const targetValue = typeof target === "number" && Number.isFinite(target) ? target : 117;
  const totalAnimals = totalGoats + totalSheep;

  const genderData = [
    {name: "Male", value: maleFarmers, color: CHART_COLORS.male},
    {name: "Female", value: femaleFarmers, color: CHART_COLORS.female},
  ].filter((item) => item.value > 0);
  const animalCensusData = [
    {name: "Goats", value: totalGoats, color: CHART_COLORS.goats},
    {name: "Sheep", value: totalSheep, color: CHART_COLORS.sheep},
  ].filter((item) => item.value > 0);
  const weeklyPerformanceData = [
    {name: "Week 1", farmers: weeklyBuckets[1].farmers, animals: weeklyBuckets[1].animals},
    {name: "Week 2", farmers: weeklyBuckets[2].farmers, animals: weeklyBuckets[2].animals},
    {name: "Week 3", farmers: weeklyBuckets[3].farmers, animals: weeklyBuckets[3].animals},
    {name: "Week 4", farmers: weeklyBuckets[4].farmers, animals: weeklyBuckets[4].animals},
  ];
  const subcountyPerformanceData = Object.entries(subcountyMap)
    .map(([name, value]) => ({name, value}))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
  const userProgressData = Object.entries(userMap)
    .map(([name, data]) => {
      const progressPercentage = targetValue > 0 ? (data.count / targetValue) * 100 : 0;
      let status: "achieved" | "on-track" | "behind" | "needs-attention" = "needs-attention";
      if (progressPercentage >= 100) status = "achieved";
      else if (progressPercentage >= 75) status = "on-track";
      else if (progressPercentage >= 50) status = "behind";
      const counties = [...data.counties];
      return {
        id: name,
        name,
        region: counties.slice(0, 3).join(", ") + (counties.length > 3 ? "..." : ""),
        farmersRegistered: data.count,
        target: targetValue,
        progressPercentage,
        status,
      };
    })
    .sort((a, b) => b.farmersRegistered - a.farmersRegistered);

  return {
    scope: "livestock-analytics",
    resolvedProgrammes: programmes,
    total: filteredFarmers.length,
    trained: totalTrainedFromCapacity,
    totalAnimals,
    trainingRate: filteredFarmers.length > 0 ? (Math.min(totalTrainedFromCapacity, filteredFarmers.length) / filteredFarmers.length) * 100 : 0,
    maleFarmers,
    femaleFarmers,
    totalTrainedFromCapacity,
    genderData,
    animalCensusData,
    weeklyPerformanceData,
    subcountyPerformanceData,
    userProgressData,
  };
};

const createPerformanceReport = async (
  profile: AnalysisProfile,
  requestedProgramme?: string | null,
  dateRange?: {startDate?: string; endDate?: string} | null,
  timeFrame?: "weekly" | "monthly" | "yearly" | string | null,
  selectedYear?: number | string | null,
) => {
  const programmes = resolveProgrammes(profile, requestedProgramme);
  if (programmes.length === 0) return emptyPerformance();

  const [farmers, training, animalHealthActivities, offtakes, staffMarks] = await Promise.all([
    fetchCollectionByProgrammes("farmers", programmes),
    fetchCollectionByProgrammes("capacityBuilding", programmes),
    fetchCollectionByProgrammes("AnimalHealthActivities", programmes),
    fetchCollectionByProgrammes("offtakes", programmes),
    fetchCollectionByProgrammes("hrStaffMarks", programmes),
  ]);

  const filteredFarmers = filterRecordsByDateRange(
    farmers,
    (farmer) => farmer.createdAt || farmer.registrationDate,
    dateRange,
  );
  const filteredTraining = filterRecordsByDateRange(
    training,
    (record) => record.createdAt || record.startDate,
    dateRange,
  );
  const filteredAnimalHealthActivities = filterRecordsByDateRange(
    animalHealthActivities,
    (record) => record.date || record.createdAt,
    dateRange,
  );
  const filteredOfftakes = filterRecordsByDateRange(
    offtakes,
    (record) => record.date || record.Date || record.createdAt,
    dateRange,
  );
  const filteredStaffMarks = filterRecordsByDateRange(
    staffMarks,
    (record) => record.dateAwarded || record.createdAt,
    dateRange,
  );

  let maleFarmers = 0;
  let femaleFarmers = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  let totalGoatsPurchased = 0;
  let totalDosesGivenOut = 0;
  let totalVaccinatedAnimals = 0;
  let vaccinatedFarmersCount = 0;
  let breedsMale = 0;
  let breedsFemale = 0;
  let farmersWithBreedData = 0;
  const countyMap: Record<string, number> = {};
  const subcountyMap: Record<string, number> = {};
  const locationMap: Record<string, number> = {};
  const topCustomersMap: Record<string, {name: string; value: number; county: string}> = {};
  const topFieldOfficersMap: Record<string, number> = {};
  const topStaffAwardedMap: Record<string, number> = {};
  const breedsByCountyMap: Record<string, number> = {};
  const breedsBySubcountyMap: Record<string, number> = {};
  const breedsByLocationMap: Record<string, number> = {};
  const vaccinationByCountyMap: Record<string, number> = {};
  const vaccinationBySubcountyMap: Record<string, number> = {};
  const dosesByLocationMap: Record<string, number> = {};
  const selectedYearNumber = typeof selectedYear === "string" ? Number.parseInt(selectedYear, 10) : (typeof selectedYear === "number" ? selectedYear : null);
  const currentYear = new Date().getFullYear();
  const trendYear = selectedYearNumber && !Number.isNaN(selectedYearNumber) ? selectedYearNumber : null;

  for (const farmer of filteredFarmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    else if (gender === "female") femaleFarmers += 1;

    const goats = getGoatTotal(farmer.goats);
    const sheep = getFieldNumber(farmer, "sheep");
    const cattle = getFieldNumber(farmer, "cattle");
    const totalAnimalsForFarmer = goats + sheep + cattle;
    totalGoats += goats;
    totalSheep += sheep;
    totalCattle += cattle;

    const maleBreedCount = getFieldNumber(farmer, "maleBreeds");
    const femaleBreedCount = getFieldNumber(farmer, "femaleBreeds");
    breedsMale += maleBreedCount;
    breedsFemale += femaleBreedCount;

    const county = String(farmer.county || "Unknown").trim() || "Unknown";
    const subcounty = String(farmer.subcounty || "Unknown").trim() || "Unknown";
    const location = String(farmer.location || "Unknown").trim() || "Unknown";
    countyMap[county] = (countyMap[county] || 0) + 1;
    subcountyMap[subcounty] = (subcountyMap[subcounty] || 0) + 1;
    locationMap[location] = (locationMap[location] || 0) + 1;

    const farmerName = String(farmer.name || farmer.farmerName || farmer.farmerId || farmer.id || "Unknown").trim() || "Unknown";
    const currentTop = topCustomersMap[farmerName] || {name: farmerName, value: 0, county};
    currentTop.value += totalAnimalsForFarmer;
    if (county !== "Unknown") currentTop.county = county;
    topCustomersMap[farmerName] = currentTop;

    const fieldOfficerName =
      typeof farmer.username === "string" ? farmer.username.trim() : "";
    if (fieldOfficerName) {
      topFieldOfficersMap[fieldOfficerName] = (topFieldOfficersMap[fieldOfficerName] || 0) + 1;
    }

    if (farmer.vaccinated === true) {
      totalVaccinatedAnimals += totalAnimalsForFarmer;
      vaccinatedFarmersCount += 1;
      vaccinationByCountyMap[county] = (vaccinationByCountyMap[county] || 0) + totalAnimalsForFarmer;
      vaccinationBySubcountyMap[subcounty] = (vaccinationBySubcountyMap[subcounty] || 0) + totalAnimalsForFarmer;
    }

    if (maleBreedCount + femaleBreedCount > 0) {
      farmersWithBreedData += 1;
      breedsByCountyMap[county] = (breedsByCountyMap[county] || 0) + maleBreedCount + femaleBreedCount;
      breedsBySubcountyMap[subcounty] = (breedsBySubcountyMap[subcounty] || 0) + maleBreedCount + femaleBreedCount;
      breedsByLocationMap[location] = (breedsByLocationMap[location] || 0) + maleBreedCount + femaleBreedCount;
    }
  }

  for (const record of filteredStaffMarks) {
    const staffName = getLeaderName(record.staffName || record.staff || record.name, "");
    const awardedMarks = getFieldNumber(record, "marks", "score", "awardedMarks");
    if (!staffName || awardedMarks <= 0) continue;
    topStaffAwardedMap[staffName] = (topStaffAwardedMap[staffName] || 0) + awardedMarks;
  }

  for (const record of filteredAnimalHealthActivities) {
    const doses = getActivityTotalDoses(record);
    totalDosesGivenOut += doses;
    const location = getActivityLocationName(record);
    if (doses > 0) {
      dosesByLocationMap[location] = (dosesByLocationMap[location] || 0) + doses;
    }
  }

  for (const record of filteredOfftakes) {
    totalGoatsPurchased += getOfftakeGoatsTotal(record);
  }

  const totalAnimals = totalGoats + totalSheep + totalCattle;
  const totalTrainedFarmers = filteredTraining.reduce((sum, record) => sum + parseNumber(record.totalFarmers), 0);
  const countyPerformanceData = Object.entries(countyMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
  const subcountyPerformanceData = Object.entries(subcountyMap)
    .map(([name, value]) => ({name, value}))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const topLocations = Object.entries(locationMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value).slice(0, 5);
  const topCustomers = Object.values(topCustomersMap).sort((a, b) => b.value - a.value).slice(0, 5);
  const topFieldOfficers = Object.entries(topFieldOfficersMap)
    .map(([name, value]) => ({name, value}))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topStaffAwarded = Object.entries(topStaffAwardedMap)
    .map(([name, value]) => ({name, value}))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const registrationTrendData = (() => {
    const trendData: Array<{name: string; registrations: number}> = [];
    const frame = String(timeFrame || "").toLowerCase();
    if (frame === "weekly") {
      for (let offset = 3; offset >= 0; offset -= 1) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - (offset * 7) - weekStart.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          return !!date && date >= weekStart && date <= weekEnd;
        }).length;
        trendData.push({name: `Week ${4 - offset}`, registrations: count});
      }
      return trendData;
    }
    if (frame === "monthly") {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      months.forEach((monthName, index) => {
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          if (!date) return false;
          if (trendYear === null) return date.getMonth() === index;
          const monthStart = new Date(trendYear, index, 1);
          const monthEnd = new Date(trendYear, index + 1, 0);
          return date >= monthStart && date <= monthEnd;
        }).length;
        trendData.push({name: monthName, registrations: count});
      });
      return trendData;
    }
    const baseYear = trendYear ?? currentYear;
    for (let year = baseYear - 4; year <= baseYear; year += 1) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31);
      const count = filteredFarmers.filter((farmer) => {
        const date = parseDate(farmer.createdAt || farmer.registrationDate);
        return !!date && date >= yearStart && date <= yearEnd;
      }).length;
      trendData.push({name: String(year), registrations: count});
    }
    return trendData;
  })();
  const uniqueCounties = new Set(filteredFarmers.map((farmer) => String(farmer.county || "").trim()).filter(Boolean)).size;
  const totalBreedsDistributed = breedsMale + breedsFemale;
  const breedsByCountyData = Object.entries(breedsByCountyMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
  const breedsBySubcountyData = Object.entries(breedsBySubcountyMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value).slice(0, 10);
  const breedsByLocationData = Object.entries(breedsByLocationMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value).slice(0, 10);
  const vaccinationByCountyData = Object.entries(vaccinationByCountyMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
  const vaccinationBySubcountyData = Object.entries(vaccinationBySubcountyMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value).slice(0, 10);
  const dosesByLocationData = Object.entries(dosesByLocationMap).map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value).slice(0, 10);

  return {
    scope: "performance-report",
    resolvedProgrammes: programmes,
    totalFarmers: filteredFarmers.length,
    maleFarmers,
    femaleFarmers,
    malePercentage: filteredFarmers.length > 0 ? ((maleFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    femalePercentage: filteredFarmers.length > 0 ? ((femaleFarmers / filteredFarmers.length) * 100).toFixed(1) : "0.0",
    totalAnimals,
    totalGoats,
    totalSheep,
    goatsPercentage: totalAnimals > 0 ? ((totalGoats / totalAnimals) * 100).toFixed(1) : "0.0",
    sheepPercentage: totalAnimals > 0 ? ((totalSheep / totalAnimals) * 100).toFixed(1) : "0.0",
    totalTrainedFarmers,
    countyPerformanceData,
    subcountyPerformanceData,
    registrationTrendData,
    topLocations,
    topCustomers,
    totalGoatsPurchased,
    topFieldOfficers,
    topStaffAwarded,
    totalDosesGivenOut,
    uniqueCounties,
    totalBreedsDistributed,
    breedsMale,
    breedsFemale,
    breedsMalePercentage: totalBreedsDistributed > 0 ? ((breedsMale / totalBreedsDistributed) * 100).toFixed(1) : "0.0",
    breedsFemalePercentage: totalBreedsDistributed > 0 ? ((breedsFemale / totalBreedsDistributed) * 100).toFixed(1) : "0.0",
    farmersWithBreedData,
    vaccinationRate: totalAnimals > 0 ? ((totalVaccinatedAnimals / totalAnimals) * 100).toFixed(1) : "0.0",
    vaccinatedAnimals: totalVaccinatedAnimals,
    vaccinatedFarmersCount,
    breedsByCountyData,
    breedsBySubcountyData,
    breedsByLocationData,
    vaccinationByCountyData,
    vaccinationBySubcountyData,
    dosesByLocationData,
  };
};

const createSalesReport = async (
  profile: AnalysisProfile,
  requestedProgramme?: string | null,
  dateRange?: {startDate?: string; endDate?: string} | null,
  salesInputs?: {pricePerKg?: number | string | null; expenses?: number | string | null} | null,
) => {
  const programmes = resolveProgrammes(profile, requestedProgramme);
  if (programmes.length === 0) return emptySales();

  const [offtakes, orders, requisitions] = await Promise.all([
    fetchCollectionByProgrammes("offtakes", programmes),
    fetchCollectionByProgrammes("orders", programmes),
    fetchCollectionByProgrammes("requisitions", programmes),
  ]);
  const filteredData = filterRecordsByDateRange(
    offtakes,
    (record) => record.date || record.Date || record.createdAt,
    dateRange,
  );
  const filteredOrders = filterRecordsByDateRange(
    orders,
    (record) => getOrderRecordDate(record),
    dateRange,
  );
  const filteredRequisitions = filterRecordsByDateRange(
    requisitions,
    (record) => getRequisitionRecordDate(record),
    dateRange,
  );

  let totalPurchaseCost = 0;
  let totalRevenue = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  let totalLiveWeight = 0;
  let totalCarcassWeight = 0;
  let totalAnimalsCount = 0;
  let totalGoatOrdersPlaced = 0;
  let requisitionExpenses = 0;
  let totalRequisitions = 0;
  const genderCounts: Record<string, number> = {Male: 0, Female: 0};
  const countySales: Record<string, number> = {};
  const locationSales: Record<string, number> = {};
  const farmerSales: Record<string, {name: string; revenue: number; animals: number; county: string}> = {};
  const monthlyData: Record<string, {monthName: string; revenue: number; volume: number}> = {};
  const requisitionMonthlyData: Record<string, {monthName: string; count: number; amount: number}> = {};
  const pricePerKg = parseNumber(salesInputs?.pricePerKg);
  const expenses = parseNumber(salesInputs?.expenses);

  for (const record of filteredData) {
    const txCost = parseNumber(record.totalPrice ?? record.totalprice);
    totalPurchaseCost += txCost;

    const goatsArr = Array.isArray(record.goats) ? record.goats : (Array.isArray(record.Goats) ? record.Goats : []);
    const sheepArr = Array.isArray(record.sheep) ? record.sheep : (Array.isArray(record.Sheep) ? record.Sheep : []);
    const cattleArr = Array.isArray(record.cattle) ? record.cattle : (Array.isArray(record.Cattle) ? record.Cattle : []);
    const txGoats = parseNumber(record.totalGoats) || goatsArr.length;
    const txSheep = sheepArr.length;
    const txCattle = cattleArr.length;

    totalGoats += txGoats;
    totalSheep += txSheep;
    totalCattle += txCattle;
    totalAnimalsCount += txGoats + txSheep + txCattle;

    const allAnimals = [...goatsArr, ...sheepArr, ...cattleArr];
    let txCarcassWeight = 0;
    for (const animal of allAnimals) {
      const liveWeight = parseNumber(animal.live);
      const carcassWeight = parseNumber(animal.carcass);
      totalLiveWeight += liveWeight;
      totalCarcassWeight += carcassWeight;
      txCarcassWeight += carcassWeight;
    }
    totalRevenue += txCarcassWeight * pricePerKg;

    if (record.gender) {
      const gender = record.gender.charAt(0).toUpperCase() + record.gender.slice(1).toLowerCase();
      if (genderCounts[gender] !== undefined) genderCounts[gender] += 1;
    }

    const county = String(record.county || record.region || record.County || "Unknown").trim() || "Unknown";
    countySales[county] = (countySales[county] || 0) + txGoats;

    const location = String(record.location || record.Location || "Unknown").trim() || "Unknown";
    locationSales[location] = (locationSales[location] || 0) + (txGoats + txSheep + txCattle);

    const farmerName = String(record.farmerName || record.name || record.username || "Unknown").trim() || "Unknown";
    if (!farmerSales[farmerName]) {
      farmerSales[farmerName] = {name: farmerName, revenue: 0, animals: 0, county};
    } else if (county !== "Unknown") {
      farmerSales[farmerName].county = county;
    }
    farmerSales[farmerName].revenue += txCarcassWeight * pricePerKg;
    farmerSales[farmerName].animals += txGoats + txSheep + txCattle;

    const date = parseDate(record.date || record.Date || record.createdAt);
    if (date) {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const monthName = date.toLocaleString("default", {month: "short"});
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {monthName, revenue: 0, volume: 0};
      }
      monthlyData[monthKey].revenue += txCarcassWeight * pricePerKg;
      monthlyData[monthKey].volume += txGoats + txSheep + txCattle;
    }
  }

  for (const record of filteredOrders) {
    if (!isBatchOrderRecord(record)) continue;
    totalGoatOrdersPlaced += getOrderTotalGoats(record);
  }

  for (const record of filteredRequisitions) {
    const requestedAmount = getRequisitionRequestedAmount(record);
    requisitionExpenses += requestedAmount;
    totalRequisitions += 1;

    const date = parseDate(getRequisitionRecordDate(record));
    if (!date) continue;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthName = date.toLocaleString("default", {month: "short"});
    if (!requisitionMonthlyData[monthKey]) {
      requisitionMonthlyData[monthKey] = {monthName, count: 0, amount: 0};
    }
    requisitionMonthlyData[monthKey].count += 1;
    requisitionMonthlyData[monthKey].amount += requestedAmount;
  }

  const costPerGoat = totalGoats > 0 ? totalPurchaseCost / totalGoats : 0;
  const avgLiveWeight = totalAnimalsCount > 0 ? totalLiveWeight / totalAnimalsCount : 0;
  const avgCarcassWeight = totalAnimalsCount > 0 ? totalCarcassWeight / totalAnimalsCount : 0;
  const netProfit = totalRevenue - totalPurchaseCost - expenses;
  const avgCostPerKgCarcass = totalCarcassWeight > 0 ? totalPurchaseCost / totalCarcassWeight : 0;
  const genderData = [
    {name: "Male", value: genderCounts.Male},
    {name: "Female", value: genderCounts.Female},
  ].filter((item) => item.value > 0);
  const countyData = Object.entries(countySales)
    .map(([name, count]) => ({name, count}))
    .sort((a, b) => b.count - a.count);
  const topLocations = Object.entries(locationSales)
    .map(([name, count]) => ({name, count}))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topFarmers = Object.values(farmerSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  const monthlyTrend = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month) => {
    const match = Object.values(monthlyData).find((entry) => entry.monthName === month);
    return {month, revenue: match ? match.revenue : 0, volume: match ? match.volume : 0};
  });
  const requisitionTrend = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month) => {
    const match = Object.values(requisitionMonthlyData).find((entry) => entry.monthName === month);
    return {month, count: match ? match.count : 0, amount: match ? match.amount : 0};
  });
  const top3Months = Object.values(monthlyData)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
    .map((entry) => ({
      month: entry.monthName,
      revenue: entry.revenue,
      volume: entry.volume,
    }));

  return {
    scope: "sales-report",
    resolvedProgrammes: programmes,
    filteredCount: filteredData.length,
    stats: {
      totalPurchaseCost,
      totalRevenue,
      costPerGoat,
      totalAnimals: totalAnimalsCount,
      totalGoats,
      totalSheep,
      totalCattle,
      totalLiveWeight,
      avgLiveWeight,
      totalCarcassWeight,
      avgCarcassWeight,
      pricePerKg,
      expenses,
      netProfit,
      avgCostPerKgCarcass,
      totalGoatOrdersPlaced,
      requisitionExpenses,
      totalRequisitions,
    },
    genderData,
    countyData,
    topLocations,
    topFarmers,
    monthlyTrend,
    requisitionTrend,
    top3Months,
  };
};

export const getAnalysisSummary = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to view analytics.");
  }

  const payload = (request.data || {}) as AnalysisRequest;
  const scope = payload.scope;
  if (!scope || !VALID_SCOPES.has(scope as AnalysisScope)) {
    throw new HttpsError("invalid-argument", "A valid analysis scope is required.");
  }

  const profile = await loadProfile(uid);
  if (!profile) {
    return {scope, resolvedProgrammes: []};
  }

  const key = cacheKey(uid, payload);
  const cached = getCached(key);
  if (cached) return cached;

  let response: any;
  switch (scope) {
  case "overview":
    response = await createOverview(profile, payload.programme);
    break;
  case "livestock-analytics":
    response = await createLivestockAnalytics(profile, payload.programme, payload.dateRange, payload.target);
    break;
  case "performance-report":
    response = await createPerformanceReport(
      profile,
      payload.programme,
      payload.dateRange,
      payload.timeFrame,
      payload.selectedYear,
    );
    break;
  case "sales-report":
    response = await createSalesReport(profile, payload.programme, payload.dateRange, payload.salesInputs);
    break;
  default:
    throw new HttpsError("invalid-argument", "Unsupported analysis scope.");
  }

  setCached(key, response);
  return response;
});
