import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isChiefAdmin } from "@/contexts/authhelper";
import { getAuth } from "firebase/auth";
import { ref, onValue, query, orderByChild, equalTo } from "firebase/database";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Label as RechartsLabel
} from "recharts";
import { 
  Beef, TrendingUp, Award, Star, 
  MapPin, DollarSign, Package, Users, Filter, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// --- Constants ---
const COLORS = {
  darkBlue: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b",
  green: "#16a34a",
  maroon: "#991b1b",
  purple: "#7c3aed",
  teal: "#0d9488",
  red: "#dc2626",
  gray: "#9ca3af"
};

const BAR_COLORS = [
  COLORS.darkBlue, COLORS.orange, COLORS.yellow, COLORS.green, 
  COLORS.purple, COLORS.teal, COLORS.maroon, COLORS.red, COLORS.gray, COLORS.darkBlue
];

// --- Types ---

interface OfftakeData {
  id: string;
  date: Date | string | number;
  farmerName: string;
  gender: string;
  idNumber: string;
  county?: string;
  location: string;
  programme?: string;
  goats?: Array<{ live: string; carcass: string; price: string }>;
  sheep?: Array<{ live: string; carcass: string; price: string }>;
  cattle?: Array<{ live: string; carcass: string; price: string }>;
  totalGoats?: number;
  totalPrice?: number;
  phone?: string;
  username?: string;
}

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date?.toDate && typeof date.toDate === 'function') return date.toDate(); 
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      // Handle "22 Jun 2025" format specifically if standard parse fails
      const parsedISO = new Date(date);
      if (!isNaN(parsedISO.getTime())) return parsedISO;
      
      // Fallback for specific formats if needed, though JS Date handles "22 Jun 2025" fine in modern browsers.
      // If you see invalid dates in console, check this specific string format.
    } 
    if (date?.seconds) return new Date(date.seconds * 1000);
  } catch (error) {
    console.error('Error parsing date:', error, date);
  }
  return null;
};

const formatDateToLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isDateInRange = (date: any, startDate: string, endDate: string): boolean => {
  if (!startDate && !endDate) return true;
  const parsedDate = parseDate(date);
  if (!parsedDate) return false;

  const dateOnly = new Date(parsedDate);
  dateOnly.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);

  if (start && dateOnly < start) return false;
  if (end && dateOnly > end) return false;
  return true;
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(endOfMonth)
  };
};

// --- Custom Hook for Offtake Data Processing ---
const useOfftakeData = (
  offtakeData: OfftakeData[], 
  dateRange: { startDate: string; endDate: string },
  selectedProgramme: string | null
) => {
  return useMemo(() => {
    if (offtakeData.length === 0) {
      return {
        filteredData: [],
        stats: {
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
          expenses: 0, 
          netProfit: 0
        },
        genderData: [],
        countyData: [],
        topLocations: [],
        topFarmers: [],
        monthlyTrend: []
      };
    }

    // Filter Data
    const filteredData = offtakeData.filter(record => {
      const inDate = isDateInRange(record.date, dateRange.startDate, dateRange.endDate);
      const inProgramme = selectedProgramme ? record.programme === selectedProgramme : true;
      return inDate && inProgramme;
    });

    // --- Basic Stats Calculation ---
    
    let totalRevenue = 0;
    let totalGoats = 0;
    let totalSheep = 0;
    let totalCattle = 0;
    let totalLiveWeight = 0;
    let totalCarcassWeight = 0;
    let totalAnimalsCount = 0;

    const genderCounts: Record<string, number> = { Male: 0, Female: 0 };
    const countySales: Record<string, number> = {};
    const locationSales: Record<string, number> = {};
    const farmerSales: Record<string, { name: string; revenue: number; animals: number }> = {};
    
    // For Trend (Monthly)
    const monthlyData: Record<string, { month: string; revenue: number; volume: number }> = {};

    filteredData.forEach(record => {
      // Revenue - Handle case differences
      const txRevenue = Number(record.totalPrice || (record as any).totalprice) || 0;
      totalRevenue += txRevenue;

      // Animals Count & Weights
      const goatsArr = record.goats || [];
      const sheepArr = record.sheep || [];
      const cattleArr = record.cattle || [];
      
      const txGoats = Number(record.totalGoats) || goatsArr.length;
      const txSheep = sheepArr.length;
      const txCattle = cattleArr.length;
      
      totalGoats += txGoats;
      totalSheep += txSheep;
      totalCattle += txCattle;
      totalAnimalsCount += (txGoats + txSheep + txCattle);

      // Weights
      [...goatsArr, ...sheepArr, ...cattleArr].forEach(animal => {
        totalLiveWeight += Number(animal.live) || 0;
        totalCarcassWeight += Number(animal.carcass) || 0;
      });

      // Gender
      if (record.gender) {
        const g = record.gender.charAt(0).toUpperCase() + record.gender.slice(1).toLowerCase();
        if (genderCounts[g] !== undefined) genderCounts[g]++;
      }

      // County
      const county = record.county || "Unknown";
      countySales[county] = (countySales[county] || 0) + txGoats;

      // Location
      const loc = record.location || "Unknown";
      locationSales[loc] = (locationSales[loc] || 0) + (txGoats + txSheep + txCattle);

      // Farmers
      const fName = record.farmerName || "Unknown";
      if (!farmerSales[fName]) {
        farmerSales[fName] = { name: fName, revenue: 0, animals: 0 };
      }
      farmerSales[fName].revenue += txRevenue;
      farmerSales[fName].animals += (txGoats + txSheep + txCattle);

      // Monthly Trend
      const d = parseDate(record.date);
      if (d) {
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { month: d.toLocaleString('default', { month: 'short' }), revenue: 0, volume: 0 };
        }
        monthlyData[monthKey].revenue += txRevenue;
        monthlyData[monthKey].volume += (txGoats + txSheep + txCattle);
      }
    });

    // Derived Stats
    const costPerGoat = totalGoats > 0 ? totalRevenue / totalGoats : 0;
    const avgLiveWeight = totalAnimalsCount > 0 ? totalLiveWeight / totalAnimalsCount : 0;
    const avgCarcassWeight = totalAnimalsCount > 0 ? totalCarcassWeight / totalAnimalsCount : 0;
    
    // Financials (Expenses mocked as 0 since data missing)
    const expenses = 0; 
    const netProfit = totalRevenue - expenses;

    // --- Data Formatting for Charts ---

    // Gender Doughnut
    const genderData = [
      { name: 'Male', value: genderCounts.Male },
      { name: 'Female', value: genderCounts.Female }
    ].filter(d => d.value > 0);

    // County Bar (Horizontal)
    const countyData = Object.entries(countySales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Top Locations (Vertical, Top 10)
    const topLocationsData = Object.entries(locationSales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top Farmers List
    const topFarmersList = Object.values(farmerSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Monthly Trend (Sorted by date)
    const monthlyTrendData = Object.values(monthlyData)
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      filteredData,
      stats: {
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
        expenses,
        netProfit
      },
      genderData,
      countyData,
      topLocations: topLocationsData,
      topFarmers: topFarmersList,
      monthlyTrend: monthlyTrendData
    };
  }, [offtakeData, dateRange, selectedProgramme]);
};

// --- Sub Components ---

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subText?: string;
  color?: 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'purple' | 'teal';
}

const StatsCard = ({ title, value, icon: Icon, subText, color = "blue" }: StatsCardProps) => {
  const colorMap: Record<string, { border: string, bg: string, text: string }> = {
    blue: { border: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-600' },
    orange: { border: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-600' },
    yellow: { border: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-600' },
    green: { border: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-600' },
    red: { border: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-600' },
    purple: { border: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-600' },
    teal: { border: 'bg-teal-500', bg: 'bg-teal-50', text: 'text-teal-600' },
  };

  const theme = colorMap[color];

  return (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-white">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${theme.border}`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${theme.bg} shadow-sm`}>
          <Icon className={`h-4 w-4 ${theme.text}`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {subText && (
          <p className="text-xs text-gray-500 mt-2 font-medium">{subText}</p>
        )}
      </CardContent>
    </Card>
  );
};

const renderCenterLabel = ({ viewBox }: any) => {
  const { cx, cy } = viewBox;
  return (
    <text x={cx} y={cy} fill="#333" textAnchor="middle" dominantBaseline="middle" className="text-sm font-bold fill-gray-700">
      Total Farmers
    </text>
  );
};

// --- Main Component ---

const salesReport = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const auth = getAuth();
  
  const [loading, setLoading] = useState(true);
  const [offtakeData, setOfftakeData] = useState<OfftakeData[]>([]);
  
  // FIX: Initialize with empty strings to show ALL data initially. 
  // If you initialized with "Current Month", future dates (like your June 2025 data) would be hidden.
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);
  
  // User Permissions Logic
  const [allowedProgrammes, setAllowedProgrammes] = useState<string[]>([]);
  const [userPermissionsLoading, setUserPermissionsLoading] = useState(true);
  
  // Active Program Logic
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 

  // Determine visibility of Programme Filter
  const showProgrammeFilter = userIsChiefAdmin;

  const {
    stats,
    genderData,
    countyData,
    topLocations,
    topFarmers,
    monthlyTrend,
    filteredData
  } = useOfftakeData(offtakeData, dateRange, selectedProgramme);

  // --- Fetch User Permissions ---
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUserPermissionsLoading(false);
      return;
    }

    const userRef = ref(db, `users/${uid}`);
    
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const programmesObj = data.allowedProgrammes || {};
        // Extract keys where value is true
        const programmesList = Object.keys(programmesObj).filter(key => programmesObj[key] === true);
        
        setAllowedProgrammes(programmesList);

        if (!userIsChiefAdmin) {
          if (programmesList.length > 0) {
             setActiveProgram(programmesList[0]);
          } else {
            console.warn("User has no allowed programmes assigned.");
            // Only show toast if explicitly needed, otherwise just warn
            // toast({ title: "Access Restricted", description: "No programmes assigned.", variant: "destructive" });
          }
        } else {
          // Admin: Default to KPMD
          if (!activeProgram) setActiveProgram("KPMD");
        }
      }
      setUserPermissionsLoading(false);
    }, (error) => {
      console.error("Error fetching user permissions:", error);
      setUserPermissionsLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid, userIsChiefAdmin]);

  // --- Fetch Offtake Data ---
  useEffect(() => {
    // Wait for permissions to load and for an active program to be selected
    if (userPermissionsLoading) return;
    if (!activeProgram) {
        // If no active program (e.g. user with no permissions), don't fetch
        setLoading(false);
        return;
    }

    setLoading(true);
    
    // Query based on active programme
    const dbRef = query(ref(db, 'offtakes'), orderByChild('programme'), equalTo(activeProgram));

    const unsubscribe = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        setOfftakeData([]);
        setLoading(false);
        return;
      }

      const offtakeList = Object.keys(data).map((key) => {
        const item = data[key];
        
        // Date Handling - Supports "22 Jun 2025"
        let dateValue = item.date; 
        if (typeof dateValue === 'number') dateValue = new Date(dateValue);
        // String check
        else if (typeof dateValue === 'string') {
           const d = new Date(dateValue);
           if (!isNaN(d.getTime())) dateValue = d;
        }

        const goatsArr = item.goats || [];
        
        return {
          id: key,
          date: dateValue,
          farmerName: item.name || '', 
          gender: item.gender || '',
          idNumber: item.idNumber || '',
          location: item.location || '',
          county: item.county || '',
          programme: item.programme || activeProgram, 
          phone: item.phone || '',
          username: item.username || '',
          
          goats: goatsArr, 
          totalGoats: item.totalGoats || goatsArr.length,
          totalPrice: item.totalPrice || 0
        };
      });

      setOfftakeData(offtakeList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching offtake data:", error);
      toast({
        title: "Error",
        description: "Failed to load offtake data. You might not have permission for this programme.",
        variant: "destructive",
      });
      setLoading(false);
    });

    return () => {
       if(typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeProgram, userPermissionsLoading, toast]);

  const handleDateRangeChange = useCallback((key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
  }, []);

  const formatCurrency = (val: number) => `KES ${val.toLocaleString()}`;

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setSelectedProgramme(program);
  };

  // Calculate Percentages for Animal Stats
  const goatPct = stats.totalAnimals > 0 ? ((stats.totalGoats / stats.totalAnimals) * 100).toFixed(1) : 0;
  const sheepPct = stats.totalAnimals > 0 ? ((stats.totalSheep / stats.totalAnimals) * 100).toFixed(1) : 0;
  const cattlePct = stats.totalAnimals > 0 ? ((stats.totalCattle / stats.totalAnimals) * 100).toFixed(1) : 0;

  if (loading || userPermissionsLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-600 font-medium animate-pulse">Loading dashboard data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1 bg-gray-50/50 min-h-screen pb-10">
      
      {/* Header and Filters */}
      <div className="flex flex-col justify-between items-start gap-4">
        <div>
            <h1 className="text-[20px] font-medium text-gray-900 tracking-tight">Offtake Performance Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
               Viewing data for: <span className="font-semibold text-blue-600">{activeProgram}</span>
            </p>
        </div>

        <Card className="w-full lg:w-auto border-0 shadow-lg bg-white">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
              </div>

              {showProgrammeFilter && (
                <div className="w-full lg:w-48 space-y-2">
                 
                  <Select value={activeProgram} onValueChange={handleProgramChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Programme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KPMD">KPMD</SelectItem>
                      <SelectItem value="RANGE">RANGE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <Button 
                onClick={() => setDateRange({ startDate: "", endDate: "" })} 
                variant="outline" 
                className="text-xs h-10"
              >
                Show All Dates
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- SECTION 1: PURCHASES --- */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2">
           <Beef className="h-5 w-5 text-blue-600" />
           <h2 className="text-lg font-bold text-gray-800">Purchases Overview</h2>
        </div>

        {/* Stats Cards Row */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard 
            title="Total Animals Purchased" 
            value={stats.totalAnimals.toLocaleString()} 
            icon={Package}
            subText={`Goats: ${stats.totalGoats} (${goatPct}%) • Sheep: ${stats.totalSheep} (${sheepPct}%) • Cattle: ${stats.totalCattle} (${cattlePct}%)`}
            color="blue"
          />

          <StatsCard 
            title="Total Revenue" 
            value={formatCurrency(stats.totalRevenue)} 
            icon={DollarSign}
            subText={`Cost per Goat: ${formatCurrency(stats.costPerGoat)}`}
            color="green"
          />

          <StatsCard 
            title="Total Live Weight" 
            value={`${stats.totalLiveWeight.toLocaleString()} kg`} 
            icon={TrendingUp}
            subText={`Avg Live: ${stats.avgLiveWeight.toFixed(1)}kg • Avg Carcass: ${stats.avgCarcassWeight.toFixed(1)}kg`}
            color="purple"
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Doughnut: Gender Split */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <Users className="h-5 w-5 text-orange-600" />
                Farmers Demographics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full relative flex justify-center items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      <Cell fill={COLORS.darkBlue} name="Male" />
                      <Cell fill={COLORS.orange} name="Female" />
                      <RechartsLabel content={renderCenterLabel} position="center" />
                    </Pie>
                    <Tooltip />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36}
                      formatter={(value: string) => <span className="text-xs text-gray-600 font-medium capitalize">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Overlay Total Count */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-4">
                   <span className="text-2xl font-bold text-gray-800">{filteredData.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Horizontal Bar: Goats per County */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <MapPin className="h-5 w-5 text-teal-600" />
                Goats Purchased per County
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={countyData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={75} />
                    <Tooltip cursor={{fill: '#f3f4f6'}} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.teal}>
                      {countyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Vertical Bar: Top 10 Locations */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <MapPin className="h-5 w-5 text-purple-600" />
                Top 10 Locations by Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topLocations} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 10, fill: '#6b7280' }} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <Tooltip cursor={{fill: '#f3f4f6'}} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill={COLORS.darkBlue} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* List: Top Farmers */}
          <Card className="border-0 shadow-lg bg-white flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <Award className="h-5 w-5 text-yellow-600" />
                Top Farmers
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="space-y-3 h-[300px] overflow-y-auto pr-2">
                {topFarmers.length > 0 ? topFarmers.map((farmer, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{farmer.name}</p>
                        <p className="text-xs text-gray-500">{farmer.animals} animals</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-700">{formatCurrency(farmer.revenue)}</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-center text-sm text-gray-400 mt-10">No farmer data available</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* --- SECTION 2: FINANCIALS & TREND --- */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b pb-2">
           <DollarSign className="h-5 w-5 text-green-600" />
           <h2 className="text-lg font-bold text-gray-800">Financials & Trends</h2>
        </div>

        {/* Financial Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard 
            title="Total Revenue" 
            value={formatCurrency(stats.totalRevenue)} 
            icon={DollarSign}
            color="green"
          />

          <StatsCard 
            title="Total Expenses" 
            value={formatCurrency(stats.expenses)} 
            icon={TrendingUp}
            subText="Based on recorded operational costs"
            color="red"
          />

          <StatsCard 
            title="Net Profit" 
            value={formatCurrency(stats.netProfit)} 
            icon={Star}
            subText={stats.netProfit >= 0 ? "Positive Margin" : "Negative Margin"}
            color={stats.netProfit >= 0 ? "blue" : "red"}
          />
        </div>

        {/* Monthly Trend Curve */}
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Monthly Offtake Trend (Truck Volume)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.darkBlue} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS.darkBlue} stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip 
                  formatter={(value: number, name: string) => [
                    name === 'volume' ? `${value} Animals` : formatCurrency(value), 
                    name === 'volume' ? 'Volume' : 'Revenue'
                  ]} 
                />
                <Area 
                  type="monotone" 
                  dataKey="volume" 
                  stroke={COLORS.darkBlue} 
                  fillOpacity={1} 
                  fill="url(#colorTrend)" 
                  name="volume"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default salesReport;