import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewAllProgrammes } from "@/contexts/authhelper";
import { getAuth } from "firebase/auth";
import { ref, onValue, query, orderByChild, equalTo, off } from "firebase/database";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Label as RechartsLabel
} from "recharts";
import { 
  Beef, TrendingUp, Award, Star, 
  MapPin, DollarSign, Package, Users, Loader2, Calendar, Filter, Zap, ChevronDown, Calculator
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"; 
import { useToast } from "@/hooks/use-toast";
import { millify} from "millify";

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
  gray: "#9ca3af",
  lightBlue: "#eff6ff"
};

const BAR_COLORS = [
  COLORS.darkBlue, COLORS.orange, COLORS.yellow, COLORS.green, 
  COLORS.purple, COLORS.teal, COLORS.maroon, COLORS.red, COLORS.gray, COLORS.darkBlue
];

const SALES_INPUTS_STORAGE_KEY = "sales-metrics-inputs-v1";

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

interface SalesInputs {
  pricePerKg: number;
  expenses: number;
}

// --- Optimized Data Cache Manager ---
class DataCache {
  private cache = new Map<string, { data: OfftakeData[], timestamp: number }>();
  private maxAge = 5 * 60 * 1000; // 5 minutes cache validity

  get(key: string): OfftakeData[] | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  set(key: string, data: OfftakeData[]) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.cache.clear();
  }
}

const dataCache = new DataCache();

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date?.toDate && typeof date.toDate === 'function') return date.toDate(); 
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      const parsedISO = new Date(date);
      if (!isNaN(parsedISO.getTime())) return parsedISO;
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

const getCurrentWeekDates = () => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  return { startDate: formatDateToLocal(startOfWeek), endDate: formatDateToLocal(endOfWeek) };
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: formatDateToLocal(startOfMonth), endDate: formatDateToLocal(endOfMonth) };
};

const getQDates = (year: number, quarter: 1 | 2 | 3 | 4) => {
  const start = `${year}-${(quarter - 1) * 3 + 1}-01`;
  let endMonth = quarter * 3;
  let endYear = year;
  if (endMonth > 12) { endMonth = 12; }
  const endDay = new Date(endYear, endMonth, 0).getDate();
  return { startDate: start, endDate: `${endYear}-${String(endMonth).padStart(2,'0')}-${endDay}` };
};

// --- Custom Hook for Offtake Data Processing ---
const useOfftakeData = (
  offtakeData: OfftakeData[], 
  dateRange: { startDate: string; endDate: string },
  selectedProgramme: string | null,
  salesInputs: SalesInputs
) => {
  return useMemo(() => {
    if (offtakeData.length === 0) {
      return {
        filteredData: [],
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
          pricePerKg: salesInputs.pricePerKg,
          expenses: salesInputs.expenses,
          netProfit: -salesInputs.expenses,
          avgCostPerKgCarcass: 0
        },
        genderData: [],
        countyData: [],
        topLocations: [],
        topFarmers: [],
        monthlyTrend: [],
        top3Months: [] 
      };
    }

    const filteredData = offtakeData.filter(record => {
      return isDateInRange(record.date, dateRange.startDate, dateRange.endDate) &&
             (selectedProgramme ? record.programme === selectedProgramme : true);
    });

    let totalPurchaseCost = 0;
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
    const farmerSales: Record<string, { name: string; revenue: number; animals: number; county: string }> = {};
    const monthlyData: Record<string, { monthName: string; revenue: number; volume: number; monthIndex: number }> = {};

    for (const record of filteredData) {
      const txCost = Number(record.totalPrice) || 0;
      totalPurchaseCost += txCost;

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

      const allAnimals = [...goatsArr, ...sheepArr, ...cattleArr];
      let txCarcassWeight = 0;
      for(const animal of allAnimals) {
        totalLiveWeight += Number(animal.live) || 0;
        const carcass = Number(animal.carcass) || 0;
        totalCarcassWeight += carcass;
        txCarcassWeight += carcass;
      }
      const txRevenue = txCarcassWeight * salesInputs.pricePerKg;
      totalRevenue += txRevenue;

      if (record.gender) {
        const g = record.gender.charAt(0).toUpperCase() + record.gender.slice(1).toLowerCase();
        if (genderCounts[g] !== undefined) genderCounts[g]++;
      }

      const county = record.county || "Unknown";
      countySales[county] = (countySales[county] || 0) + txGoats;

      const loc = record.location || "Unknown";
      locationSales[loc] = (locationSales[loc] || 0) + (txGoats + txSheep + txCattle);

      const fName = record.farmerName || "Unknown";
      if (!farmerSales[fName]) {
        farmerSales[fName] = { name: fName, revenue: 0, animals: 0, county: county };
      } else {
        if (county !== "Unknown") {
             farmerSales[fName].county = county;
        }
      }
      farmerSales[fName].revenue += txRevenue;
      farmerSales[fName].animals += (txGoats + txSheep + txCattle);

      const d = parseDate(record.date);
      if (d) {
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthName = d.toLocaleString('default', { month: 'short' });
        
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { 
            monthName: monthName, 
            revenue: 0, 
            volume: 0,
            monthIndex: d.getMonth()
          };
        }
        monthlyData[monthKey].revenue += txRevenue;
        monthlyData[monthKey].volume += (txGoats + txSheep + txCattle);
      }
    }

    const costPerGoat = totalGoats > 0 ? totalPurchaseCost / totalGoats : 0;
    const avgLiveWeight = totalAnimalsCount > 0 ? totalLiveWeight / totalAnimalsCount : 0;
    const avgCarcassWeight = totalAnimalsCount > 0 ? totalCarcassWeight / totalAnimalsCount : 0;
    const netProfit = totalRevenue - totalPurchaseCost - salesInputs.expenses;
    const avgCostPerKgCarcass = totalCarcassWeight > 0 ? totalPurchaseCost / totalCarcassWeight : 0;

    const genderData = [
      { name: 'Male', value: genderCounts.Male },
      { name: 'Female', value: genderCounts.Female }
    ].filter(d => d.value > 0);

    const countyData = Object.entries(countySales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const topLocationsData = Object.entries(locationSales)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topFarmersList = Object.values(farmerSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const ALL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    const monthlyTrendData = ALL_MONTHS.map(monthName => {
      const existingData = Object.values(monthlyData).find(d => d.monthName === monthName);
      return {
        month: monthName,
        revenue: existingData ? existingData.revenue : 0,
        volume: existingData ? existingData.volume : 0
      };
    });

    const top3Months = Object.values(monthlyData)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
      .map(m => ({
        month: m.monthName,
        revenue: m.revenue,
        volume: m.volume
      }));

    return {
      filteredData,
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
        pricePerKg: salesInputs.pricePerKg,
        expenses: salesInputs.expenses,
        netProfit,
        avgCostPerKgCarcass
      },
      genderData,
      countyData,
      topLocations: topLocationsData,
      topFarmers: topFarmersList,
      monthlyTrend: monthlyTrendData,
      top3Months
    };
  }, [offtakeData, dateRange, selectedProgramme, salesInputs.expenses, salesInputs.pricePerKg]);
};

// --- Sub Components ---

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subText?: string;
  color?: 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'purple' | 'teal';
  trend?: 'up' | 'down' | 'neutral';
}

const StatsCard = ({ title, value, icon: Icon, subText, color = "blue", trend = "neutral" }: StatsCardProps) => {
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
    <Card className="group hover:shadow-lg transition-all duration-300 border-0 shadow-sm bg-gradient-to-br from-white to-gray-50/50 rounded-2xl overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${theme.border} transition-all group-hover:w-2`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 pt-5 pl-6 pr-4">
        <CardTitle className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</CardTitle>
        <div className={`p-2.5 rounded-xl ${theme.bg} shadow-sm group-hover:scale-105 transition-transform`}>
          <Icon className={`h-5 w-5 ${theme.text}`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-5 pr-4">
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-bold text-gray-900 tracking-tight">{value}</div>
          {trend !== 'neutral' && (
            <span className={`text-xs font-bold ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
              {trend === 'up' ? '↑' : '↓'}
            </span>
          )}
        </div>
        {subText && (
          <p className="text-xs text-gray-500 mt-2 font-medium leading-relaxed line-clamp-2">{subText}</p>
        )}
      </CardContent>
    </Card>
  );
};

const renderCenterLabel = ({ viewBox }: any) => {
  const { cx, cy } = viewBox;
  return (
    <text x={cx} y={cy} fill="#374151" textAnchor="middle" dominantBaseline="middle" className="text-sm font-bold fill-gray-700">
      Farmers
    </text>
  );
};

// --- Main Component ---

const salesReport = () => {
  const { userRole, userAttribute } = useAuth();
  const { toast } = useToast();
  const auth = getAuth();
  const currentMonthDates = useMemo(() => getCurrentMonthDates(), []);
  
  const [loading, setLoading] = useState(true);
  const [offtakeData, setOfftakeData] = useState<OfftakeData[]>([]);
  const [isCacheHit, setIsCacheHit] = useState(false);
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  
  const [dateRange, setDateRange] = useState({
    startDate: currentMonthDates.startDate,
    endDate: currentMonthDates.endDate,
  });
  const [selectedProgramme, setSelectedProgramme] = useState<string | null>(null);
  
  const availableYears = useMemo(() => {
    const years: string[] = [];
    for(let i = 0; i < 5; i++) years.push(String(currentYear - i));
    return years;
  }, [currentYear]);

  const [allowedProgrammes, setAllowedProgrammes] = useState<string[]>([]);
  const [userPermissionsLoading, setUserPermissionsLoading] = useState(true);
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const showProgrammeFilter = userCanViewAllProgrammeData;
  const [salesInputs, setSalesInputs] = useState<SalesInputs>({ pricePerKg: 0, expenses: 0 });
  const [isSalesInputsDialogOpen, setIsSalesInputsDialogOpen] = useState(false);
  const [salesInputsForm, setSalesInputsForm] = useState<{ pricePerKg: string; expenses: string }>({
    pricePerKg: "0",
    expenses: "0",
  });

  const { stats, genderData, countyData, topLocations, topFarmers, monthlyTrend, filteredData, top3Months } =
    useOfftakeData(offtakeData, dateRange, selectedProgramme, salesInputs);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      const storedInputs = localStorage.getItem(SALES_INPUTS_STORAGE_KEY);
      if (!storedInputs) return;
      const parsedInputs = JSON.parse(storedInputs) as Partial<SalesInputs>;
      const nextPrice = Number(parsedInputs.pricePerKg);
      const nextExpenses = Number(parsedInputs.expenses);

      setSalesInputs({
        pricePerKg: Number.isFinite(nextPrice) && nextPrice >= 0 ? nextPrice : 0,
        expenses: Number.isFinite(nextExpenses) && nextExpenses >= 0 ? nextExpenses : 0,
      });
    } catch (error) {
      console.error("Failed to load saved sales inputs:", error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SALES_INPUTS_STORAGE_KEY, JSON.stringify(salesInputs));
  }, [salesInputs]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setUserPermissionsLoading(false); return; }

    const userRef = ref(db, `users/${uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const programmesObj = data.allowedProgrammes || {};
        const programmesList = Object.keys(programmesObj).filter(key => programmesObj[key] === true);
        setAllowedProgrammes(programmesList);
        if (!userCanViewAllProgrammeData && programmesList.length > 0) {
           setActiveProgram(programmesList[0]);
        } else if (userCanViewAllProgrammeData && !activeProgram) {
          setActiveProgram("KPMD");
        }
      }
      setUserPermissionsLoading(false);
    }, (error) => {
      console.error("Error fetching user permissions:", error);
      setUserPermissionsLoading(false);
    });
    return () => unsubscribe();
  }, [auth.currentUser?.uid, userCanViewAllProgrammeData, activeProgram]);

  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (userPermissionsLoading || !activeProgram) { setLoading(false); return; }

    const cachedData = dataCache.get(activeProgram);
    if (cachedData) {
      setOfftakeData(cachedData);
      setLoading(false);
      setIsCacheHit(true);
    } else {
      setLoading(true);
      setIsCacheHit(false);
    }

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
        let dateValue = item.date; 
        if (typeof dateValue === 'number') dateValue = new Date(dateValue);
        else if (typeof dateValue === 'string') {
           const d = new Date(dateValue);
           if (!isNaN(d.getTime())) dateValue = d;
        }
        const goatsArr = Array.isArray(item.goats) ? item.goats : [];
        const sheepArr = Array.isArray(item.sheep) ? item.sheep : [];
        const cattleArr = Array.isArray(item.cattle) ? item.cattle : [];
        return {
          id: key, date: dateValue, farmerName: item.name || '', gender: item.gender || '',
          idNumber: item.idNumber || '', location: item.location || '', county: item.county || '',
          programme: item.programme || activeProgram, phone: item.phone || '', username: item.username || '',
          goats: goatsArr,
          sheep: sheepArr,
          cattle: cattleArr,
          totalGoats: Number(item.totalGoats) || goatsArr.length,
          totalPrice: Number(item.totalPrice) || 0
        };
      });

      dataCache.set(activeProgram, offtakeList);
      
      setOfftakeData(offtakeList);
      setLoading(false);
      setIsCacheHit(false);
    }, (error) => {
      console.error("Error fetching offtake data:", error);
      toast({ title: "Error", description: "Failed to load offtake data.", variant: "destructive" });
      setLoading(false);
    });

    unsubscribeRef.current = unsubscribe;
    return () => { if(unsubscribe) unsubscribe(); };
  }, [activeProgram, userPermissionsLoading, toast]);

  const handleDateRangeChange = useCallback((key: string, value: string) => setDateRange(prev => ({ ...prev, [key]: value })), []);

  const handleYearChange = useCallback((year: string) => {
    const yearNum = parseInt(year, 10);
    setSelectedYear(year);
    setDateRange({ startDate: `${yearNum}-01-01`, endDate: `${yearNum}-12-31` });
    setTimeFrame('yearly'); 
  }, []);

  const setWeekFilter = useCallback(() => { const dates = getCurrentWeekDates(); setDateRange(dates); setTimeFrame('weekly'); }, []);
  const setMonthFilter = useCallback(() => { const dates = getCurrentMonthDates(); setDateRange(dates); setTimeFrame('monthly'); }, []);
  
  const setQFilter = useCallback((q: 1|2|3|4) => {
    setDateRange(getQDates(parseInt(selectedYear, 10), q)); 
    setTimeFrame('monthly'); 
  }, [selectedYear]);

  // Updated to reset to Current Year instead of Current Month
  const clearFilters = useCallback(() => {
    const resetYear = String(new Date().getFullYear());

    setSelectedYear(resetYear);
    setDateRange({ 
      startDate: `${resetYear}-01-01`, 
      endDate: `${resetYear}-12-31` 
    });
    setTimeFrame('yearly'); // Set timeframe to yearly
    
    // Keep the programme selected, just sync the filter state
    if (activeProgram) {
      setSelectedProgramme(activeProgram);
    }
  }, [activeProgram]);

  const formatCurrency = (val: number) => `KES ${val.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  const openSalesInputsDialog = () => {
    setSalesInputsForm({
      pricePerKg: salesInputs.pricePerKg.toString(),
      expenses: salesInputs.expenses.toString(),
    });
    setIsSalesInputsDialogOpen(true);
  };

  const saveSalesInputs = () => {
    const isUpdate = salesInputs.pricePerKg > 0 || salesInputs.expenses > 0;
    const parsedPricePerKg = Math.max(0, Number(salesInputsForm.pricePerKg) || 0);
    const parsedExpenses = Math.max(0, Number(salesInputsForm.expenses) || 0);

    setSalesInputs({
      pricePerKg: parsedPricePerKg,
      expenses: parsedExpenses,
    });
    setIsSalesInputsDialogOpen(false);
    toast({
      title: isUpdate ? "Inputs Updated" : "Inputs Added",
      description: "Revenue and expenses saved. Revenue uses carcass weight only.",
    });
  };
  const handleProgramChange = (program: string) => { setActiveProgram(program); setSelectedProgramme(program); };

  const goatPct = stats.totalAnimals > 0 ? ((stats.totalGoats / stats.totalAnimals) * 100).toFixed(1) : 0;
  const sheepPct = stats.totalAnimals > 0 ? ((stats.totalSheep / stats.totalAnimals) * 100).toFixed(1) : 0;
  const hasConfiguredSalesInputs = salesInputs.pricePerKg > 0 || salesInputs.expenses > 0;

  if (loading || userPermissionsLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-600 font-medium animate-pulse">Loading dashboard data...</p>
        {isCacheHit && <p className="text-xs text-blue-500">Using cached data...</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/80 p-4 md:p-6 lg:p-8 pb-20">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-xl font-bold text-gray-900 tracking-tight">Offtake Dashboard</h1>
              <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                Viewing Data: <span className="font-semibold text-blue-700">{activeProgram || "All Programmes"}</span>
                {isCacheHit && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200">Cached</span>}
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full md:w-auto" onClick={openSalesInputsDialog}>
              <Calculator className="h-4 w-4 mr-2" />
              {hasConfiguredSalesInputs ? "Update Revenue Inputs" : "Add Revenue Inputs"}
            </Button>
          </div>

          {/* Modern Responsive Filter Control Panel */}
          <div className="w-full lg:w-auto border-0 shadow-lg bg-white p-2"> 
            <div className="flex flex-col lg:flex-row gap-2 items-center ">
              
              
             
                <Select value={selectedYear} onValueChange={handleYearChange}>
                  <SelectTrigger className="h-10 w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 bg-gray-50/50">
                    <Calendar className="h-4 w-4 text-gray-500 mr-2" />
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                     {availableYears.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}
                  </SelectContent>
                </Select>
             

          
              {showProgrammeFilter && (
                <div className="sm:col-span-1 xl:col-span-2 space-y-1.5">
                  <Select value={activeProgram} onValueChange={handleProgramChange}>
                    <SelectTrigger className="h-10 w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 bg-gray-50/50">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KPMD">KPMD</SelectItem>
                      <SelectItem value="RANGE">RANGE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

            
              
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="h-10 w-full min-w-0 text-sm rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 bg-gray-50/50 pr-2"
                  />
                
                  
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="h-10 w-full min-w-0 text-sm rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500 bg-gray-50/50 pr-2"
                  />
                  <Button variant="outline" onClick={setWeekFilter} size="sm" className="rounded-lg text-xs h-9 px-3">Week</Button>
                  <Button variant="outline" onClick={setMonthFilter} size="sm" className="rounded-lg text-xs h-9 px-3">Month</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="rounded-lg text-xs h-9 px-3 gap-1">
                        Quarters <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setQFilter(1)}>Q1 (Jan-Mar)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQFilter(2)}>Q2 (Apr-Jun)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQFilter(3)}>Q3 (Jul-Sep)</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setQFilter(4)}>Q4 (Oct-Dec)</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>                  
                  
                  {/* Added type="button" to prevent form submission issues */}
                  <Button 
                    type="button"
                    onClick={clearFilters} 
                    variant="ghost" 
                    size="sm" 
                    className="rounded-lg text-xs h-9 px-3 text-red-500 hover:bg-red-50 hover:text-red-600"
                  >
                    Reset
                  </Button>
                
            
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
            <p><span className="font-semibold">Price/Kg:</span> {formatCurrency(stats.pricePerKg)} (carcass)</p>
            <p><span className="font-semibold">Carcass Weight:</span> {millify(stats.totalCarcassWeight)} kg</p>
            <p><span className="font-semibold">Expenses:</span> {formatCurrency(stats.expenses)}</p>
          </div>
        </div>

        {/* --- SECTION 1: PURCHASES --- */}
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
             <Beef className="h-5 w-5 text-blue-600" />
             <h2 className="text-lg font-bold text-gray-800">Purchases Overview</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <StatsCard 
              title="Total Animals" 
              value={millify(stats.totalAnimals)} 
              icon={Package} 
              subText={`Goats: ${stats.totalGoats} (${goatPct}%) • Sheep: ${stats.totalSheep} (${sheepPct}%)`} 
              color="blue" 
            />
            <StatsCard 
              title="Total COST" 
              value={millify(stats.totalPurchaseCost)} 
              icon={DollarSign} 
              subText={`Cost/Goat: ${formatCurrency(stats.costPerGoat)} • Avg/Kg: ${formatCurrency(stats.avgCostPerKgCarcass)}`} 
              color="green" 
            />
            <StatsCard 
              title="Live Weight" 
              value={`${millify(stats.totalLiveWeight)} kg`} 
              icon={TrendingUp} 
              subText={`Avg: ${stats.avgLiveWeight.toFixed(1)}kg`} 
              color="purple" 
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Doughnut */}
            <Card className="border-0 shadow-sm bg-white rounded-2xl">
              <CardHeader className="pb-4 pt-6 px-6">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                  <Users className="h-4 w-4 text-orange-500" />
                  Farmers Demographics
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="h-[280px] w-full relative flex justify-center items-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={genderData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                        <Cell fill={COLORS.darkBlue} name="Male" />
                        <Cell fill={COLORS.orange} name="Female" />
                        <RechartsLabel content={renderCenterLabel} position="center" />
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value: string) => <span className="text-xs text-gray-600 font-medium capitalize">{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-3">
                     <span className="text-2xl font-bold text-gray-800">{filteredData.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Top 3 Months - New Feature */}
            <Card className="border-0 shadow-sm bg-white rounded-2xl flex flex-col">
              <CardHeader className="pb-4 pt-6 px-6">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Top Performing Months
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 px-6 pb-6 flex flex-col justify-center">
                {top3Months.length > 0 ? (
                  <div className="space-y-4">
                    {top3Months.map((m, index) => (
                      <div key={index} className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-yellow-50/50 to-white border border-yellow-100 hover:shadow-md transition-all">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shadow-sm ${
                            index === 0 ? 'bg-yellow-400 text-white' : 
                            index === 1 ? 'bg-gray-300 text-white' : 
                            'bg-orange-300 text-white'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-800">{m.month}</p>
                            <p className="text-[11px] text-gray-500">{m.volume} animals sold</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-green-700">{formatCurrency(m.revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8 text-sm">No performance data available for selected range</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Horizontal Bar */}
            <Card className="border-0 shadow-sm bg-white rounded-2xl">
              <CardHeader className="pb-4 pt-6 px-6">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                  <MapPin className="h-4 w-4 text-teal-500" />
                  Goats by County
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={countyData} layout="vertical" margin={{ top: 5, right: 20, left: 70, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#334155' }} width={65} />
                      <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.teal}>
                        {countyData.map((entry, index) => <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Top Farmers - Added County */}
            <Card className="border-0 shadow-sm bg-white rounded-2xl flex flex-col">
              <CardHeader className="pb-4 pt-6 px-6">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                  <Award className="h-4 w-4 text-purple-500" />
                  Top Offtake Beneficiaries
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 px-6 pb-6">
                <div className="space-y-3 h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                  {topFarmers.length > 0 ? topFarmers.map((farmer, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-gray-50/80 border border-gray-100 hover:bg-blue-50 hover:border-blue-100 transition-all duration-200">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 text-blue-700 font-bold text-xs shadow-sm">
                          {idx + 1}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">{farmer.name}</p>
                          <p className="text-[11px] text-gray-500 flex items-center gap-1">
                             <MapPin className="h-3 w-3" />
                             {farmer.county} • {farmer.animals} animals
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-700">{formatCurrency(farmer.revenue)}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">No farmer data available</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* --- SECTION 2: FINANCIALS & TREND --- */}
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-200">
             <DollarSign className="h-5 w-5 text-green-600" />
             <h2 className="text-lg font-bold text-gray-800">Financial and Expenses Tracks </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatsCard
              title="Purchase Cost"
              value={millify(stats.totalPurchaseCost)}
              icon={DollarSign}
              subText="Total buying cost from offtake records"
              color="green"
            />
            <StatsCard
              title="Total Revenue"
              value={millify(stats.totalRevenue)}
              icon={TrendingUp}
              subText={`Carcass ${millify(stats.totalCarcassWeight)}kg x ${formatCurrency(stats.pricePerKg)}/kg`}
              color="teal"
            />
            <StatsCard
              title="Total Expenses"
              value={millify(stats.expenses)}
              icon={DollarSign}
              subText="Additional operational expenses from dialog input"
              color="orange"
            />
            <StatsCard
              title="Net Profit"
              value={millify(stats.netProfit)}
              icon={Star}
              subText={stats.netProfit >= 0 ? "Revenue - Cost - Expenses (Positive)" : "Revenue - Cost - Expenses (Negative)"}
              color={stats.netProfit >= 0 ? "blue" : "red"}
            />
          </div>

          <Card className="border-0 shadow-sm bg-white rounded-2xl">
            <CardHeader className="pb-4 pt-6 px-6">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Monthly Offtake Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={monthlyTrend}>
                  <defs>
                    <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.darkBlue} stopOpacity={0.2}/>
                      <stop offset="95%" stopColor={COLORS.darkBlue} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number, name: string) => [
                      name === 'volume' ? `${value} Animals` : formatCurrency(value), 
                      name === 'volume' ? 'Volume' : 'Revenue'
                    ]} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="volume" 
                    stroke={COLORS.darkBlue} 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorTrend)" 
                    name="volume"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </section>

        <Dialog open={isSalesInputsDialogOpen} onOpenChange={setIsSalesInputsDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {hasConfiguredSalesInputs ? "Update Revenue and Expense Inputs" : "Add Revenue and Expense Inputs"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-xs text-slate-500">
                Use this dialog to add or update `Price per Kg` and `Total Expenses`.
              </p>
              <div className="space-y-2">
                <Label htmlFor="price-per-kg">Price per Kg (KES)</Label>
                <Input
                  id="price-per-kg"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesInputsForm.pricePerKg}
                  onChange={(e) => setSalesInputsForm((prev) => ({ ...prev, pricePerKg: e.target.value }))}
                />
                <p className="text-xs text-slate-500">Revenue is computed from carcass weight only.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total-expenses">Total Expenses (KES)</Label>
                <Input
                  id="total-expenses"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salesInputsForm.expenses}
                  onChange={(e) => setSalesInputsForm((prev) => ({ ...prev, expenses: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSalesInputsDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveSalesInputs}>
                {hasConfiguredSalesInputs ? "Update Inputs" : "Add Inputs"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default salesReport;
