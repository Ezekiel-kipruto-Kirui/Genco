import * as React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isChiefAdmin } from "@/contexts/authhelper";
import { getAuth } from "firebase/auth";
import { ref, onValue, get } from "firebase/database";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area
} from "recharts";
import { 
  Users, GraduationCap, Beef, TrendingUp, Award, 
  MapPin, Syringe, TargetIcon, Loader2, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// --- Constants ---
const COLORS = {
  darkBlue: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b",
  green: "#16a34a",
  maroon: "#991b1b",
  purple: "#7c3aed",
  teal: "#0d9488",
  red: "#dc2626"
};

const BAR_COLORS = [
  COLORS.darkBlue, COLORS.orange, COLORS.yellow, COLORS.green, 
  COLORS.purple, COLORS.teal, COLORS.maroon
];

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000; 

// --- Types ---
interface Farmer {
  id: string;
  name: string;
  gender: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  goats: { total?: number; female?: number; male?: number };
  sheep: string | number;
  cattle: string | number;
  vaccinated: boolean;
  vaccines: string[];
  createdAt: number | string;
  registrationDate: string;
  femaleBreeds: string | number;
  maleBreeds: string | number;
  ageDistribution?: any;
  aggregationGroup?: string;
  bucksServed?: string;
  farmerId?: string;
  traceability?: boolean;
  username?: string;
  programme?: string;
}

interface TrainingRecord {
  id: string;
  totalFarmers: number;
  county: string;
  subcounty: string;
  location: string;
  startDate: string;
  endDate: string;
  topicTrained: string;
  createdAt?: string | number;
  programme?: string;
  fieldOfficer?: string;
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
      const parsedCustom = new Date(date);
      if (!isNaN(parsedCustom.getTime())) return parsedCustom;
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

const getNumberField = (obj: any, ...fieldNames: string[]): number => {
  for (const fieldName of fieldNames) {
    const value = obj[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      const num = Number(value);
      return isNaN(num) ? 0 : num;
    }
  }
  return 0;
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
  return {
    startDate: formatDateToLocal(startOfWeek),
    endDate: formatDateToLocal(endOfWeek)
  };
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

const getQ1Dates = (year: number) => { 
  return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
};

const getQ2Dates = (year: number) => { 
  return { startDate: `${year}-01-01`, endDate: `${year}-06-30` };
};

const getQ3Dates = (year: number) => { 
  return { startDate: `${year}-01-01`, endDate: `${year}-09-30` };
};

const getQ4Dates = (year: number) => { 
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
};

// --- Custom Hook for Data Processing ---
const useProcessedData = (
  allFarmers: Farmer[], 
  trainingRecords: TrainingRecord[], 
  dateRange: { startDate: string; endDate: string }, 
  timeFrame: 'weekly' | 'monthly' | 'yearly',
  selectedProgramme: string | null,
  selectedYear: number 
) => {
  return useMemo(() => {
    if (allFarmers.length === 0 && trainingRecords.length === 0) {
      return {
        totalFarmers: 0,
        maleFarmers: 0,
        femaleFarmers: 0,
        malePercentage: 0,
        femalePercentage: 0,
        totalAnimals: 0,
        totalGoats: 0,
        totalSheep: 0,
        goatsPercentage: 0,
        sheepPercentage: 0,
        totalTrainedFarmers: 0,
        countyPerformanceData: [],
        registrationTrendData: [],
        topLocations: [],
        topCustomers: [],
        uniqueCounties: 0,
        totalBreedsDistributed: 0,
        breedsMale: 0,
        breedsFemale: 0,
        breedsMalePercentage: 0,
        breedsFemalePercentage: 0,
        vaccinationRate: 0,
        vaccinatedAnimals: 0,
        vaccinatedFarmersCount: 0,
        breedsByCountyData: [],
        breedsBySubcountyData: [],
        vaccinationByCountyData: [],
        vaccinationBySubcountyData: []
      };
    }

    // Filter Farmers by Date AND Programme
    const filteredFarmers = allFarmers.filter(farmer => {
      const dateToCheck = farmer.createdAt || farmer.registrationDate;
      const inDate = isDateInRange(dateToCheck, dateRange.startDate, dateRange.endDate);
      const inProgramme = !selectedProgramme || farmer.programme === selectedProgramme;
      return inDate && inProgramme;
    });

    // Filter Training by Date AND Programme
    const filteredTraining = trainingRecords.filter(record => {
      const dateToCheck = record.createdAt || record.startDate;
      const inDate = isDateInRange(dateToCheck, dateRange.startDate, dateRange.endDate);
      const inProgramme = !selectedProgramme || record.programme === selectedProgramme;
      return inDate && inProgramme;
    });

    // --- Calculations ---

    // 1. Farmer Stats
    const maleFarmers = filteredFarmers.filter(f => String(f.gender).toLowerCase() === 'male').length;
    const femaleFarmers = filteredFarmers.filter(f => String(f.gender).toLowerCase() === 'female').length;
    const totalF = maleFarmers + femaleFarmers;
    
    // 2. Animal Census
    let totalGoats = 0;
    let totalSheep = 0;
    let totalCattle = 0;
    let totalVaccinatedAnimals = 0;
    let vaccinatedFarmersCount = 0;

    filteredFarmers.forEach(f => {
      let currentGoats = 0;
      if (typeof f.goats === 'object' && f.goats !== null) {
        currentGoats = Number(f.goats.total) || 0;
      } else if (typeof f.goats === 'number') {
        currentGoats = f.goats;
      }
      const currentSheep = getNumberField(f, "sheep");
      const currentCattle = getNumberField(f, "cattle");
      const currentTotalAnimals = currentGoats + currentSheep + currentCattle;

      totalGoats += currentGoats;
      totalSheep += currentSheep;
      totalCattle += currentCattle;

      if (f.vaccinated === true) {
        totalVaccinatedAnimals += currentTotalAnimals;
        vaccinatedFarmersCount++;
      }
    });

    const totalAnimals = totalGoats + totalSheep + totalCattle;
    const goatsPerc = totalAnimals > 0 ? (totalGoats / totalAnimals) * 100 : 0;
    const sheepPerc = totalAnimals > 0 ? (totalSheep / totalAnimals) * 100 : 0;
    const vacRate = totalAnimals > 0 ? (totalVaccinatedAnimals / totalAnimals) * 100 : 0;

    // 3. Trained Farmers
    const totalTrained = filteredTraining.reduce((sum, record) => sum + (Number(record.totalFarmers) || 0), 0);

    // 4. Charts Preparation
    const countyMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      const c = f.county || 'Unknown';
      countyMap[c] = (countyMap[c] || 0) + 1;
    });
    const countyPerformanceData = Object.entries(countyMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const locationMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      const l = f.location || 'Unknown';
      locationMap[l] = (locationMap[l] || 0) + 1;
    });
    const topLocations = Object.entries(locationMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const topCustomers = filteredFarmers.map(f => {
      let g = 0, s = 0, c = 0;
      if (typeof f.goats === 'object') g = Number(f.goats.total) || 0;
      else if (typeof f.goats === 'number') g = f.goats;
      s = getNumberField(f, "sheep");
      c = getNumberField(f, "cattle");
      return { name: f.name || f.farmerId || f.id || 'Unknown', value: g + s + c };
    }).sort((a, b) => b.value - a.value).slice(0, 5);

    // Registration Trend
    const generateTrendData = () => {
      const trendData: any[] = [];
      
      if (timeFrame === 'weekly') {
        for (let i = 3; i >= 0; i--) {
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - (i * 7) - weekStart.getDay());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          
          const count = filteredFarmers.filter(farmer => {
            const d = parseDate(farmer.createdAt || farmer.registrationDate);
            return d && d >= weekStart && d <= weekEnd;
          }).length;
          trendData.push({ name: `Week ${4-i}`, registrations: count });
        }
      } else if (timeFrame === 'monthly') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.forEach((m, idx) => {
           const monthStart = new Date(selectedYear, idx, 1);
           const monthEnd = new Date(selectedYear, idx + 1, 0);
           const count = filteredFarmers.filter(farmer => {
             const d = parseDate(farmer.createdAt || farmer.registrationDate);
             return d && d >= monthStart && d <= monthEnd;
           }).length;
           trendData.push({ name: m, registrations: count });
        });
      } else {
        for (let y = selectedYear - 4; y <= selectedYear; y++) {
           const yearStart = new Date(y, 0, 1);
           const yearEnd = new Date(y, 11, 31);
           const count = filteredFarmers.filter(farmer => {
             const d = parseDate(farmer.createdAt || farmer.registrationDate);
             return d && d >= yearStart && d <= yearEnd;
           }).length;
           trendData.push({ name: y.toString(), registrations: count });
        }
      }
      return trendData;
    };

    // --- Animal Health Stats ---
    const uniqueCounties = new Set(filteredFarmers.map(f => f.county)).size;

    let bMale = 0;
    let bFemale = 0;
    filteredFarmers.forEach(f => {
      bMale += getNumberField(f, "maleBreeds");
      bFemale += getNumberField(f, "femaleBreeds");
    });
    const totalBreeds = bMale + bFemale;
    const bMalePerc = totalBreeds > 0 ? (bMale / totalBreeds) * 100 : 0;
    const bFemalePerc = totalBreeds > 0 ? (bFemale / totalBreeds) * 100 : 0;

    // Breeds per County
    const breedsByCountyMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      const c = f.county || 'Unknown';
      const sum = getNumberField(f, "maleBreeds") + getNumberField(f, "femaleBreeds");
      if (sum > 0) {
        breedsByCountyMap[c] = (breedsByCountyMap[c] || 0) + sum;
      }
    });
    const breedsByCountyData = Object.entries(breedsByCountyMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Breeds per Subcounty
    const breedsBySubMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      const sc = f.subcounty || 'Unknown';
      const sum = getNumberField(f, "maleBreeds") + getNumberField(f, "femaleBreeds");
      if (sum > 0) {
        breedsBySubMap[sc] = (breedsBySubMap[sc] || 0) + sum;
      }
    });
    const breedsBySubcountyData = Object.entries(breedsBySubMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Vaccination per County
    const vacByCountyMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      if (f.vaccinated) {
        const c = f.county || 'Unknown';
        let animalCount = 0;
        if (typeof f.goats === 'object') animalCount += Number(f.goats.total) || 0;
        else if (typeof f.goats === 'number') animalCount += f.goats;
        animalCount += getNumberField(f, "sheep");
        animalCount += getNumberField(f, "cattle");

        vacByCountyMap[c] = (vacByCountyMap[c] || 0) + animalCount;
      }
    });
    const vaccinationByCountyData = Object.entries(vacByCountyMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Vaccination per Subcounty
    const vacBySubMap: Record<string, number> = {};
    filteredFarmers.forEach(f => {
      if (f.vaccinated) {
        const sc = f.subcounty || 'Unknown';
        let animalCount = 0;
        if (typeof f.goats === 'object') animalCount += Number(f.goats.total) || 0;
        else if (typeof f.goats === 'number') animalCount += f.goats;
        animalCount += getNumberField(f, "sheep");
        animalCount += getNumberField(f, "cattle");

        vacBySubMap[sc] = (vacBySubMap[sc] || 0) + animalCount;
      }
    });
    const vaccinationBySubcountyData = Object.entries(vacBySubMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return {
      totalFarmers: totalF,
      maleFarmers,
      femaleFarmers,
      malePercentage: totalF > 0 ? ((maleFarmers / totalF) * 100).toFixed(1) : 0,
      femalePercentage: totalF > 0 ? ((femaleFarmers / totalF) * 100).toFixed(1) : 0,
      totalAnimals,
      totalGoats,
      totalSheep,
      goatsPercentage: goatsPerc.toFixed(1),
      sheepPercentage: sheepPerc.toFixed(1),
      totalTrainedFarmers: totalTrained,
      countyPerformanceData,
      registrationTrendData: generateTrendData(),
      topLocations,
      topCustomers,
      uniqueCounties,
      totalBreedsDistributed: totalBreeds,
      breedsMale: bMale,
      breedsFemale: bFemale,
      breedsMalePercentage: bMalePerc.toFixed(1),
      breedsFemalePercentage: bFemalePerc.toFixed(1),
      vaccinationRate: vacRate.toFixed(1),
      vaccinatedAnimals: totalVaccinatedAnimals,
      vaccinatedFarmersCount,
      breedsByCountyData,
      breedsBySubcountyData,
      vaccinationByCountyData,
      vaccinationBySubcountyData
    };
  }, [allFarmers, trainingRecords, dateRange, timeFrame, selectedProgramme, selectedYear]);
};

// --- Sub Components ---

interface StatsCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ElementType;
  color?: 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'purple' | 'teal';
}

const StatsCard = React.memo(({ title, value, subtext, icon: Icon, color = "blue" }: StatsCardProps) => {
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
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${theme.border}`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-xs font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${theme.bg} shadow-sm`}>
          <Icon className={`h-4 w-4 ${theme.text}`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-xl font-bold text-gray-900">{value}</div>
        {subtext && (
          <p className="text-[11px] text-gray-500 mt-2 font-medium leading-relaxed">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
});

const SectionHeader = React.memo(({ title }: { title: string }) => (
  <h2 className="text-lg font-medium text-gray-800 mb-2 flex items-center border-gray-100">
    {title}
  </h2>
));

// --- Main Component ---

const PerformanceReport = () => {
  const { userRole } = useAuth();
  const auth = getAuth();
  
  const cacheRef = useRef<{
    farmers: Farmer[] | null;
    training: TrainingRecord[] | null;
    timestamp: number;
  }>({ farmers: null, training: null, timestamp: 0 });
  
  const [loading, setLoading] = useState(true);
  const [userPermissionsLoading, setUserPermissionsLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  
  const availableYears = useMemo(() => {
    const years: string[] = [];
    for(let i = 0; i < 5; i++) {
      years.push(String(currentYear - i));
    }
    return years;
  }, [currentYear]);

  const [allowedProgrammes, setAllowedProgrammes] = useState<string[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const showProgrammeFilter = userIsChiefAdmin;
  
  const selectedYearNum = parseInt(selectedYear, 10);
  
  const data = useProcessedData(allFarmers, trainingRecords, dateRange, timeFrame, activeProgram || null, selectedYearNum);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const now = Date.now();
      let farmersList: Farmer[] = [];
      let trainingList: TrainingRecord[] = [];

      if (cacheRef.current.farmers && 
          cacheRef.current.training && 
          (now - cacheRef.current.timestamp < CACHE_DURATION)) {
        console.log("Using cached data");
        farmersList = cacheRef.current.farmers;
        trainingList = cacheRef.current.training;
      } else {
        console.log("Fetching new data");
        const farmersRef = ref(db, 'farmers');
        const farmersSnap = await get(farmersRef);

        if (farmersSnap.exists()) {
          farmersSnap.forEach((childSnapshot) => {
            const fData = childSnapshot.val();
            const id = childSnapshot.key || '';
            farmersList.push({
              id,
              ...fData,
              goats: fData.goats || { total: 0, male: 0, female: 0 },
              sheep: fData.sheep || 0,
              cattle: fData.cattle || 0,
              vaccinated: fData.vaccinated || false,
              vaccines: fData.vaccines || [],
              femaleBreeds: fData.femaleBreeds || 0,
              maleBreeds: fData.maleBreeds || 0,
              programme: fData.programme || undefined
            });
          });
        }

        const trainingRef = ref(db, 'capacityBuilding');
        const trainingSnap = await get(trainingRef);

        if (trainingSnap.exists()) {
          trainingSnap.forEach((childSnapshot) => {
            const tData = childSnapshot.val();
            trainingList.push({
              id: childSnapshot.key || '',
              ...tData,
              programme: tData.programme || undefined
            });
          });
        }

        cacheRef.current = {
          farmers: farmersList,
          training: trainingList,
          timestamp: now
        };
      }

      setAllFarmers(farmersList);
      setTrainingRecords(trainingList);
      
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialDates = { startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31` };
    setDateRange(initialDates);
    fetchAllData();
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUserPermissionsLoading(false);
      return;
    }

    const userRef = ref(db, `users/${uid}`);
    
    const unsubscribe = onValue(userRef, (snapshot) => {
      const uData = snapshot.val();
      if (uData) {
        const programmesObj = uData.allowedProgrammes || {};
        const programmesList = Object.keys(programmesObj).filter(key => programmesObj[key] === true);
        
        setAllowedProgrammes(programmesList);

        if (!userIsChiefAdmin) {
          if (programmesList.length > 0) {
             setActiveProgram(programmesList[0]);
          }
        } else {
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

  const handleDateRangeChange = useCallback((key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleYearChange = useCallback((year: string) => {
    const yearNum = parseInt(year, 10);
    setSelectedYear(year);
    setDateRange({ 
      startDate: `${yearNum}-01-01`, 
      endDate: `${yearNum}-12-31` 
    });
    setTimeFrame('yearly'); 
  }, []);

  // --- New Handler for Quarter Dropdown ---
  const handleQuarterChange = useCallback((value: string) => {
    const yearNum = parseInt(selectedYear, 10);
    if (value === 'q1') {
      setDateRange(getQ1Dates(yearNum));
      setTimeFrame('monthly');
    } else if (value === 'q2') {
      setDateRange(getQ2Dates(yearNum));
      setTimeFrame('monthly');
    } else if (value === 'q3') {
      setDateRange(getQ3Dates(yearNum));
      setTimeFrame('monthly');
    } else if (value === 'q4') {
      setDateRange(getQ4Dates(yearNum));
      setTimeFrame('yearly');
    }
  }, [selectedYear]);

  // --- Updated Clear Filters ---
  const clearFilters = useCallback(() => {
    // Reset Year to current year
    const currentY = String(new Date().getFullYear());
    setSelectedYear(currentY);
    
    // Reset Date Range to empty strings to show ALL data
    setDateRange({ startDate: "", endDate: "" });
    
    // Reset TimeFrame
    setTimeFrame('monthly');
    
    // Note: activeProgram is NOT reset as per requirements
  }, []);

  const setWeekFilter = useCallback(() => {
    const dates = getCurrentWeekDates();
    setDateRange(dates);
    setTimeFrame('weekly');
  }, []);

  const setMonthFilter = useCallback(() => {
    const dates = getCurrentMonthDates();
    setDateRange(dates);
    setTimeFrame('monthly');
  }, []);

  const renderCustomizedLabel = useCallback(({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
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
        fontSize="10"
        fontWeight="bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  }, []);

  if (loading || userPermissionsLoading) {
    return (
      <div className="flex flex-col justify-center items-center h-96 space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-600 font-medium animate-pulse">Loading analytics data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1 bg-gray-50/50 min-h-screen pb-10">
      <div className="flex flex-col gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Performance Dashboard</h1>
        </div>

        <Card className="w-full md:w-auto border-0 shadow-lg bg-white">
          <CardContent className="p-4">
            <div className="flex flex-col xl:flex-row gap-4 items-end">
              
              {/* Year Selector */}
              <div className="w-full md:w-40 space-y-1">
                <Label className="text-xs text-gray-500 font-semibold">Fiscal Year</Label>
                <Select value={selectedYear} onValueChange={handleYearChange}>
                  <SelectTrigger className="h-9">
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <SelectValue placeholder="Select Year" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                     {availableYears.map(year => (
                       <SelectItem key={year} value={year}>{year}</SelectItem>
                     ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Programme Selector */}
              {showProgrammeFilter && (
                <div className="w-full md:w-48 space-y-1">
                  <Label className="text-xs text-gray-500 font-semibold">Programme</Label>
                  <Select value={activeProgram} onValueChange={setActiveProgram}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select Programme" />
                    </SelectTrigger>
                    <SelectContent>
                       <SelectItem value="RANGE">RANGE</SelectItem>
                      <SelectItem value="KPMD">KPMD</SelectItem>                     
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Quarter Selector (Replaces Q1-Q4 Buttons) */}
              <div className="w-full md:w-40 space-y-1">
                <Label className="text-xs text-gray-500 font-semibold">Quarter</Label>
                <Select onValueChange={handleQuarterChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select Quarter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="q1">Q1 (Jan-Mar)</SelectItem>
                    <SelectItem value="q2">Q2 (Jan-Jun)</SelectItem>
                    <SelectItem value="q3">Q3 (Jan-Sep)</SelectItem>
                    <SelectItem value="q4">Q4 (Full Year)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full md:w-auto">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-semibold">From</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="border-gray-200 text-[5px] focus:border-blue-500 h-9  pr-20"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-semibold">To</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="border-gray-200 text-xs focus:border-blue-500 h-9  pr-20"
                  />
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto">
                <Button variant="outline" onClick={setWeekFilter} size="sm">This Week</Button>
                <Button variant="outline" onClick={setMonthFilter} size="sm">This Month</Button>
                <Button onClick={clearFilters} variant="ghost" size="sm" className="text-red-500 hover:text-red-600">Reset Filters</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SECTION 1: FARMER REGISTRATION & OVERVIEW */}
      <section>
        <SectionHeader title="Farmer Registration" />
        
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatsCard 
            title="Total Farmers Registered" 
            value={data.totalFarmers.toLocaleString()} 
            icon={Users}
            subtext={`${data.maleFarmers} Male (${data.malePercentage}%) | ${data.femaleFarmers} Female (${data.femalePercentage}%)`}
            color="blue"
          />

          <StatsCard 
            title="Animal Census" 
            value={data.totalAnimals.toLocaleString()} 
            icon={Beef}
            subtext={`Goats: ${data.totalGoats} (${data.goatsPercentage}%) | Sheep: ${data.totalSheep} (${data.sheepPercentage}%)`}
            color="orange"
          />

          <StatsCard 
            title="Total Trained Farmers" 
            value={data.totalTrainedFarmers.toLocaleString()} 
            icon={GraduationCap}
            subtext="Farmers trained in selected period"
            color="yellow"
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-purple-600" />
                County Performance (Farmers)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.countyPerformanceData}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={2}
                    dataKey="value"
                    label={renderCustomizedLabel}
                    labelLine={false}
                  >
                    {data.countyPerformanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Farmers Registration Trend
                </CardTitle>
                <div className="flex gap-1">
                  {(['weekly', 'monthly', 'yearly'] as const).map((frame) => (
                    <Button 
                      key={frame}
                      variant={timeFrame === frame ? 'default' : 'ghost'} 
                      size="sm" 
                      onClick={() => setTimeFrame(frame)}
                      className="text-xs h-7 px-2"
                    >
                      {frame}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data.registrationTrendData}>
                  <defs>
                    <linearGradient id="colorReg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.darkBlue} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={COLORS.darkBlue} stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="registrations" stroke={COLORS.darkBlue} fillOpacity={1} fill="url(#colorReg)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <MapPin className="h-4 w-4 text-green-600" />
                Top Locations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.topLocations} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={75} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12}>
                    {data.topLocations.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS.green} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Users className="h-4 w-4 text-blue-600" />
                Top Customers (Farmers by Herd Size)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.topCustomers} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={75} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12}>
                    {data.topCustomers.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS.darkBlue} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SECTION 2: ANIMAL HEALTH */}
      <section>
        <SectionHeader title="Animal Health" />

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <StatsCard 
            title="Regional Coverage" 
            value={data.uniqueCounties} 
            icon={MapPin}
            subtext="Counties with active farmers"
            color="purple"
          />

          <StatsCard 
            title="Breeds Distributed" 
            value={data.totalBreedsDistributed.toLocaleString()} 
            icon={TargetIcon}
            subtext={`Male: ${data.breedsMale} (${data.breedsMalePercentage}%) | Female: ${data.breedsFemale} (${data.breedsFemalePercentage}%)`}
            color="teal"
          />

          <StatsCard 
            title="Vaccinated Animals" 
            value={data.vaccinatedAnimals.toLocaleString()} 
            icon={Syringe}
            subtext={`${data.vaccinationRate}% coverage rate (${data.vaccinatedFarmersCount} farmers)`}
            color={Number(data.vaccinationRate) >= 75 ? "green" : Number(data.vaccinationRate) >= 50 ? "yellow" : "red"}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Award className="h-4 w-4 text-teal-600" />
                Breeds Distribution per County
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.breedsByCountyData}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={2}
                    dataKey="value"
                    label={renderCustomizedLabel}
                    labelLine={false}
                  >
                    {data.breedsByCountyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white h-[350px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-teal-600" />
                Subcounty Performance (Breeds)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.breedsBySubcountyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} interval={0} tick={{fontSize: 10}} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20} fill={COLORS.teal} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Vaccinated Animals per County
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.vaccinationByCountyData} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={75} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.red} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <Syringe className="h-4 w-4 text-red-600" />
                Vaccinated Animals per Subcounty
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.vaccinationBySubcountyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} interval={0} tick={{fontSize: 10}} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={20} fill={COLORS.maroon} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default PerformanceReport;