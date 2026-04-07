import { useState, useEffect, useCallback, useMemo } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "@/lib/firebase"; // Ensure this is getDatabase()
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalysisSummary } from "@/lib/analysis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar 
} from "recharts";
import { Users, GraduationCap, Beef, Map, UserCheck, AlertCircle, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { canViewAllProgrammes, isChiefAdmin } from "@/contexts/authhelper";
import { resolveAccessibleProgrammes, resolveActiveProgramme } from "@/lib/programme-access";

// --- Constants ---
const COLORS = {
  navy: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b",
  maroon: "#7f1d1d"
};
const BAR_COLORS = [COLORS.navy, COLORS.orange, COLORS.yellow];

// Target Constants
const TARGETS = {
  weekly: 30,
  monthly: 117,
  quarterly: 351,
  yearly: 1404
};
const PROGRESS_MONTHLY_TARGET = 117;

// --- Interfaces ---
interface FarmerData {
  id: string;
  createdAt: number | string;
  registrationDate?: number | string;
  name: string;
  gender: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  goats: number | string | { male?: number | string; female?: number | string; total?: number | string };
  sheep: number | string;
  programme?: string;
  username?: string;
}

interface TrainingData {
  id: string;
  startDate?: string;
  createdAt?: number | string;
  totalFarmers?: number;
  programme?: string;
}

type ProgressStatus = "achieved" | "on-track" | "behind" | "needs-attention";

type ProgressPeriodKey = "q1" | "q2" | "q3" | "year";

interface ProgressPeriod {
  key: ProgressPeriodKey;
  label: string;
  count: number;
  target: number;
  progressPercentage: number;
  status: ProgressStatus;
  met: boolean;
}

interface UserProgress {
  id: string;
  name: string;
  region: string;
  farmersRegistered: number;
  target: number; // Dynamic target
  progressPercentage: number;
  status: ProgressStatus;
  periods: ProgressPeriod[];
}

interface PieDataItem {
  name: string;
  value: number;
  color: string;
}

interface TimeSeriesItem {
  name: string;
  farmers: any;
  animals: any;
}

type FilterMode = "weekly" | "monthly" | "yearly" | "custom";

const getGenderColor = (label: string): string => {
  const normalized = label.trim().toLowerCase();
  if (normalized === "male") return COLORS.navy;
  if (normalized === "female") return COLORS.orange;
  return COLORS.yellow;
};

const getAnimalCensusColor = (label: string): string => {
  const normalized = label.trim().toLowerCase();
  if (normalized === "goats") return COLORS.maroon;
  if (normalized === "sheep") return COLORS.orange;
  return COLORS.navy;
};

const normalizePieChartData = (
  data: Array<Partial<PieDataItem>> | undefined,
  chartType: "gender" | "animal",
): PieDataItem[] =>
  (data || [])
    .map((item) => {
      const value = typeof item?.value === "number" ? item.value : Number(item?.value || 0);
      return {
        name: typeof item?.name === "string" ? item.name : "",
        value: Number.isFinite(value) ? value : 0,
      };
    })
    .filter((item) => item.name && item.value > 0)
    .map((item) => ({
      name: item.name,
      value: item.value,
      color: chartType === "gender" ? getGenderColor(item.name) : getAnimalCensusColor(item.name),
    }));

// --- Helper Functions ---

const getCachedData = (key: string) => {
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch (e) {
    console.error("Cache read error", e);
  }
  return null;
};

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return null;
};

const formatDateToLocal = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const getToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const getDateTimestamp = (value: unknown): number => parseDate(value)?.getTime() || 0;

const getCurrentMonthDates = () => {
  const now = getToday();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(now),
  };
};

const getCurrentYearDates = () => {
  const now = getToday();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    startDate: formatDateToLocal(startOfYear),
    endDate: formatDateToLocal(now),
  };
};

const getCurrentWeekDates = () => {
  const now = getToday();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  return {
    startDate: formatDateToLocal(startOfWeek),
    endDate: formatDateToLocal(now),
  };
};

const normalizeDateRange = (range: { startDate?: string; endDate?: string }) => {
  const today = getToday();
  const start = parseDate(range.startDate) ?? parseDate(range.endDate) ?? today;
  const end = parseDate(range.endDate) ?? parseDate(range.startDate) ?? today;
  const normalizedStart = new Date(start);
  const normalizedEnd = new Date(end);
  normalizedStart.setHours(0, 0, 0, 0);
  normalizedEnd.setHours(0, 0, 0, 0);

  if (normalizedEnd > today) {
    normalizedEnd.setTime(today.getTime());
  }

  if (normalizedStart > normalizedEnd) {
    return {
      start: normalizedEnd,
      end: normalizedStart > today ? today : normalizedStart,
    };
  }

  return { start: normalizedStart, end: normalizedEnd };
};

const getInclusiveDayCount = (start: Date, end: Date): number =>
  Math.max(1, Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
};

const isSameCalendarWeek = (start: Date, end: Date): boolean => {
  const startOfWeek = new Date(start);
  startOfWeek.setDate(start.getDate() - start.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  return end >= startOfWeek && end <= endOfWeek;
};

const countCoveredWeeks = (start: Date, end: Date): number => {
  let total = 0;
  let cursor = new Date(start);

  while (cursor <= end) {
    total += 1;
    const weekStart = new Date(cursor);
    weekStart.setDate(cursor.getDate() - cursor.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    cursor = addDays(weekEnd, 1);
  }

  return Math.max(1, total);
};

const countCoveredMonths = (start: Date, end: Date): number => {
  let total = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    total += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return Math.max(1, total);
};

const countCoveredYears = (start: Date, end: Date): number =>
  Math.max(1, end.getFullYear() - start.getFullYear() + 1);

const resolveTargetMode = (
  dateRange: { startDate?: string; endDate?: string },
  filterMode: FilterMode,
): Exclude<FilterMode, "custom"> => {
  if (filterMode !== "custom") return filterMode;

  const { start, end } = normalizeDateRange(dateRange);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (isSameCalendarWeek(start, end)) return "weekly";
  if (sameMonth) return "monthly";
  if (sameYear) return "monthly";
  return "yearly";
};

const calculateActiveTarget = (
  dateRange: { startDate?: string; endDate?: string },
  targetMode: Exclude<FilterMode, "custom">,
): number => {
  const { start, end } = normalizeDateRange(dateRange);

  const target =
    targetMode === "weekly"
      ? countCoveredWeeks(start, end) * TARGETS.weekly
      : targetMode === "monthly"
        ? countCoveredMonths(start, end) * TARGETS.monthly
        : countCoveredYears(start, end) * TARGETS.yearly;

  return Math.max(1, Math.round(target));
};

const normalizeProgramme = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const parseNumericValue = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getGoatTotal = (goats: any): number => {
  if (typeof goats === "number" || typeof goats === "string") return parseNumericValue(goats);
  if (typeof goats === "object" && goats !== null) {
    if (Object.prototype.hasOwnProperty.call(goats, "total")) {
      return parseNumericValue(goats.total);
    }
    return parseNumericValue(goats.male) + parseNumericValue(goats.female);
  }
  return 0;
};

const getProgressStatus = (progressPercentage: number): ProgressStatus => {
  if (progressPercentage >= 100) return "achieved";
  if (progressPercentage >= 75) return "on-track";
  if (progressPercentage >= 50) return "behind";
  return "needs-attention";
};

const USE_REMOTE_ANALYTICS =
  typeof window !== "undefined" && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

const LivestockFarmersAnalytics = () => {
  const { user, userRole, userAttribute, allowedProgrammes } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<FarmerData[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingData[]>([]);
  const [filteredData, setFilteredData] = useState<FarmerData[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("yearly");

  // Chart Data States
  const [genderData, setGenderData] = useState<PieDataItem[]>([]);
  const [animalCensusData, setAnimalCensusData] = useState<PieDataItem[]>([]); 
  const [weeklyPerformanceData, setWeeklyPerformanceData] = useState<TimeSeriesItem[]>([]); 
  const [subcountyPerformanceData, setSubcountyPerformanceData] = useState<any[]>([]);
  const [localUserProgressData, setLocalUserProgressData] = useState<UserProgress[]>([]);
  
  const [stats, setStats] = useState({ 
    total: 0, 
    trained: 0, 
    totalAnimals: 0,
    trainingRate: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    totalTrainedFromCapacity: 0
  });

  const [dateRange, setDateRange] = useState(getCurrentYearDates);
  const targetMode = useMemo(
    () => resolveTargetMode(dateRange, filterMode),
    [dateRange, filterMode],
  );
  const activeTarget = useMemo(
    () => calculateActiveTarget(dateRange, targetMode),
    [dateRange, targetMode],
  );
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const progressYear = new Date().getFullYear();
  const quarterTargets = useMemo(() => [
    {
      key: "q1" as const,
      label: "Q1",
      start: new Date(progressYear, 0, 1),
      end: new Date(progressYear, 2, 31),
      target: PROGRESS_MONTHLY_TARGET * 3,
    },
    {
      key: "q2" as const,
      label: "Q2",
      start: new Date(progressYear, 0, 1),
      end: new Date(progressYear, 5, 30),
      target: PROGRESS_MONTHLY_TARGET * 6,
    },
    {
      key: "q3" as const,
      label: "Q3",
      start: new Date(progressYear, 0, 1),
      end: new Date(progressYear, 8, 30),
      target: PROGRESS_MONTHLY_TARGET * 9,
    },
    {
      key: "year" as const,
      label: "Full Year",
      start: new Date(progressYear, 0, 1),
      end: new Date(progressYear, 11, 31),
      target: PROGRESS_MONTHLY_TARGET * 12,
    },
  ], [progressYear]);
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );

  const analyticsQuery = useQuery({
    queryKey: [
      "livestock-analytics",
      user?.uid,
      userRole,
      userAttribute,
      activeProgram,
      dateRange.startDate,
      dateRange.endDate,
      targetMode,
      activeTarget,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "livestock-analytics",
        programme: activeProgram || null,
        dateRange,
        timeFrame: targetMode,
        target: activeTarget,
      }),
    enabled: USE_REMOTE_ANALYTICS && !!activeProgram,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    const analysis = analyticsQuery.data as any;
    if (!analysis) return;

    setStats({
      total: analysis.total || 0,
      trained: analysis.trained || 0,
      totalAnimals: analysis.totalAnimals || 0,
      trainingRate: analysis.trainingRate || 0,
      maleFarmers: analysis.maleFarmers || 0,
      femaleFarmers: analysis.femaleFarmers || 0,
      totalTrainedFromCapacity: analysis.totalTrainedFromCapacity || 0,
    });
    setGenderData(normalizePieChartData(analysis.genderData, "gender"));
    setAnimalCensusData(normalizePieChartData(analysis.animalCensusData, "animal"));
    setWeeklyPerformanceData(analysis.weeklyPerformanceData || []);
    setSubcountyPerformanceData(analysis.subcountyPerformanceData || []);
    setFilteredData([]);
  }, [analyticsQuery.data]);

  // --- 1. Fetch User Permissions ---
  useEffect(() => {
    setAvailablePrograms(accessibleProgrammes);
    setActiveProgram((prev) => resolveActiveProgramme(prev, accessibleProgrammes));
  }, [accessibleProgrammes]);

  // --- 2. Data Fetching (Farmers) ---
  useEffect(() => {
    if (USE_REMOTE_ANALYTICS) return;
    if (!activeProgram) {
        setAllFarmers([]);
        setLocalUserProgressData([]);
        setLoading(false);
        return;
    }
    setLoading(true);
    
    const cacheKey = `farmers_cache_${activeProgram}`;
    const cachedFarmers = getCachedData(cacheKey);
    if (cachedFarmers && cachedFarmers.length > 0) {
      setAllFarmers(cachedFarmers);
      setLoading(false);
    }

    const farmersRef = ref(db, 'farmers');
    const unsubscribe = onValue(farmersRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setAllFarmers([]);
        setLoading(false);
        localStorage.removeItem(cacheKey); 
        return;
      }

      const normalizedActiveProgram = normalizeProgramme(activeProgram);
      const farmersList = Object.keys(data)
        .map<FarmerData | null>((key) => {
          const item = data[key] || {};
          const programme = normalizeProgramme(item.programme ?? item.Programme);
          if (normalizedActiveProgram && programme !== normalizedActiveProgram) {
            return null;
          }

          const parsedCreatedAt =
            parseDate(item.createdAt)?.getTime() ||
            parseDate(item.created_at)?.getTime() ||
            parseDate(item.registrationDate)?.getTime() ||
            Date.now();

          return {
            id: key,
            createdAt: parsedCreatedAt,
            name: item.name || item.farmerName || '',
            gender: item.gender || '',
            phone: item.phone || item.phoneNumber || '',
            county: item.county || item.County || '',
            subcounty: item.subcounty || item.Subcounty || item["Sub County"] || item["Sub-County"] || '',
            location: item.location || item.Location || item.subcounty || item.Subcounty || '',
            goats: item.goats ?? item.Goats ?? item.totalGoats ?? 0,
            sheep: item.sheep ?? item.Sheep ?? 0,
            programme,
            username: item.username || item.created_by || item.createdBy || item.fieldOfficer || item.officer || 'Unknown User'
          };
        })
        .filter((item): item is FarmerData => item !== null);
      farmersList.sort((a, b) => getDateTimestamp(b.createdAt) - getDateTimestamp(a.createdAt));
      setAllFarmers(farmersList);
      setLoading(false);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(farmersList));
      } catch (e) {
        console.warn("Cache write failed", e);
      }
    }, (error) => {
      console.error("Error fetching farmers data:", error);
      setLoading(false);
    });
    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram]);

  // --- 3. Data Fetching (Capacity Building) ---
  useEffect(() => {
    if (USE_REMOTE_ANALYTICS) return;
    if (!activeProgram) {
        setTrainingRecords([]);
        return;
    }
    const cacheKey = `training_cache_${activeProgram}`;
    const cachedTraining = getCachedData(cacheKey);
    if (cachedTraining && cachedTraining.length > 0) {
        setTrainingRecords(cachedTraining);
    }
    const trainingRef = ref(db, 'capacityBuilding');
    const unsubscribe = onValue(trainingRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setTrainingRecords([]);
            localStorage.removeItem(cacheKey);
            return;
        }
        const normalizedActiveProgram = normalizeProgramme(activeProgram);
        const records = Object.keys(data)
          .map((key) => {
            const item = data[key] || {};
            const programme = normalizeProgramme(item.programme ?? item.Programme);
            if (normalizedActiveProgram && programme !== normalizedActiveProgram) {
              return null;
            }
            return {
              id: key,
              ...item,
              programme,
              startDate: item.startDate || item.start_date || item.date || item.Date,
              createdAt: item.createdAt ?? item.created_at ?? item.startDate ?? item.start_date ?? item.date ?? item.Date,
            };
          })
          .filter((item): item is TrainingData => item !== null);
        setTrainingRecords(records);
        try {
            localStorage.setItem(cacheKey, JSON.stringify(records));
        } catch (e) {
            console.warn("Cache write failed", e);
        }
    }, (error) => {
        console.error("Error fetching training data:", error);
    });
    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram]);

  // --- 4. Filtering & Analytics Logic ---
  useEffect(() => {
    if (USE_REMOTE_ANALYTICS) return;
    applyFilters();
  }, [activeTarget, allFarmers, dateRange, filterMode, trainingRecords]);

  const isDateInRange = (date: any, startDate: string, endDate: string): boolean => {
    if (!startDate && !endDate) return true;
    const farmerDate = parseDate(date);
    if (!farmerDate) return false;
    const farmerDateOnly = new Date(farmerDate);
    farmerDateOnly.setHours(0, 0, 0, 0);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);
    if (start && farmerDateOnly < start) return false;
    if (end && farmerDateOnly > end) return false;
    return true;
  };

  const applyFilters = () => {
    const filtered = allFarmers.filter(farmer => 
      isDateInRange(farmer.createdAt, dateRange.startDate, dateRange.endDate)
    );
    setFilteredData(filtered);
    updateAnalytics(filtered);
  };

  const updateAnalytics = (data: FarmerData[]) => {
    // Gender distribution
    const maleCount = data.filter(f => String(f.gender).toLowerCase() === 'male').length;
    const femaleCount = data.filter(f => String(f.gender).toLowerCase() === 'female').length;

    // Training Stats
    const filteredTrainingRecords = trainingRecords.filter((record) =>
      isDateInRange(record.startDate || record.createdAt, dateRange.startDate, dateRange.endDate)
    );
    const totalTrainedFromCapacity = filteredTrainingRecords.reduce(
      (sum, t) => sum + parseNumericValue(t.totalFarmers),
      0
    );
    
    // Capacity-building totals can include repeat attendees, so keep coverage bounded to registered farmers.
    const trainingRate = data.length > 0 ?
      (Math.min(totalTrainedFromCapacity, data.length) / data.length) * 100 :
      0;

    // Animal Census
    let totalGoats = 0;
    let totalSheep = 0;
    
    data.forEach(farmer => {
      const g = getGoatTotal(farmer.goats);
      totalGoats += g;
      totalSheep += parseNumericValue(farmer.sheep);
    });

    const totalAnimals = totalGoats + totalSheep;

    // Set Stats
    setStats({ 
      total: data.length, 
      trained: totalTrainedFromCapacity,
      totalAnimals,
      trainingRate,
      maleFarmers: maleCount,
      femaleFarmers: femaleCount,
      totalTrainedFromCapacity
    });

    // 1. Gender Data
    const genderChartData: PieDataItem[] = [
      { name: "Male", value: Number(maleCount), color: getGenderColor("Male") },
      { name: "Female", value: Number(femaleCount), color: getGenderColor("Female") },
    ];
    setGenderData(genderChartData);

    // 2. Animal Census Data
    const animalChartData: PieDataItem[] = [
      { name: "Goats", value: Number(totalGoats), color: getAnimalCensusColor("Goats") },
      { name: "Sheep", value: Number(totalSheep), color: getAnimalCensusColor("Sheep") },
    ];
    setAnimalCensusData(animalChartData);

    // 3. Weekly Performance (Farmers vs Livestock)
    const weeks: Record<number, { farmers: number; animals: number }> = {
      1: { farmers: 0, animals: 0 },
      2: { farmers: 0, animals: 0 },
      3: { farmers: 0, animals: 0 },
      4: { farmers: 0, animals: 0 }
    };

    data.forEach(farmer => {
      const date = new Date(farmer.createdAt);
      const day = date.getDate();
      const weekNum = Math.ceil(day / 7); 
      if (weekNum >= 1 && weekNum <= 4) {
        weeks[weekNum].farmers++;
        weeks[weekNum].animals += getGoatTotal(farmer.goats) + parseNumericValue(farmer.sheep);
      }
    });

    const weeklyChartData: TimeSeriesItem[] = [
      { name: "Week 1", farmers: weeks[1].farmers, animals: weeks[1].animals },
      { name: "Week 2", farmers: weeks[2].farmers, animals: weeks[2].animals },
      { name: "Week 3", farmers: weeks[3].farmers, animals: weeks[3].animals },
      { name: "Week 4", farmers: weeks[4].farmers, animals: weeks[4].animals },
    ];
    setWeeklyPerformanceData(weeklyChartData);

    // 4. Subcounty Performance
    const subcountyStats: Record<string, number> = {};
    data.forEach(farmer => {
      const sc = farmer.subcounty || "Unknown";
      subcountyStats[sc] = (subcountyStats[sc] || 0) + 1;
    });
    const scData = Object.entries(subcountyStats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
    setSubcountyPerformanceData(scData);

    const userStats: Record<string, { periods: Record<ProgressPeriodKey, number>; counties: Set<string> }> = {};
    const trackedFarmers = allFarmers.length > 0 ? allFarmers : data;

    trackedFarmers.forEach((farmer) => {
      const officerName = String(farmer.username || "Unknown User").trim() || "Unknown User";
      if (!userStats[officerName]) {
        userStats[officerName] = {
          periods: { q1: 0, q2: 0, q3: 0, year: 0 },
          counties: new Set<string>(),
        };
      }

      const farmerDate = parseDate(farmer.createdAt || farmer.registrationDate);
      if (farmerDate && farmerDate.getFullYear() === progressYear) {
        quarterTargets.forEach((period) => {
          if (farmerDate >= period.start && farmerDate <= period.end) {
            userStats[officerName].periods[period.key] += 1;
          }
        });
      }

      const county = String(farmer.county || "").trim();
      if (county) {
        userStats[officerName].counties.add(county);
      }
    });

    const localProgress = Object.entries(userStats)
      .map(([name, officerData]) => {
        const periods = quarterTargets.map((period) => {
          const count = officerData.periods[period.key];
          const progressPercentage = period.target > 0 ? (count / period.target) * 100 : 0;
          const status = getProgressStatus(progressPercentage);
          return {
            key: period.key,
            label: period.label,
            count,
            target: period.target,
            progressPercentage,
            status,
            met: count >= period.target,
          };
        });
        const yearProgress = periods[periods.length - 1];
        const counties = [...officerData.counties];
        return {
          id: name,
          name,
          region: counties.slice(0, 3).join(", ") + (counties.length > 3 ? "..." : ""),
          farmersRegistered: yearProgress.count,
          target: yearProgress.target,
          progressPercentage: yearProgress.progressPercentage,
          status: yearProgress.status,
          periods,
        };
      })
      .sort((a, b) => b.farmersRegistered - a.farmersRegistered);
    setLocalUserProgressData(localProgress);
  };

  // User Progress with Dynamic Targets
  const userProgressData = useMemo(
    () => {
      const rawProgressData = USE_REMOTE_ANALYTICS ? (analyticsQuery.data as any)?.userProgressData || [] : localUserProgressData;
      return rawProgressData.map((user: any) => {
        const periods = Array.isArray(user.periods) && user.periods.length > 0 ?
          user.periods :
          [
            {
              key: "year" as const,
              label: "Full Year",
              count: Number(user.farmersRegistered || 0),
              target: Number(user.target || TARGETS.yearly),
              progressPercentage: Number(user.progressPercentage || 0),
              status: (user.status || "needs-attention") as ProgressStatus,
              met: Number(user.farmersRegistered || 0) >= Number(user.target || TARGETS.yearly),
            },
          ];
        return { ...user, periods } as UserProgress;
      });
    },
    [analyticsQuery.data, localUserProgressData],
  );

  const handleDateRangeChange = (key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
    setFilterMode("custom");
  };

  // Filter Buttons
  const setWeekFilter = () => {
    setDateRange(getCurrentWeekDates());
    setFilterMode("weekly");
  };

  const setMonthFilter = () => {
    setDateRange(getCurrentMonthDates());
    setFilterMode("monthly");
  };

  const setYearFilter = () => {
    setDateRange(getCurrentYearDates());
    setFilterMode("yearly");
  };

  const clearFilters = () => {
    const currentYearRange = getCurrentYearDates();
    setDateRange(currentYearRange);
    setFilterMode("yearly");
  };

  const renderCustomizedLabel = useCallback(({
    cx, cy, midAngle, innerRadius, outerRadius, percent
  }: any) => {
    if (percent === 0) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize="12"
        fontWeight="bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  }, []);

  const getFilterButtonClass = (isActive: boolean) =>
    isActive
      ? "text-xs h-9 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
      : "text-xs h-9";

  const getPeriodBadgeClass = (status: ProgressStatus) => {
    if (status === "achieved") return "border-green-200 bg-green-50 text-green-700";
    if (status === "on-track") return "border-blue-200 bg-blue-50 text-blue-700";
    if (status === "behind") return "border-yellow-200 bg-yellow-50 text-yellow-700";
    return "border-red-200 bg-red-50 text-red-700";
  };

  const renderPeriodCell = (period: ProgressPeriod) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-slate-900">
        {period.count.toLocaleString()}
      </span>
      <Badge variant="outline" className={`text-[11px] font-semibold ${getPeriodBadgeClass(period.status)}`}>
        {period.met ? "Met target" : "Not met"}
      </Badge>
    </div>
  );

  const StatsCard = ({ title, value, icon: Icon, description, color = "navy" }: any) => (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        color === 'navy' ? 'bg-blue-900' :
        color === 'orange' ? 'bg-orange-500' :
        color === 'yellow' ? 'bg-yellow-500' : 'bg-blue-900'
      }`}></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 pl-5 pr-4">
        <CardTitle className="text-xs font-medium text-gray-600">{title}</CardTitle>
        <div className={`rounded-xl p-1.5 ${
          color === 'navy' ? 'bg-blue-100' :
          color === 'orange' ? 'bg-orange-100' :
          color === 'yellow' ? 'bg-yellow-100' : 'bg-blue-100'
        } shadow-sm`}>
          <Icon className={`h-3.5 w-3.5 ${
            color === 'navy' ? 'text-blue-900' :
            color === 'orange' ? 'text-orange-600' :
            color === 'yellow' ? 'text-yellow-600' : 'text-blue-900'
          }`} />
        </div>
      </CardHeader>
      <CardContent className="pl-5 pb-4">
        <div className="text-xl font-bold tracking-tight text-gray-900 sm:text-[1.65rem]">{value}</div>
        {description && (
          <p className="mt-1.5 text-[11px] font-medium text-gray-500">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );

  if (analyticsQuery.isLoading || analyticsQuery.isFetching) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="ml-2 text-gray-600">Loading analytics data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-1">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">Livestock Farmers Dashboard</h1>

        <Card className="w-full border-0 bg-white shadow-lg">
          <CardContent className="p-4">
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <Input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                  className="h-9 border-gray-200 px-3 text-sm focus:border-blue-500"
                />

                <Input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                  className="h-9 border-gray-200 px-3 text-sm focus:border-blue-500"
                />

                {availablePrograms.length > 1 ? (
                  <Select value={activeProgram} onValueChange={setActiveProgram}>
                    <SelectTrigger className="h-9 w-full border-gray-200 text-sm">
                      <SelectValue placeholder="Select Programme" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePrograms.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setWeekFilter}
                  className={`${getFilterButtonClass(filterMode === "weekly")} w-full`}
                >
                  This Week
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setMonthFilter}
                  className={`${getFilterButtonClass(filterMode === "monthly")} w-full`}
                >
                  This Month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setYearFilter}
                  className={`${getFilterButtonClass(filterMode === "yearly")} w-full`}
                >
                  This Year
                </Button>
                <Button size="sm" onClick={clearFilters} variant="secondary" className="h-9 w-full text-xs">
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.total === 0 ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center text-base text-amber-800">
              <AlertCircle className="mr-2 h-5 w-5" />
              No farmer data for this filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-700">
              No farmers were found for the selected date range. Change the dates or use Clear to return to the current year.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
        <StatsCard 
          title="Total Farmers" 
          value={stats.total.toLocaleString()} 
          icon={Users}
          description={`${stats.maleFarmers} Male (${stats.maleFarmers > 0 ? ((stats.maleFarmers / stats.total) * 100).toFixed(1) : 0}%) | ${stats.femaleFarmers} Female`}
          color="navy"
        />
        <StatsCard 
          title="Trained Farmers" 
          value={stats.trained.toLocaleString()} 
          icon={GraduationCap}
          description={`${stats.trainingRate.toFixed(1)}% training coverage`}
          color="yellow"
        />
        <StatsCard 
          title="Animals Census" 
          value={stats.totalAnimals.toLocaleString()} 
          icon={Beef}
          description="Total livestock count"
          color="orange"
        />
      </div>

      <div className="space-y-6">
        <Card className="overflow-hidden border border-slate-200 bg-white shadow-lg">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                <UserCheck className="h-5 w-5 text-blue-600" />
                Field Officers Performance
              </CardTitle>
              <Badge variant="outline" className="text-xs font-normal border-blue-200 text-blue-700">
                Active Target: {activeTarget.toLocaleString()} Farmers
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[880px] w-full border-collapse text-left">
                <thead className="bg-blue-50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Field Officer</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Counties Active</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Farmers Registered</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Target</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Progress</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {userProgressData.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/40">
                      <td className="px-4 py-4 font-medium text-slate-900">
                        <div className="leading-tight">{user.name}</div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                          {user.region || "N/A"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-900">
                        {user.farmersRegistered.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-slate-600">{user.target.toLocaleString()}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-28 rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                user.status === "achieved" ? "bg-green-500" :
                                user.status === "on-track" ? "bg-blue-500" :
                                user.status === "behind" ? "bg-yellow-500" :
                                "bg-red-400"
                              }`}
                              style={{ width: `${Math.min(user.progressPercentage, 100)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs font-medium text-slate-600">
                            {user.progressPercentage.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          className={
                            user.status === "achieved" ? "border-green-200 bg-green-50 text-green-700" :
                            user.status === "on-track" ? "border-blue-200 bg-blue-50 text-blue-700" :
                            user.status === "behind" ? "border-yellow-200 bg-yellow-50 text-yellow-700" :
                            "border-red-200 bg-red-50 text-red-700"
                          }
                          variant="outline"
                        >
                          {user.status === "achieved" ? "Target Achieved" :
                           user.status === "on-track" ? "On Track" :
                           user.status === "behind" ? "Behind Schedule" :
                           "Needs Attention"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {userProgressData.length === 0 && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 py-8 text-center text-gray-500">
                        No farmer data available for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border border-slate-200 bg-white shadow-lg">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                <UserCheck className="h-5 w-5 text-blue-600" />
                Field Officers Quarterly Progress
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {quarterTargets.map((period) => (
                  <Badge
                    key={period.key}
                    variant="outline"
                    className="text-xs font-normal border-blue-200 text-blue-700"
                  >
                    {period.label} target: {period.target.toLocaleString()} farmers
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left">
                <thead className="bg-blue-50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Field Officer</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Counties Active</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Q1</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Q2</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Q3</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Full Year</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-blue-800">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {userProgressData.map((user) => {
                    const periods = user.periods;
                    const q1 = periods.find((period) => period.key === "q1") || periods[0];
                    const q2 = periods.find((period) => period.key === "q2") || periods[1] || q1;
                    const q3 = periods.find((period) => period.key === "q3") || periods[2] || q2;
                    const yearPeriod = periods.find((period) => period.key === "year") || periods[periods.length - 1] || q3;
                    return (
                      <tr key={user.id} className="border-b border-slate-100 transition-colors hover:bg-blue-50/40">
                        <td className="px-4 py-4 font-medium text-slate-900">
                          <div className="leading-tight">{user.name}</div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                            {user.region || "N/A"}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">{renderPeriodCell(q1)}</td>
                        <td className="px-4 py-4">{renderPeriodCell(q2)}</td>
                        <td className="px-4 py-4">{renderPeriodCell(q3)}</td>
                        <td className="px-4 py-4">{renderPeriodCell(yearPeriod)}</td>
                        <td className="px-4 py-4">
                          <Badge
                            variant="outline"
                            className={
                              user.status === "achieved" ? "border-green-200 bg-green-50 text-green-700" :
                              user.status === "on-track" ? "border-blue-200 bg-blue-50 text-blue-700" :
                              user.status === "behind" ? "border-yellow-200 bg-yellow-50 text-yellow-700" :
                              "border-red-200 bg-red-50 text-red-700"
                            }
                          >
                            {user.status === "achieved" ? "Target Achieved" :
                             user.status === "on-track" ? "On Track" :
                             user.status === "behind" ? "Behind Schedule" :
                             "Needs Attention"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {userProgressData.length === 0 && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 py-8 text-center text-gray-500">
                        No field officer progress data available for the selected programme.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-gray-800">
              <Users className="h-5 w-5 text-blue-900" />
              Farmers by Gender
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={genderData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                >
                  {genderData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value, "Farmers"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-gray-800">
              <Beef className="h-5 w-5 text-red-900" />
              Animal Census
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={animalCensusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                  startAngle={90}
                  endAngle={-270}
                >
                  {animalCensusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value.toLocaleString(), "Animals"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center mt-2">
               <p className="text-xs text-gray-500">Total Livestock: {stats.totalAnimals.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-gray-800">
              <Activity className="h-5 w-5 text-orange-600" />
              Farmers vs Livestock (Weekly Trend)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={weeklyPerformanceData}>
                <defs>
                  <linearGradient id="colorFarmers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.navy} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS.navy} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAnimals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.orange} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS.orange} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                />
                <YAxis 
                  fontSize={11} 
                  tick={{ fill: '#6b7280' }}
                />
                <Tooltip 
                  cursor={{fill: 'transparent'}}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={40}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="farmers" 
                  stroke={COLORS.navy} 
                  fillOpacity={1} 
                  fill="url(#colorFarmers)" 
                  strokeWidth={2}
                  name="Farmers" 
                />
                <Area 
                  type="monotone" 
                  dataKey="animals" 
                  stroke={COLORS.orange} 
                  fillOpacity={1} 
                  fill="url(#colorAnimals)" 
                  strokeWidth={2}
                  name="Livestock" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-gray-800">
              <Map className="h-5 w-5 text-blue-900" />
              Subcounty Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={subcountyPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  fontSize={11} 
                  tick={{ fill: '#6b7280' }}
                />
                <Tooltip 
                  cursor={{fill: 'transparent'}}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={40}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px' }}
                />
                <Bar dataKey="value" name="Farmers" fill={COLORS.navy} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LivestockFarmersAnalytics;
