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
  yearly: 1404
};

// --- Interfaces ---
interface FarmerData {
  id: string;
  createdAt: number | string;
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

interface UserProgress {
  id: string;
  name: string;
  region: string;
  farmersRegistered: number;
  target: number; // Dynamic target
  progressPercentage: number;
  status: 'achieved' | 'on-track' | 'behind' | 'needs-attention';
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

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(endOfMonth),
  };
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
  
  // State for dynamic target based on selection (Week/Month/Year)
  const [activeTarget, setActiveTarget] = useState<number>(TARGETS.monthly);

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

  const [dateRange, setDateRange] = useState(getCurrentMonthDates);
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
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
      activeTarget,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "livestock-analytics",
        programme: activeProgram || null,
        dateRange,
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
        .map((key) => {
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
      farmersList.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
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
  }, [dateRange, allFarmers, trainingRecords]);

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

    const userStats: Record<string, { count: number; counties: Set<string> }> = {};
    data.forEach((farmer) => {
      const officerName = String(farmer.username || "Unknown User").trim() || "Unknown User";
      if (!userStats[officerName]) {
        userStats[officerName] = { count: 0, counties: new Set<string>() };
      }
      userStats[officerName].count += 1;
      const county = String(farmer.county || "").trim();
      if (county) {
        userStats[officerName].counties.add(county);
      }
    });

    const localProgress = Object.entries(userStats)
      .map(([name, officerData]) => {
        const progressPercentage = activeTarget > 0 ? (officerData.count / activeTarget) * 100 : 0;
        let status: UserProgress["status"] = "needs-attention";
        if (progressPercentage >= 100) status = "achieved";
        else if (progressPercentage >= 75) status = "on-track";
        else if (progressPercentage >= 50) status = "behind";

        const counties = [...officerData.counties];
        return {
          id: name,
          name,
          region: counties.slice(0, 3).join(", ") + (counties.length > 3 ? "..." : ""),
          farmersRegistered: officerData.count,
          target: activeTarget,
          progressPercentage,
          status,
        };
      })
      .sort((a, b) => b.farmersRegistered - a.farmersRegistered);
    setLocalUserProgressData(localProgress);
  };

  // User Progress with Dynamic Targets
  const userProgressData = useMemo(
    () => USE_REMOTE_ANALYTICS ? (analyticsQuery.data as any)?.userProgressData || [] : localUserProgressData,
    [analyticsQuery.data, localUserProgressData],
  );

  const handleDateRangeChange = (key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
    setActiveTarget(TARGETS.monthly); // Reset to default if manually typing dates
  };

  // Filter Buttons
  const setWeekFilter = () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
    setDateRange({
      startDate: formatDateToLocal(startOfWeek),
      endDate: formatDateToLocal(endOfWeek)
    });
    setActiveTarget(TARGETS.weekly);
  };

  const setMonthFilter = () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setDateRange({
      startDate: formatDateToLocal(startOfMonth),
      endDate: formatDateToLocal(endOfMonth)
    });
    setActiveTarget(TARGETS.monthly);
  };

  const setYearFilter = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    setDateRange({
      startDate: formatDateToLocal(startOfYear),
      endDate: formatDateToLocal(endOfYear)
    });
    setActiveTarget(TARGETS.yearly);
  };

  const clearFilters = () => {
    setDateRange({ startDate: "", endDate: "" });
    setActiveTarget(TARGETS.monthly); // Reset to default
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

  const StatsCard = ({ title, value, icon: Icon, description, color = "navy" }: any) => (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        color === 'navy' ? 'bg-blue-900' :
        color === 'orange' ? 'bg-orange-500' :
        color === 'yellow' ? 'bg-yellow-500' : 'bg-blue-900'
      }`}></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${
          color === 'navy' ? 'bg-blue-100' :
          color === 'orange' ? 'bg-orange-100' :
          color === 'yellow' ? 'bg-yellow-100' : 'bg-blue-100'
        } shadow-sm`}>
          <Icon className={`h-4 w-4 ${
            color === 'navy' ? 'text-blue-900' :
            color === 'orange' ? 'text-orange-600' :
            color === 'yellow' ? 'text-yellow-600' : 'text-blue-900'
          }`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {description && (
          <p className="text-xs text-gray-500 mt-2 font-medium">
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

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 space-y-4">
        <Card className="w-full max-w-2xl border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center text-red-800">
              <AlertCircle className="h-6 w-6 mr-2" />
              No Data Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-700">
              We could not find any farmers in database.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-row md:flex-col lg:flex-col items-start  ">
        <h1 className="text-md text-gray-900">Livestock Farmers Dashboard</h1>
        
        
          <Card className="w-full lg:w-auto border-0 shadow-lg bg-white">
            
            <CardContent className="p-3">
              <div className="flex flex-col lg:flex-row gap-2 items-center">
                
                  
                  
                    <Input
                      type="date"
                      value={dateRange.startDate}
                      onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                      className="border-gray-200 focus:border-blue-500 text-sm h-9 px-8"
                    />
               
                    
                    <Input
                      type="date"
                      value={dateRange.endDate}
                      onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                      className="border-gray-200 focus:border-blue-500 text-sm h-9"
                    />
                  
          
                  <Button variant="outline" size="sm" onClick={setWeekFilter} className="text-xs h-9">
                    This Week
                  </Button>
                  <Button variant="outline" size="sm" onClick={setMonthFilter} className="text-xs h-9">
                    This Month
                  </Button>
                  <Button variant="outline" size="sm" onClick={setYearFilter} className="text-xs h-9 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100">
                    This Year
                  </Button>
                  <Button size="sm" onClick={clearFilters} variant="secondary" className="text-xs h-9">
                    Clear
                  </Button>
                
                 {availablePrograms.length > 1 && (
            <Select value={activeProgram} onValueChange={setActiveProgram}>
              <SelectTrigger className="w-full lg:w-[180px] h-10">
                <SelectValue placeholder="Select Programme" />
              </SelectTrigger>
              <SelectContent>
                {availablePrograms.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
              </div>
            </CardContent>
          </Card>

         
        
      </div>

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

      <Card className="border-0 shadow-lg bg-white">
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <UserCheck className="h-5 w-5 text-blue-600" />
              Field Officers Performance
            </CardTitle>
            <Badge variant="outline" className="text-xs font-normal border-blue-200 text-blue-700">
              Active Target: {activeTarget.toLocaleString()} Farmers
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto rounded-md">
            <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
              <thead className="rounded">
                <tr className="bg-blue-50 p-1 px-3">
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Created By (Username)</th>
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Counties Active</th>
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Farmers Registered</th>
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Target</th>
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Progress</th>
                  <th className="py-2 px-4 text-sm text-blue-800 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {userProgressData.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-blue-50/50 transition-all duration-200 group text-sm">
                    <td className="py-3 px-4 text-gray-700 font-medium">{user.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                        {user.region || "N/A"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-900 font-semibold">{user.farmersRegistered}</td>
                    <td className="py-3 px-4 text-gray-600">{user.target}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-24 bg-gray-100 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all duration-500 ${
                              user.status === 'achieved' ? 'bg-green-500' :
                              user.status === 'on-track' ? 'bg-blue-500' :
                              user.status === 'behind' ? 'bg-yellow-500' :
                              'bg-red-400'
                            }`}
                            style={{ width: `${Math.min(user.progressPercentage, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600 w-12 text-right">
                          {user.progressPercentage.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge 
                        className={
                          user.status === 'achieved' ? 'bg-green-50 text-green-700 border-green-200' :
                          user.status === 'on-track' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          user.status === 'behind' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                          'bg-red-50 text-red-700 border-red-200'
                        }
                        variant="outline"
                      >
                        {user.status === 'achieved' ? 'Target Achieved' :
                         user.status === 'on-track' ? 'On Track' :
                         user.status === 'behind' ? 'Behind Schedule' :
                         'Needs Attention'}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {userProgressData.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-500 bg-gray-50">
                      No farmer data available for the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
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
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
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
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
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
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
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
