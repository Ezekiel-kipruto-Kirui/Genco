import { useEffect, useMemo, useState, type ReactNode } from "react";
import { get, ref } from "firebase/database";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Clock3,
  Eye,
  Leaf,
  Loader2,
  MapPin,
  Plus,
  ShoppingCart,
  UsersRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { canViewAllProgrammes } from "@/contexts/authhelper";
import { fetchAnalysisSummary } from "@/lib/analysis";
import { db } from "@/lib/firebase";
import { normalizeProgramme, resolveAccessibleProgrammes, resolveActiveProgramme } from "@/lib/programme-access";

type OverviewRecord = Record<string, any>;

type ComparisonYears = {
  year1: number;
  year2: number;
};

type DonutSegment = {
  name: string;
  value: number;
  color: string;
};

type TrendPoint = {
  name: string;
  year1: number;
  year2: number;
};

type CountyCoverage = {
  name: string;
  value: number;
  color: string;
};

type RecentLocation = {
  name: string;
  county: string;
  visitedAt: string;
};

type RecentActivity = {
  id: string;
  activityName: string;
  date: string;
  status: string;
  location: string;
  participants: number;
};

interface OverviewSummaryData {
  stats: {
    totalFarmers: number;
    maleFarmers: number;
    femaleFarmers: number;
    trainedFarmers: number;
    totalAnimals: number;
    totalGoats: number;
    totalSheep: number;
    totalCattle: number;
    totalGoatsPurchased: number;
    countiesCovered: number;
  };
  comparisonYears: ComparisonYears;
  maintainedInfrastructure: DonutSegment[];
  registrationComparison: DonutSegment[];
  animalCensusVsPurchased: DonutSegment[];
  vaccinationTrend: TrendPoint[];
  countyCoverage: CountyCoverage[];
  recentLocations: RecentLocation[];
  recentActivities: RecentActivity[];
  pendingActivitiesCount: number;
}

type OverviewCollections = {
  farmers: OverviewRecord[];
  capacity: OverviewRecord[];
  offtakes: OverviewRecord[];
  animalHealth: OverviewRecord[];
  boreholes: OverviewRecord[];
  activities: OverviewRecord[];
};

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const USE_REMOTE_ANALYTICS =
  typeof window !== "undefined" && !LOCALHOSTS.has(window.location.hostname);

const YEAR_ONE_COLOR = "#2710a1";
const YEAR_TWO_COLOR = "#f89b0d";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNTY_BAR_COLORS = [YEAR_ONE_COLOR, YEAR_TWO_COLOR, "#ffea00", "#2cb100"];
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const activityDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const getComparisonYears = (referenceDate: Date = new Date()): ComparisonYears => ({
  year1: referenceDate.getFullYear(),
  year2: referenceDate.getFullYear() - 1,
});
const EMPTY_DONUT_SEGMENTS: DonutSegment[] = [
  { name: "Year 1", value: 0, color: YEAR_ONE_COLOR },
  { name: "Year 2", value: 0, color: YEAR_TWO_COLOR },
];
const EMPTY_COUNTY_COVERAGE: CountyCoverage[] = COUNTY_BAR_COLORS.map((color, index) => ({
  name: `County ${index + 1}`,
  value: 0,
  color,
}));
const EMPTY_OVERVIEW_DATA: OverviewSummaryData = {
  stats: {
    totalFarmers: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    trainedFarmers: 0,
    totalAnimals: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    totalGoatsPurchased: 0,
    countiesCovered: 0,
  },
  comparisonYears: getComparisonYears(),
  maintainedInfrastructure: EMPTY_DONUT_SEGMENTS,
  registrationComparison: EMPTY_DONUT_SEGMENTS,
  animalCensusVsPurchased: [
    { name: "Goats on record", value: 0, color: "#ffc107" },
    { name: "Goats purchased", value: 0, color: "#a80d10" },
  ],
  vaccinationTrend: MONTH_LABELS.map((name) => ({ name, year1: 0, year2: 0 })),
  countyCoverage: EMPTY_COUNTY_COVERAGE,
  recentLocations: [],
  recentActivities: [],
  pendingActivitiesCount: 0,
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;

  try {
    if (value instanceof Date) return value;
    if (typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === "object" && value !== null) {
      const record = value as { seconds?: number; toDate?: () => Date; _seconds?: number };
      if (typeof record.toDate === "function") {
        const parsed = record.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (typeof record.seconds === "number") {
        const parsed = new Date(record.seconds * 1000);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (typeof record._seconds === "number") {
        const parsed = new Date(record._seconds * 1000);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    }
  } catch (error) {
    console.error("Failed to parse date:", error, value);
  }

  return null;
};

const getNumberField = (record: Record<string, unknown>, ...fields: string[]): number => {
  for (const field of fields) {
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
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

const getArrayLikeSize = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
};

const getGoatTotal = (goats: unknown): number => {
  if (typeof goats === "number" || typeof goats === "string") {
    return getNumberField({ goats }, "goats");
  }

  if (goats && typeof goats === "object") {
    const record = goats as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "total")) {
      return getNumberField(record, "total");
    }
    return getNumberField(record, "male") + getNumberField(record, "female");
  }

  return 0;
};

const getOfftakeGoatsTotal = (record: Record<string, unknown>): number =>
  Math.max(
    getNumberField(record, "totalGoats"),
    getNumberField(record, "goatsBought"),
    getNumberField(record, "goats"),
    getArrayLikeSize(record.goats),
    getArrayLikeSize(record.Goats),
    0,
  );

const getActivityTotalDoses = (record: Record<string, unknown>): number => {
  if (Array.isArray(record.vaccines)) {
    return record.vaccines.reduce((sum, vaccine) => {
      if (!vaccine || typeof vaccine !== "object") return sum;
      return sum + getNumberField(vaccine as Record<string, unknown>, "doses");
    }, 0);
  }

  return getNumberField(record, "number_doses");
};

const getInfrastructureStatuses = (record: Record<string, unknown>) => ({
  drilled: parseBoolean(record.drilled ?? record.Drilled),
  equipped: parseBoolean(record.equipped ?? record.Equipped),
  rehabilitated: parseBoolean(record.rehabilitated ?? record.Rehabilitated),
  maintained: parseBoolean(record.maintained ?? record.Maintained),
});

const getInfrastructureRecordDate = (record: Record<string, unknown>) =>
  parseDate(record.date ?? record.Date ?? record.created_at ?? record.createdAt);

const getOverviewRecordProgramme = (record: OverviewRecord) =>
  normalizeProgramme(record.programme ?? record.Programme);

const buildVaccinationTrend = (
  animalHealthRecords: OverviewRecord[],
  comparisonYears: ComparisonYears,
): TrendPoint[] => {
  const trend = MONTH_LABELS.map((name) => ({ name, year1: 0, year2: 0 }));

  for (const record of animalHealthRecords) {
    const totalDoses = getActivityTotalDoses(record);
    const date = parseDate(record.date || record.createdAt);
    if (!date || totalDoses <= 0) continue;

    const monthIndex = date.getMonth();
    if (date.getFullYear() === comparisonYears.year1) trend[monthIndex].year1 += totalDoses;
    if (date.getFullYear() === comparisonYears.year2) trend[monthIndex].year2 += totalDoses;
  }

  return trend;
};

const buildInfrastructureComparison = (
  records: OverviewRecord[],
  comparisonYears: ComparisonYears,
): DonutSegment[] => {
  let year1Value = 0;
  let year2Value = 0;

  for (const record of records) {
    const statuses = getInfrastructureStatuses(record);
    if (!statuses.rehabilitated) continue;
    const date = getInfrastructureRecordDate(record);
    if (!date) continue;

    if (date.getFullYear() === comparisonYears.year1) year1Value += 1;
    if (date.getFullYear() === comparisonYears.year2) year2Value += 1;
  }

  return [
    { name: "Year 1", value: year1Value, color: YEAR_ONE_COLOR },
    { name: "Year 2", value: year2Value, color: YEAR_TWO_COLOR },
  ];
};

const buildRegistrationComparison = (
  farmers: OverviewRecord[],
  comparisonYears: ComparisonYears,
): DonutSegment[] => {
  let year1Value = 0;
  let year2Value = 0;

  for (const farmer of farmers) {
    const date = parseDate(farmer.createdAt || farmer.registrationDate);
    if (!date) continue;

    if (date.getFullYear() === comparisonYears.year1) year1Value += 1;
    if (date.getFullYear() === comparisonYears.year2) year2Value += 1;
  }

  return [
    { name: "Year 1", value: year1Value, color: YEAR_ONE_COLOR },
    { name: "Year 2", value: year2Value, color: YEAR_TWO_COLOR },
  ];
};

const buildRecentLocations = (activities: OverviewRecord[]): RecentLocation[] => {
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
    .filter((entry) => entry.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp)
    .filter((entry) => {
      const key = `${entry.name}|${entry.county}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map(({ timestamp, ...entry }) => entry);
};

const buildRecentActivities = (activities: OverviewRecord[]): RecentActivity[] =>
  [...activities]
    .map((record) => ({
      id: String(record.id || record.activityId || record.activityName || Math.random()),
      activityName: String(record.activityName || record.title || "Untitled activity").trim() || "Untitled activity",
      date: String(record.date || record.createdAt || ""),
      status: String(record.status || "pending").trim() || "pending",
      location: String(record.location || record.activityName || record.county || "Unknown location").trim() || "Unknown location",
      participants: Math.max(
        getNumberField(record, "numberOfPersons", "participantsCount"),
        getArrayLikeSize(record.participants),
        0,
      ),
    }))
    .filter((record) => parseDate(record.date))
    .sort((left, right) => (parseDate(right.date)?.getTime() || 0) - (parseDate(left.date)?.getTime() || 0))
    .slice(0, 3);

const buildOverviewSummaryFromRecords = ({
  farmers,
  capacity,
  offtakes,
  animalHealth,
  boreholes,
  activities,
}: OverviewCollections): OverviewSummaryData => {
  const comparisonYears = getComparisonYears();
  let maleFarmers = 0;
  let femaleFarmers = 0;
  let totalGoats = 0;
  let totalSheep = 0;
  let totalCattle = 0;
  const countyMap: Record<string, number> = {};

  for (const farmer of farmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    if (gender === "female") femaleFarmers += 1;

    totalGoats += getGoatTotal(farmer.goats);
    totalSheep += getNumberField(farmer, "sheep");
    totalCattle += getNumberField(farmer, "cattle");

    const county = String(farmer.county || farmer.region || "").trim();
    if (county) countyMap[county] = (countyMap[county] || 0) + 1;
  }

  const totalAnimals = totalGoats + totalSheep + totalCattle;
  const trainedFarmers = capacity.reduce(
    (sum, record) => sum + getNumberField(record, "totalFarmers", "trainedFarmers"),
    0,
  );
  const totalGoatsPurchased = offtakes.reduce(
    (sum, record) => sum + getOfftakeGoatsTotal(record),
    0,
  );
  const countyCoverage = Object.entries(countyMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([name, value], index) => ({
      name,
      value,
      color: COUNTY_BAR_COLORS[index % COUNTY_BAR_COLORS.length],
    }));

  return {
    stats: {
      totalFarmers: farmers.length,
      maleFarmers,
      femaleFarmers,
      trainedFarmers,
      totalAnimals,
      totalGoats,
      totalSheep,
      totalCattle,
      totalGoatsPurchased,
      countiesCovered: Object.keys(countyMap).length,
    },
    comparisonYears,
    maintainedInfrastructure: buildInfrastructureComparison(boreholes, comparisonYears),
    registrationComparison: buildRegistrationComparison(farmers, comparisonYears),
    animalCensusVsPurchased: [
      { name: "Goats on record", value: totalGoats, color: "#ffc107" },
      { name: "Goats purchased", value: totalGoatsPurchased, color: "#a80d10" },
    ],
    vaccinationTrend: buildVaccinationTrend(animalHealth, comparisonYears),
    countyCoverage: countyCoverage.length > 0 ? countyCoverage : EMPTY_COUNTY_COVERAGE,
    recentLocations: buildRecentLocations(activities),
    recentActivities: buildRecentActivities(activities),
    pendingActivitiesCount: activities.filter(
      (record) => String(record.status || "").trim().toLowerCase() === "pending",
    ).length,
  };
};

const toPercentage = (value: number, total: number): number => {
  if (total <= 0) return 0;
  return Number(((value / total) * 100).toFixed(1));
};

const formatWholeNumber = (value: number) => value.toLocaleString();
const formatProgressLabel = (value: number, description: string) => `${value.toFixed(1)}% ${description}`;
const formatActivityDate = (value: string): string => {
  const date = parseDate(value);
  if (!date) return "Unknown date";
  return activityDateFormatter.format(date);
};
const formatActivityStatus = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Pending";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};
const formatRelativeTime = (value: string): string => {
  const date = parseDate(value);
  if (!date) return "Unknown";

  const diffMs = date.getTime() - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(diffMs) >= size || unit === "minute") {
      return relativeTimeFormatter.format(Math.round(diffMs / size), unit);
    }
  }

  return "just now";
};

const TopMetricCard = ({
  title,
  value,
  icon,
  accentColor,
  progressValue,
  progressLabel,
  detail,
}: {
  title: string;
  value: number;
  icon: ReactNode;
  accentColor: string;
  progressValue: number;
  progressLabel: string;
  detail?: ReactNode;
}) => (
  <div className="rounded-[20px] border border-slate-200 bg-white px-6 py-5 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-[16px] font-medium tracking-[-0.02em] text-slate-400">{title}</p>
        <p className="text-[26px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[42px]">
          {formatWholeNumber(value)}
        </p>
      </div>
      <div className="mt-1">{icon}</div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-400">
      <span className="font-semibold text-slate-500">{progressLabel}</span>
      {detail}
    </div>

    <div className="mt-4 h-[8px] rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(progressValue, 100)}%`, backgroundColor: accentColor }}
      />
    </div>
  </div>
);

const OverviewPanel = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={`rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.04)] sm:p-6 ${className}`}>
    <h2 className="text-[13px] font-medium uppercase tracking-[-0.01em] text-slate-400">{title}</h2>
    {children}
  </div>
);

const ChartLegend = ({ items }: { items: DonutSegment[] }) => (
  <div className="mt-3 flex flex-wrap items-center justify-center gap-5 text-sm text-slate-500">
    {items.map((item) => (
      <div key={item.name} className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
        <span>{item.name}</span>
        <span className="font-semibold text-slate-700">{formatWholeNumber(item.value)}</span>
      </div>
    ))}
  </div>
);

const DonutPanel = ({
  title,
  data,
  comparisonNote,
}: {
  title: string;
  data: DonutSegment[];
  comparisonNote?: string;
}) => {
  const hasValues = data.some((item) => item.value > 0);
  const chartData = hasValues ? data : [{ name: "No data", value: 1, color: "#e2e8f0" }];

  return (
    <OverviewPanel title={title} className="flex h-full min-h-[360px] flex-col">
      <div className="mt-4 flex-1">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={72}
              outerRadius={104}
              paddingAngle={0}
              stroke="none"
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      {hasValues ? (
        <>
          <ChartLegend items={data} />
          {comparisonNote ? <p className="mt-2 text-center text-xs text-slate-400">{comparisonNote}</p> : null}
        </>
      ) : (
        <p className="mt-3 text-center text-sm text-slate-400">No data available yet</p>
      )}
    </OverviewPanel>
  );
};

const RecentLocationsPanel = ({ locations }: { locations: RecentLocation[] }) => (
  <div className="flex h-full min-h-[360px] flex-col rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_10px_35px_rgba(15,23,42,0.04)]">
    <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-900">Recently Visited Locations</h2>

    {locations.length > 0 ? (
      <div className="mt-7 space-y-6">
        {locations.map((location) => (
          <div key={`${location.name}-${location.visitedAt}`} className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50">
                <MapPin className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-[16px] font-medium text-slate-800">{location.name}</p>
                <p className="text-sm text-slate-400">{location.county}</p>
              </div>
            </div>

            <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
              <Clock3 className="h-4 w-4" />
              <span>{formatRelativeTime(location.visitedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        No recent locations available yet.
      </div>
    )}
  </div>
);

const RecentActivitiesPanel = ({ activities }: { activities: RecentActivity[] }) => (
  <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-6 py-6 sm:px-8">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-[#4f7cff] to-[#9333ea] text-white shadow-[0_12px_24px_rgba(99,102,241,0.28)]">
          <Activity className="h-5 w-5" />
        </div>
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">Recent Activities</h2>
      </div>

      <Link
        to="/dashboard/activities"
        className="inline-flex items-center gap-2 text-base font-medium text-slate-600 transition-colors hover:text-slate-900"
      >
        <span>View All</span>
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>

    <div className="px-6 py-7 sm:px-8">
      {activities.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="min-w-[860px] overflow-hidden rounded-[24px] border border-slate-100 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.09)]">
            <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(110px,0.9fr)_minmax(110px,0.8fr)_minmax(120px,1fr)_minmax(90px,0.7fr)] gap-4 bg-slate-50 px-5 py-5 text-sm font-semibold text-slate-600">
              <span>Activity Name</span>
              <span>Date</span>
              <span>Status</span>
              <span>Location</span>
              <span>Participants</span>
            </div>

            {activities.map((activity, index) => {
              const normalizedStatus = activity.status.trim().toLowerCase();
              const statusClasses = normalizedStatus === "completed"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700";

              return (
                <div
                  key={`${activity.id}-${activity.date}-${index}`}
                  className="grid grid-cols-[minmax(0,1.8fr)_minmax(110px,0.9fr)_minmax(110px,0.8fr)_minmax(120px,1fr)_minmax(90px,0.7fr)] gap-4 border-t border-slate-100 px-5 py-5 text-sm text-slate-700"
                >
                  <div className="flex items-center gap-4">
                    <span className="h-3 w-3 rounded-full bg-gradient-to-r from-[#4f7cff] to-[#9333ea]" />
                    <span className="truncate text-[16px] font-medium text-slate-800">{activity.activityName}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
                      {formatActivityDate(activity.date)}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusClasses}`}>
                      {formatActivityStatus(activity.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[16px] text-slate-600">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    <span className="truncate">{activity.location}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[16px] font-semibold text-slate-800">
                    <UsersRound className="h-4 w-4 text-slate-500" />
                    <span>{formatWholeNumber(activity.participants)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
          No recent activities available yet.
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4 border-t border-slate-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
        <Button
          asChild
          variant="outline"
          className="h-12 rounded-2xl border-slate-300 bg-white px-6 text-base font-medium text-slate-700 hover:bg-slate-50"
        >
          <Link to="/dashboard/activities">
            <Eye className="h-4 w-4" />
            View All Activities
          </Link>
        </Button>

        <Button
          asChild
          className="h-12 rounded-2xl bg-gradient-to-r from-[#4f7cff] to-[#9333ea] px-6 text-base font-semibold text-white shadow-[0_16px_32px_rgba(99,102,241,0.28)] hover:from-[#4370ec] hover:to-[#8429d6]"
        >
          <Link to="/dashboard/activities">
            <Plus className="h-4 w-4" />
            Schedule Activity
          </Link>
        </Button>
      </div>
    </div>
  </div>
);

const CountiesCoveredPanel = ({ data }: { data: CountyCoverage[] }) => {
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <OverviewPanel title="COUNTIES COVERED" className="h-full min-h-[360px]">
      <div className="mt-10 space-y-5">
        {data.map((item, index) => (
          <div key={`${item.name}-${index}`} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.12em] text-slate-300">
              <span className="truncate">{item.name}</span>
              <span>{formatWholeNumber(item.value)}</span>
            </div>
            <div className="h-4 rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </OverviewPanel>
  );
};

const OverviewLoading = () => (
  <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-[20px] border border-slate-200 bg-white p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-10 w-24" />
          <Skeleton className="mt-6 h-4 w-52" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
        </div>
      ))}
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Skeleton className="h-[360px] rounded-[24px]" />
      <Skeleton className="h-[360px] rounded-[24px]" />
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Skeleton className="h-[360px] rounded-[24px]" />
      <Skeleton className="h-[360px] rounded-[24px]" />
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <Skeleton className="h-[360px] rounded-[24px]" />
      <Skeleton className="h-[360px] rounded-[24px]" />
    </div>
  </div>
);

const DashboardOverview = () => {
  const { user, userRole, userAttribute, allowedProgrammes, loading } = useAuth();
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userAttribute, userRole],
  );

  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData],
  );
  const canSwitchProgrammes = userCanViewAllProgrammeData || accessibleProgrammes.length > 1;
  const programmeOptions = useMemo(
    () => (userCanViewAllProgrammeData ? ["All", ...accessibleProgrammes] : accessibleProgrammes),
    [accessibleProgrammes, userCanViewAllProgrammeData],
  );
  const [selectedProgramme, setSelectedProgramme] = useState("");
  const [localOverviewData, setLocalOverviewData] = useState<OverviewSummaryData | null>(null);
  const [localOverviewLoading, setLocalOverviewLoading] = useState(false);

  useEffect(() => {
    if (!userRole && !userAttribute) {
      setSelectedProgramme("");
      return;
    }

    if (userCanViewAllProgrammeData) {
      setSelectedProgramme((current) => {
        if (current === "All") return current;
        if (accessibleProgrammes.includes(current as (typeof accessibleProgrammes)[number])) return current;
        return "All";
      });
      return;
    }

    setSelectedProgramme((current) => resolveActiveProgramme(current, accessibleProgrammes));
  }, [accessibleProgrammes, userAttribute, userCanViewAllProgrammeData, userRole]);

  const remoteOverviewEnabled = USE_REMOTE_ANALYTICS && Boolean(selectedProgramme) && !loading;

  const overviewQuery = useQuery({
    queryKey: ["overview-analysis", user?.uid, userRole, userAttribute, selectedProgramme],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "overview",
        programme: selectedProgramme === "All" ? "All" : selectedProgramme || null,
      }),
    enabled: remoteOverviewEnabled,
    retry: 0,
    staleTime: 2 * 60 * 1000,
  });

  const shouldFetchLocalOverview = Boolean(selectedProgramme) && (!remoteOverviewEnabled || overviewQuery.isError);

  useEffect(() => {
    if (!selectedProgramme) {
      setLocalOverviewData(EMPTY_OVERVIEW_DATA);
      setLocalOverviewLoading(false);
      return;
    }

    if (!shouldFetchLocalOverview) {
      setLocalOverviewLoading(false);
      return;
    }

    let cancelled = false;

    const fetchLocalOverview = async () => {
      setLocalOverviewLoading(true);

      try {
        const [farmersSnap, capacitySnap, offtakesSnap, animalHealthSnap, boreholesSnap, activitiesSnap] = await Promise.all([
          get(ref(db, "farmers")),
          get(ref(db, "capacityBuilding")),
          get(ref(db, "offtakes")),
          get(ref(db, "AnimalHealthActivities")),
          get(ref(db, "BoreholeStorage")),
          get(ref(db, "Recent Activities")),
        ]);

        if (cancelled) return;

        const snapshotToArray = (snapshot: Awaited<ReturnType<typeof get>>): OverviewRecord[] =>
          snapshot.exists()
            ? Object.entries(snapshot.val() as Record<string, OverviewRecord>).map(([id, record]) => ({
                id,
                ...record,
              }))
            : [];

        const requestedProgramme = normalizeProgramme(selectedProgramme);
        const includeAllProgrammes = selectedProgramme === "All" || !requestedProgramme;
        const byProgramme = (records: OverviewRecord[]) =>
          records.filter((record) => includeAllProgrammes || getOverviewRecordProgramme(record) === requestedProgramme);

        const summary = buildOverviewSummaryFromRecords({
          farmers: byProgramme(snapshotToArray(farmersSnap)),
          capacity: byProgramme(snapshotToArray(capacitySnap)),
          offtakes: byProgramme(snapshotToArray(offtakesSnap)),
          animalHealth: byProgramme(snapshotToArray(animalHealthSnap)),
          boreholes: byProgramme(snapshotToArray(boreholesSnap)),
          activities: byProgramme(snapshotToArray(activitiesSnap)),
        });

        if (!cancelled) {
          setLocalOverviewData(summary);
        }
      } catch (error) {
        console.error("Failed to build local overview:", error);
        if (!cancelled) {
          setLocalOverviewData(EMPTY_OVERVIEW_DATA);
        }
      } finally {
        if (!cancelled) {
          setLocalOverviewLoading(false);
        }
      }
    };

    void fetchLocalOverview();

    return () => {
      cancelled = true;
    };
  }, [selectedProgramme, shouldFetchLocalOverview]);

  const overviewData =
    (overviewQuery.data as OverviewSummaryData | undefined) ?? localOverviewData ?? EMPTY_OVERVIEW_DATA;

  const stats = overviewData.stats ?? EMPTY_OVERVIEW_DATA.stats;
  const comparisonYears = overviewData.comparisonYears ?? getComparisonYears();
  const currentYearRegistrations = overviewData.registrationComparison?.[0]?.value ?? 0;
  const registrationPercentage = toPercentage(currentYearRegistrations, stats.totalFarmers);
  const trainingPercentage = toPercentage(stats.trainedFarmers, stats.totalFarmers);
  const censusPercentage = toPercentage(stats.totalGoatsPurchased, stats.totalGoats);
  const isLoadingRemoteOverview =
    remoteOverviewEnabled &&
    !overviewQuery.isError &&
    (overviewQuery.isLoading || overviewQuery.isFetching);
  const isLoadingData = isLoadingRemoteOverview || localOverviewLoading;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!userCanViewAllProgrammeData && accessibleProgrammes.length === 0) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center shadow-[0_10px_35px_rgba(15,23,42,0.04)]">
        <h1 className="text-lg font-semibold text-slate-900">No programme access</h1>
        <p className="mt-2 text-sm text-slate-500">This account is not assigned to any programme data.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f7] px-3 py-4 sm:px-5 sm:py-5">
      <div className="mx-auto max-w-[1120px] space-y-6">
        <div className="flex items-center justify-end">
          {canSwitchProgrammes ? (
            <div className="w-full max-w-[170px] space-y-2">
              <Label htmlFor="overview-programme" className="text-xs uppercase tracking-[0.16em] text-slate-400">
                Programme
              </Label>
              <Select value={selectedProgramme} onValueChange={setSelectedProgramme}>
                <SelectTrigger id="overview-programme" className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="Select programme" />
                </SelectTrigger>
                <SelectContent>
                  {programmeOptions.map((programme) => (
                    <SelectItem key={programme} value={programme}>
                      {programme}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {isLoadingData ? (
          <OverviewLoading />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <TopMetricCard
                title="Registered farmers"
                value={stats.totalFarmers}
                progressValue={registrationPercentage}
                progressLabel={formatProgressLabel(registrationPercentage, "of total")}
                accentColor="#2ea55f"
                icon={<UsersRound className="h-5 w-5 text-[#2ea55f]" />}
                detail={
                  <>
                    <span>male : {formatWholeNumber(stats.maleFarmers)}</span>
                    <span>|</span>
                    <span>female : {formatWholeNumber(stats.femaleFarmers)}</span>
                  </>
                }
              />

              <TopMetricCard
                title="Trained farmers"
                value={stats.trainedFarmers}
                progressValue={trainingPercentage}
                progressLabel={formatProgressLabel(trainingPercentage, "of registered farmers")}
                accentColor="#3978c7"
                icon={<Leaf className="h-5 w-5 text-[#3978c7]" />}
              />

              <TopMetricCard
                title="Animal census"
                value={stats.totalAnimals}
                progressValue={censusPercentage}
                progressLabel={formatProgressLabel(censusPercentage, "goats purchased")}
                accentColor="#f58b1f"
                icon={<ShoppingCart className="h-5 w-5 text-[#f58b1f]" />}
                detail={
                  <>
                    <span>goats : {formatWholeNumber(stats.totalGoats)}</span>
                    <span>|</span>
                    <span>purchased : {formatWholeNumber(stats.totalGoatsPurchased)}</span>
                  </>
                }
              />
            </div>

            <div className="grid items-stretch gap-6 lg:grid-cols-2">
              <DonutPanel
                title="MAINTAINED INFRASTRUCTURE"
                data={overviewData.maintainedInfrastructure ?? EMPTY_DONUT_SEGMENTS}
                comparisonNote={`Year 1 = ${comparisonYears.year1} | Year 2 = ${comparisonYears.year2}`}
              />
              <DonutPanel
                title="ANIMAL CENSUS VS GOATS PURCHASED"
                data={overviewData.animalCensusVsPurchased ?? EMPTY_OVERVIEW_DATA.animalCensusVsPurchased}
              />
            </div>

            <div className="grid items-stretch gap-6 lg:grid-cols-2">
              <DonutPanel
                title="FARMERS REGISTRATION RATE"
                data={overviewData.registrationComparison ?? EMPTY_DONUT_SEGMENTS}
                comparisonNote={`Year 1 = ${comparisonYears.year1} | Year 2 = ${comparisonYears.year2}`}
              />
              <RecentLocationsPanel locations={overviewData.recentLocations ?? EMPTY_OVERVIEW_DATA.recentLocations} />
            </div>

            <div className="grid items-stretch gap-6 lg:grid-cols-2">
              <OverviewPanel title="GOATS VACCINATION" className="flex h-full min-h-[360px] flex-col">
                <div className="mt-5 flex-1">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart
                      data={overviewData.vaccinationTrend ?? EMPTY_OVERVIEW_DATA.vaccinationTrend}
                      margin={{ top: 16, right: 8, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="overviewVaccinationFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ff7a1a" stopOpacity={0.65} />
                          <stop offset="100%" stopColor="#ff7a1a" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                      <Area
                        type="monotone"
                        dataKey="year1"
                        stroke={YEAR_ONE_COLOR}
                        strokeWidth={2}
                        fillOpacity={0}
                      />
                      <Area
                        type="monotone"
                        dataKey="year2"
                        stroke="#ff7a1a"
                        strokeWidth={2.5}
                        fill="url(#overviewVaccinationFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-center gap-5 text-sm text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#2710a1]" />
                    <span>Year 1</span>
                    <span className="font-semibold text-slate-700">{comparisonYears.year1}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff7a1a]" />
                    <span>Year 2</span>
                    <span className="font-semibold text-slate-700">{comparisonYears.year2}</span>
                  </div>
                </div>
              </OverviewPanel>

              <CountiesCoveredPanel data={overviewData.countyCoverage ?? EMPTY_COUNTY_COVERAGE} />
            </div>

            <RecentActivitiesPanel activities={overviewData.recentActivities ?? EMPTY_OVERVIEW_DATA.recentActivities} />
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardOverview;
