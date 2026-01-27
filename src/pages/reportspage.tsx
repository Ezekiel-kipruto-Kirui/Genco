import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  collection, 
  getDocs, 
  query, 
  Firestore 
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, Line 
} from "recharts";
import { 
  Users, GraduationCap, Beef, Calendar, TrendingUp, Target, Award, Star, 
  MapPin, Syringe, TargetIcon, UserCheck 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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

// --- Types ---
interface OfftakeData {
  id: string;
  date: Date;
  farmerName: string;
  gender: string;
  idNumber: string;
  liveWeight: number;
  carcassWeight: number;
  location: string;
  noSheepGoats: number;
  phoneNumber: string;
  pricePerGoatAndSheep: number;
  region: string;
  totalprice: number;
}

interface Farmer {
  id: string;
  [key: string]: any;
}

interface TrainingRecord {
  id: string;
  [key: string]: any;
}

// --- Helper Functions ---
const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date?.toDate && typeof date.toDate === 'function') {
      return date.toDate(); // Firestore Timestamp
    } 
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } 
    if (typeof date === 'number') return new Date(date);
    if (date?.seconds) return new Date(date.seconds * 1000); // Firestore Timestamp object structure
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return null;
};

const getNumberField = (obj: any, ...fieldNames: string[]): number => {
  for (const fieldName of fieldNames) {
    const value = obj[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      return Number(value) || 0;
    }
  }
  return 0;
};

const isFarmerTrained = (farmer: Farmer, trainingRecords: TrainingRecord[]): boolean => {
  const farmerPhone = (farmer.phone || farmer.phoneNo || farmer.Phone)?.toString().trim();
  const farmerName = (farmer.name || farmer.Name)?.toString().toLowerCase().trim();
  
  return trainingRecords.some(record => {
    const recordPhone = record.Phone?.toString().trim();
    const recordName = record.Name?.toString().toLowerCase().trim();
    return (recordPhone && farmerPhone && recordPhone === farmerPhone) ||
           (recordName && farmerName && recordName === farmerName);
  });
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
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
  return {
    startDate: startOfWeek.toISOString().split('T')[0],
    endDate: endOfWeek.toISOString().split('T')[0]
  };
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: startOfMonth.toISOString().split('T')[0],
    endDate: endOfMonth.toISOString().split('T')[0]
  };
};

// --- Custom Hook for Data Processing ---
const useProcessedData = (
  allFarmers: Farmer[], 
  trainingRecords: TrainingRecord[], 
  offtakeData: OfftakeData[], 
  dateRange: { startDate: string; endDate: string }, 
  timeFrame: 'weekly' | 'monthly' | 'yearly'
) => {
  return useMemo(() => {
    if (allFarmers.length === 0) {
      return {
        filteredData: [],
        filteredOfftakeData: [],
        genderData: [],
        trainedGenderData: [],
        registrationTrendData: [],
        topOfftakeFarmers: [],
        topLocations: [],
        stats: {
          totalFarmers: 0,
          maleFarmers: 0,
          femaleFarmers: 0,
          totalAnimals: 0,
          trainedFarmers: 0,
          trainedMale: 0,
          trainedFemale: 0,
          offtakeParticipants: 0
        },
        regionStats: {
          totalRegions: 0,
          farmersPerRegion: [],
          topPerformingRegion: { name: 'N/A', farmers: 0, percentage: 0 },
          averageFarmersPerRegion: 0
        },
        breedStats: {
          totalBreedsDistributed: 0,
          farmersReceivingBreeds: 0,
          breedDistribution: { newBreedFemales: 0, newBreedMales: 0, newBreedYoung: 0 }
        },
        vaccinationStats: {
          vaccinatedAnimals: 0,
          totalAnimals: 0,
          vaccinationRate: 0,
          comment: "No data available"
        }
      };
    }

    // Filter Data
    const filteredData = allFarmers.filter(farmer => 
      isDateInRange(farmer.dateSubmitted || farmer.createdAt || farmer.date, dateRange.startDate, dateRange.endDate)
    );

    const filteredOfftakeData = offtakeData.filter(record => 
      isDateInRange(record.date, dateRange.startDate, dateRange.endDate)
    );

    // Calculate Basic Stats
    const maleFarmers = filteredData.filter(f => String(f.gender || f.Gender).toLowerCase() === 'male').length;
    const femaleFarmers = filteredData.filter(f => String(f.gender || f.Gender).toLowerCase() === 'female').length;
    
    const trainedMale = filteredData.filter(farmer => 
      isFarmerTrained(farmer, trainingRecords) && String(farmer.gender || farmer.Gender).toLowerCase() === 'male'
    ).length;
    
    const trainedFemale = filteredData.filter(farmer => 
      isFarmerTrained(farmer, trainingRecords) && String(farmer.gender || farmer.Gender).toLowerCase() === 'female'
    ).length;
    
    const totalAnimals = filteredData.reduce((sum, farmer) => 
      sum + getNumberField(farmer, "goatsMale", "GoatsMale", "maleGoats") + 
          getNumberField(farmer, "goatsFemale", "GoatsFemale", "femaleGoats"), 0
    );

    // Region Statistics
    const regionMap: Record<string, number> = {};
    filteredData.forEach(farmer => {
      const region = farmer.region || farmer.Region || farmer.county || farmer.County || 'Unknown';
      regionMap[region] = (regionMap[region] || 0) + 1;
    });

    const farmersPerRegion = Object.entries(regionMap)
      .map(([name, farmers]) => ({ name, farmers }))
      .sort((a, b) => b.farmers - a.farmers);

    const topPerformingRegion = farmersPerRegion[0] || { name: 'N/A', farmers: 0 };
    const averageFarmersPerRegion = farmersPerRegion.length > 0 
      ? farmersPerRegion.reduce((sum, region) => sum + region.farmers, 0) / farmersPerRegion.length 
      : 0;

    const regionalPerformancePercentage = topPerformingRegion.farmers > 0 
      ? (topPerformingRegion.farmers / filteredData.length) * 100 
      : 0;

    // Breed Distribution
    const breedDistribution = {
      newBreedFemales: filteredData.reduce((sum, farmer) => sum + getNumberField(farmer, "newBreedFemales", "newBreedFemale"), 0),
      newBreedMales: filteredData.reduce((sum, farmer) => sum + getNumberField(farmer, "newBreedMales", "newBreedMale"), 0),
      newBreedYoung: filteredData.reduce((sum, farmer) => sum + getNumberField(farmer, "newBreedYoung", "newBreedYoungs"), 0)
    };

    const totalBreedsDistributed = breedDistribution.newBreedFemales + breedDistribution.newBreedMales + breedDistribution.newBreedYoung;
    
    const farmersReceivingBreeds = filteredData.filter(farmer => 
      getNumberField(farmer, "numberOfBreeds", "NumberOfBreeds", "breeds", "totalBreeds") > 0 ||
      getNumberField(farmer, "newBreedFemales", "newBreedFemale") > 0 ||
      getNumberField(farmer, "newBreedMales", "newBreedMale") > 0 ||
      getNumberField(farmer, "newBreedYoung", "newBreedYoungs") > 0
    ).length;

    // Vaccination Statistics
    const vaccinatedAnimals = filteredData.reduce((sum, farmer) => 
      sum + getNumberField(farmer, "vaccinatedAnimals", "vaccinated", "animalsVaccinated"), 0
    );
    
    const vaccinationRate = totalAnimals > 0 ? (vaccinatedAnimals / totalAnimals) * 100 : 0;
    
    let vaccinationComment = "No data available";
    if (totalAnimals > 0) {
      if (vaccinationRate < 50) vaccinationComment = "Action needed";
      else if (vaccinationRate < 75) vaccinationComment = "Average action needed";
      else vaccinationComment = "Good progress";
    }

    // Generate Trend Data
    const generateTrendData = () => {
      const trendData: any[] = [];
      const currentYear = new Date().getFullYear();
      
      if (timeFrame === 'weekly') {
        for (let week = 1; week <= 4; week++) {
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - ((4 - week) * 7));
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          
          const weekRegistrations = filteredData.filter(farmer => {
            const farmerDate = parseDate(farmer.dateSubmitted || farmer.createdAt || farmer.date);
            return farmerDate && farmerDate >= weekStart && farmerDate <= weekEnd;
          }).length;

          trendData.push({
            name: `Week ${week}`,
            registrations: weekRegistrations,
            target: Math.round(filteredData.length / 4)
          });
        }
      } else if (timeFrame === 'monthly') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.forEach((month, index) => {
          // Fixed: Use dynamic year instead of hardcoded 2024
          const monthStart = new Date(currentYear, index, 1);
          const monthEnd = new Date(currentYear, index + 1, 0);
          
          const monthRegistrations = filteredData.filter(farmer => {
            const farmerDate = parseDate(farmer.dateSubmitted || farmer.createdAt || farmer.date);
            return farmerDate && farmerDate >= monthStart && farmerDate <= monthEnd;
          }).length;

          trendData.push({
            name: month,
            registrations: monthRegistrations,
            target: Math.round(filteredData.length / 12)
          });
        });
      } else {
        for (let year = currentYear - 4; year <= currentYear; year++) {
          const yearStart = new Date(year, 0, 1);
          const yearEnd = new Date(year, 11, 31);
          
          const yearRegistrations = filteredData.filter(farmer => {
            const farmerDate = parseDate(farmer.dateSubmitted || farmer.createdAt || farmer.date);
            return farmerDate && farmerDate >= yearStart && farmerDate <= yearEnd;
          }).length;

          trendData.push({
            name: year.toString(),
            registrations: yearRegistrations,
            target: Math.round(filteredData.length / 5)
          });
        }
      }

      return trendData;
    };

    // Generate Top Performers
    const generateTopOfftakeFarmers = () => {
      const farmerSales: Record<string, number> = {};
      filteredOfftakeData.forEach(record => {
        const farmerKey = record.farmerName || record.idNumber;
        if (farmerKey) farmerSales[farmerKey] = (farmerSales[farmerKey] || 0) + record.noSheepGoats;
      });

      return Object.entries(farmerSales)
        .map(([name, animals]) => ({ name, animals }))
        .sort((a, b) => b.animals - a.animals)
        .slice(0, 4);
    };

    const generateTopLocations = () => {
      const locationSales: Record<string, number> = {};
      filteredOfftakeData.forEach(record => {
        const location = record.location || 'Unknown';
        locationSales[location] = (locationSales[location] || 0) + record.noSheepGoats;
      });

      return Object.entries(locationSales)
        .map(([name, animals]) => ({ name, animals }))
        .sort((a, b) => b.animals - a.animals)
        .slice(0, 4);
    };

    return {
      filteredData,
      filteredOfftakeData,
      genderData: [
        { name: "Male", value: maleFarmers, color: COLORS.darkBlue },
        { name: "Female", value: femaleFarmers, color: COLORS.orange },
      ],
      trainedGenderData: [
        { name: "Male", value: trainedMale, color: COLORS.yellow },
        { name: "Female", value: trainedFemale, color: COLORS.maroon },
      ],
      registrationTrendData: generateTrendData(),
      topOfftakeFarmers: generateTopOfftakeFarmers(),
      topLocations: generateTopLocations(),
      stats: {
        totalFarmers: filteredData.length,
        maleFarmers,
        femaleFarmers,
        totalAnimals,
        trainedFarmers: trainedMale + trainedFemale,
        trainedMale,
        trainedFemale,
        offtakeParticipants: filteredOfftakeData.length
      },
      regionStats: {
        totalRegions: farmersPerRegion.length,
        farmersPerRegion,
        topPerformingRegion: { ...topPerformingRegion, percentage: regionalPerformancePercentage },
        averageFarmersPerRegion
      },
      breedStats: {
        totalBreedsDistributed,
        farmersReceivingBreeds,
        breedDistribution
      },
      vaccinationStats: {
        vaccinatedAnimals,
        totalAnimals,
        vaccinationRate,
        comment: vaccinationComment
      }
    };
  }, [allFarmers, trainingRecords, offtakeData, dateRange, timeFrame]);
};

// --- Sub Components ---

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  color?: 'blue' | 'orange' | 'yellow' | 'green' | 'red' | 'purple' | 'teal';
  children?: React.ReactNode;
}

const StatsCard = ({ title, value, icon: Icon, description, color = "blue", children }: StatsCardProps) => {
  const colorMap: Record<string, { border: string, bg: string, text: string }> = {
    blue: { border: 'bg-blue-500', bg: 'bg-blue-100', text: 'text-blue-600' },
    orange: { border: 'bg-orange-500', bg: 'bg-orange-100', text: 'text-orange-600' },
    yellow: { border: 'bg-yellow-500', bg: 'bg-yellow-100', text: 'text-yellow-600' },
    green: { border: 'bg-green-500', bg: 'bg-green-100', text: 'text-green-600' },
    red: { border: 'bg-red-500', bg: 'bg-red-100', text: 'text-red-600' },
    purple: { border: 'bg-purple-500', bg: 'bg-purple-100', text: 'text-purple-600' },
    teal: { border: 'bg-teal-500', bg: 'bg-teal-100', text: 'text-teal-600' },
  };

  const theme = colorMap[color];

  return (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${theme.border}`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${theme.bg} shadow-sm`}>
          <Icon className={`h-4 w-4 ${theme.text}`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {description && (
          <p className="text-xs text-gray-500 mt-2 font-medium">{description}</p>
        )}
        {children}
      </CardContent>
    </Card>
  );
};

// --- Main Component ---

const PerformanceReport = () => {
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [offtakeData, setOfftakeData] = useState<OfftakeData[]>([]);
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');

  // FIX: Cast db to Firestore type to resolve 'Database' vs 'Firestore' type error
  const firestore = db as unknown as Firestore;

  const {
    filteredData,
    genderData,
    trainedGenderData,
    registrationTrendData,
    topOfftakeFarmers,
    topLocations,
    stats,
    regionStats,
    breedStats,
    vaccinationStats
  } = useProcessedData(allFarmers, trainingRecords, offtakeData, dateRange, timeFrame);

  // Fetch all data on component mount
  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      
      // Using the corrected 'firestore' variable
      const [farmersSnapshot, trainingSnapshot, offtakeSnapshot] = await Promise.all([
        getDocs(query(collection(firestore, "Livestock Farmers"))),
        getDocs(query(collection(firestore, "Capacity Building"))),
        getDocs(query(collection(firestore, "Livestock Offtake Data")))
      ]);

      const farmersData = farmersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const trainingData = trainingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const processedOfftakeData: OfftakeData[] = offtakeSnapshot.docs.map((doc, index) => {
        const item = doc.data();
        const dateValue = item.date?.toDate?.() || new Date(item.date) || new Date();

        return {
          id: item.id || `temp-${index}-${Date.now()}`,
          date: dateValue,
          farmerName: item.farmerName || item.farmername || item.farmer_name || item.name || '',
          gender: item.gender || item.Gender || '',
          idNumber: item.idNumber || item.idnumber || item.id_number || item.IDNumber || '',
          liveWeight: Number(item.liveWeight || item.live_weight || item.weight || 0),
          carcassWeight: Number(item.carcassWeight || item.carcass_weight || 0),
          location: item.location || item.Location || item.area || item.Area || '',
          noSheepGoats: Number(item.noSheepGoats || item.nosheepgoats || item.no_sheep_goats || item.quantity || item.animals || 0),
          phoneNumber: item.phoneNumber || item.phonenumber || item.phone_number || item.phone || item.Phone || '',
          pricePerGoatAndSheep: Number(item.pricePerGoatAndSheep || item.price_per_goat_sheep || item.price || 0),
          region: item.region || item.Region || item.county || item.County || '',
          totalprice: Number(item.totalprice || item.totalPrice || item.total_price || item.sheepGoatPrice || 0),
        };
      });

      setAllFarmers(farmersData);
      setTrainingRecords(trainingData);
      setOfftakeData(processedOfftakeData);
      
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPerformanceRecommendation = useCallback(() => {
    if (registrationTrendData.length === 0) return { text: "No data available", color: "gray" };
    
    const currentRegistrations = registrationTrendData[registrationTrendData.length - 1]?.registrations || 0;
    const averageRegistrations = registrationTrendData.reduce((sum, item) => sum + item.registrations, 0) / registrationTrendData.length;
    
    if (currentRegistrations > averageRegistrations * 1.2) {
      return { text: "Excellent Progress - Above Target", color: "green" };
    } else if (currentRegistrations >= averageRegistrations * 0.8) {
      return { text: "Average Performance - Action Needed", color: "yellow" };
    } else {
      return { text: "Poor Performance - Immediate Action Required", color: "red" };
    }
  }, [registrationTrendData]);

  const handleDateRangeChange = useCallback((key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
  }, []);

  const setWeekFilter = useCallback(() => {
    setDateRange(getCurrentWeekDates());
    setTimeFrame('weekly');
  }, []);

  const setMonthFilter = useCallback(() => {
    setDateRange(getCurrentMonthDates());
    setTimeFrame('monthly');
  }, []);

  const clearFilters = useCallback(() => {
    setDateRange({ startDate: "", endDate: "" });
    setTimeFrame('monthly');
  }, []);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="ml-2 text-gray-600">Loading analytics data...</p>
      </div>
    );
  }

  const performanceRecommendation = getPerformanceRecommendation();

  return (
    <div className="space-y-6 p-1">
      {/* Header and Filters */}
      <div className="flex flex-col justify-between items-start gap-4">
        <h1 className="text-xl font-bold text-gray-900">Performance Dashboard</h1>

        <Card className="w-full lg:w-auto border-0 shadow-lg bg-white">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate" className="text-sm font-medium text-gray-700">From Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate" className="text-sm font-medium text-gray-700">To Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={setWeekFilter} className="text-xs">This Week</Button>
                <Button variant="outline" onClick={setMonthFilter} className="text-xs">This Month</Button>
                <Button onClick={clearFilters} variant="outline" className="text-xs">Clear</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard 
          title="Total Farmers" 
          value={stats.totalFarmers.toLocaleString()} 
          icon={Users}
          description={`${stats.maleFarmers} male, ${stats.femaleFarmers} female`}
          color="blue"
        />

        <StatsCard 
          title="Animal Census" 
          value={stats.totalAnimals.toLocaleString()} 
          icon={Beef}
          description="Total livestock registered"
          color="orange"
        />

        <StatsCard 
          title="Trained Farmers" 
          value={stats.trainedFarmers.toLocaleString()} 
          icon={GraduationCap}
          description={`${stats.trainedMale} male, ${stats.trainedFemale} female trained`}
          color="yellow"
        />

        <StatsCard 
          title="Offtake Participants" 
          value={stats.offtakeParticipants.toLocaleString()} 
          icon={Award}
          description={`${((stats.offtakeParticipants / stats.totalFarmers) * 100).toFixed(1)}% participation rate`}
          color="green"
        />

        <StatsCard 
          title="Regional Coverage" 
          value={regionStats.totalRegions} 
          icon={MapPin}
          color="purple"
        >
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-1.5 max-h-24 overflow-y-auto">
              {regionStats.farmersPerRegion.slice(0, 8).map((region) => (
                <div 
                  key={region.name} 
                  className="flex flex-col-2 gap-2 bg-gray-50 rounded border border-gray-100 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-[10px] font-light text-gray-600 truncate leading-tight">{region.name}</span>
                  <div className="flex justify-between items-center mt-0.5">
                    <span className="text-[9px] text-gray-800">{region.farmers.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
            {regionStats.farmersPerRegion.length > 8 && (
              <div className="text-[10px] text-gray-500 text-center mt-2 font-light">
                +{regionStats.farmersPerRegion.length - 8} more regions
              </div>
            )}
          </div>
        </StatsCard>

        <StatsCard 
          title="Breeds Distributed" 
          value={breedStats.totalBreedsDistributed.toLocaleString()} 
          icon={TargetIcon}
          description={`${breedStats.farmersReceivingBreeds} farmers received breeds`}
          color="teal"
        />

        <StatsCard 
          title="Farmers with Breeds" 
          value={breedStats.farmersReceivingBreeds.toLocaleString()} 
          icon={UserCheck}
          description={`${((breedStats.farmersReceivingBreeds / stats.totalFarmers) * 100).toFixed(1)}% of total farmers`}
          color="blue"
        />

        <StatsCard 
          title="Vaccination Coverage" 
          value={`${vaccinationStats.vaccinationRate.toFixed(1)}%`} 
          icon={Syringe}
          description={`${vaccinationStats.comment} - ${vaccinationStats.vaccinatedAnimals.toLocaleString()} animals`}
          color={vaccinationStats.vaccinationRate >= 75 ? "green" : vaccinationStats.vaccinationRate >= 50 ? "yellow" : "red"}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Gender Distribution */}
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <Users className="h-5 w-5 text-blue-600" />
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

        {/* Trained Farmers by Gender */}
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <GraduationCap className="h-5 w-5 text-yellow-600" />
              Trained Farmers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={trainedGenderData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                >
                  {trainedGenderData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value, "Farmers"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Registration Trend and Top Performers */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Registration Trend Chart */}
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                Farmers Registration Trend
              </CardTitle>
              <div className="flex gap-2">
                {(['weekly', 'monthly', 'yearly'] as const).map((frame) => (
                  <Button 
                    key={frame}
                    variant={timeFrame === frame ? 'default' : 'outline'} 
                    size="sm" 
                    onClick={() => setTimeFrame(frame)}
                    className="text-xs h-8 capitalize"
                  >
                    {frame}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={registrationTrendData}>
                <defs>
                  <linearGradient id="colorRegistrations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.darkBlue} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={COLORS.darkBlue} stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Area 
                  type="monotone" 
                  dataKey="registrations" 
                  stroke={COLORS.darkBlue} 
                  fillOpacity={1} 
                  fill="url(#colorRegistrations)" 
                  name="Actual Registrations"
                />
                <Line 
                  type="monotone" 
                  dataKey="target" 
                  stroke={COLORS.orange} 
                  strokeDasharray="5 5"
                  name="Target"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
            <div className={`mt-4 p-3 rounded-lg ${
              performanceRecommendation.color === 'green' ? 'bg-green-50 border-green-200' :
              performanceRecommendation.color === 'yellow' ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-2">
                <Star className={`h-4 w-4 ${
                  performanceRecommendation.color === 'green' ? 'text-green-600' :
                  performanceRecommendation.color === 'yellow' ? 'text-yellow-600' :
                  'text-red-600'
                }`} />
                <span className={`text-sm font-medium ${
                  performanceRecommendation.color === 'green' ? 'text-green-800' :
                  performanceRecommendation.color === 'yellow' ? 'text-yellow-800' :
                  'text-red-800'
                }`}>
                  {performanceRecommendation.text}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Performers */}
        <div className="space-y-6">
          {/* Top Offtake Farmers */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-4">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <Award className="h-5 w-5 text-blue-600" />
                Top Offtake Farmers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={topOfftakeFarmers}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#374151' }} />
                  <Tooltip formatter={(value) => [`${value} animals`, 'Animals Sold']} contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }} />
                  <Bar dataKey="animals" radius={[0, 4, 4, 0]} barSize={10}>
                    {topOfftakeFarmers.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top Locations */}
          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-4">
              <CardTitle className="text-md flex items-center gap-2 text-gray-800">
                <Award className="h-5 w-5 text-orange-600" />
                Top Locations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart
                  data={topLocations}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#374151' }} />
                  <Tooltip formatter={(value) => [`${value} animals`, 'Total Sales']} contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }} />
                  <Bar dataKey="animals" radius={[0, 4, 4, 0]} barSize={10}>
                    {topLocations.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PerformanceReport;