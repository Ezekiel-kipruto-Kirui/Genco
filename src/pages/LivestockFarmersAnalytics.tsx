import { useState, useEffect, useCallback, useMemo } from "react";
import { ref, onValue, query, orderByChild, equalTo } from "firebase/database";
import { db } from "@/lib/firebase"; // Ensure this is getDatabase()
import { useAuth } from "@/contexts/AuthContext";
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
import { isChiefAdmin } from "@/contexts/authhelper";
import { getAuth } from "firebase/auth";

// --- Constants ---
const COLORS = {
  navy: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b"
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
  goats: number | { male: number; female: number; total: number }; 
  sheep: number | string;
  username?: string;
}

interface TrainingData {
  id: string;
  startDate?: string;
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

const getGoatTotal = (goats: any): number => {
  if (typeof goats === 'number') return goats;
  if (typeof goats === 'object' && goats !== null && typeof goats.total === 'number') return goats.total;
  return 0;
};

const LivestockFarmersAnalytics = () => {
  const { user, userRole } = useAuth();
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

  // --- 1. Fetch User Permissions ---
  useEffect(() => {
    if (isChiefAdmin(userRole)) {
      setAvailablePrograms(["RANGE", "KPMD"]);
      if (!activeProgram) setActiveProgram("RANGE");
      return;
    }

    const auth = getAuth();
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const userRef = ref(db, `users/${uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.allowedProgrammes) {
        const programs = Object.keys(data.allowedProgrammes).filter(
          key => data.allowedProgrammes[key] === true
        );
        setAvailablePrograms(programs);
        if (programs.length > 0 && !programs.includes(activeProgram)) {
          setActiveProgram(programs[0]);
        } else if (programs.length === 0) {
            setActiveProgram("");
        }
      } else {
        setAvailablePrograms([]);
      }
    }, (error) => {
        console.error("Error fetching user permissions:", error);
    });
    return () => unsubscribe();
  }, [userRole, activeProgram]);

  // --- 2. Data Fetching (Farmers) ---
  useEffect(() => {
    if (!activeProgram) {
        setAllFarmers([]);
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

    const farmersQuery = query(ref(db, 'farmers'), orderByChild('programme'), equalTo(activeProgram));
    const unsubscribe = onValue(farmersQuery, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setAllFarmers([]);
        setLoading(false);
        localStorage.removeItem(cacheKey); 
        return;
      }

      const farmersList = Object.keys(data).map((key) => {
        const item = data[key];
        let dateValue = item.createdAt;
        if (typeof dateValue !== 'number') {
           dateValue = parseDate(item.registrationDate)?.getTime() || Date.now();
        }
        return {
          id: key,
          createdAt: dateValue,
          name: item.name || '',
          gender: item.gender || '',
          phone: item.phone || '',
          county: item.county || '',
          subcounty: item.subcounty || '',
          location: item.location || item.subcounty || '',
          goats: item.goats || 0,
          sheep: item.sheep || 0,
          username: item.username || 'Unknown'
        };
      });
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
    if (!activeProgram) {
        setTrainingRecords([]);
        return;
    }
    const cacheKey = `training_cache_${activeProgram}`;
    const cachedTraining = getCachedData(cacheKey);
    if (cachedTraining && cachedTraining.length > 0) {
        setTrainingRecords(cachedTraining);
    }
    const trainingQuery = query(ref(db, 'capacityBuilding'), orderByChild('programme'), equalTo(activeProgram));
    const unsubscribe = onValue(trainingQuery, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setTrainingRecords([]);
            localStorage.removeItem(cacheKey);
            return;
        }
        const records = Object.keys(data).map((key) => ({ id: key, ...data[key] }));
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
    if (allFarmers.length > 0) {
      applyFilters();
    }
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
    const totalTrainedFromCapacity = trainingRecords.reduce((sum, t) => sum + (Number(t.totalFarmers) || 0), 0);
    
    // Realistic Percentage: trained vs total registered farmers in filter
    // Note: If totalTrainedFromCapacity exceeds data.length (due to repeat attendees or data mismatch), 
    // we cap visual representation or show >100%. Here we calculate raw ratio.
    const trainingRate = data.length > 0 ? (totalTrainedFromCapacity / data.length) * 100 : 0;

    // Animal Census
    let totalGoats = 0;
    let totalSheep = 0;
    
    data.forEach(farmer => {
      const g = getGoatTotal(farmer.goats);
      totalGoats += g;
      totalSheep += Number(farmer.sheep || 0);
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
      { name: "Male", value: Number(maleCount), color: COLORS.navy },
      { name: "Female", value: Number(femaleCount), color: COLORS.orange },
    ];
    setGenderData(genderChartData);

    // 2. Animal Census Data
    const animalChartData: PieDataItem[] = [
      { name: "Goats", value: Number(totalGoats), color: COLORS.navy },
      { name: "Sheep", value: Number(totalSheep), color: COLORS.yellow },
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
        weeks[weekNum].animals += getGoatTotal(farmer.goats) + Number(farmer.sheep || 0);
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
  };

  // User Progress with Dynamic Targets
  const userProgressData = useMemo(() => {
    const userStats: Record<string, { count: number; counties: Set<string> }> = {};
    filteredData.forEach(farmer => {
      const username = farmer.username || "Unknown User";
      if (!userStats[username]) {
        userStats[username] = { count: 0, counties: new Set() };
      }
      userStats[username].count++;
      const county = farmer.county;
      if (county) {
        userStats[username].counties.add(county);
      }
    });

    return Object.entries(userStats).map(([username, data]) => {
      const target = activeTarget; // Use the state-controlled target
      const progressPercentage = (data.count / target) * 100;
      
      let status: UserProgress['status'] = 'needs-attention';
      if (progressPercentage >= 100) status = 'achieved';
      else if (progressPercentage >= 75) status = 'on-track';
      else if (progressPercentage >= 50) status = 'behind';

      return {
        id: username,
        name: username,
        region: Array.from(data.counties).slice(0, 3).join(', ') + (data.counties.size > 3 ? '...' : ''),
        farmersRegistered: data.count,
        target: target,
        progressPercentage,
        status
      };
    }).sort((a, b) => b.farmersRegistered - a.farmersRegistered);
  }, [filteredData, activeTarget]);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="ml-2 text-gray-600">Loading analytics data...</p>
      </div>
    );
  }

  if (!loading && allFarmers.length === 0) {
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
                
                 {availablePrograms.length > 0 && (
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
              <Beef className="h-5 w-5 text-orange-600" />
              Animal Census (Goats vs Sheep)
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
