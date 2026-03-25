import * as React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  canViewAllProgrammes,
  isHummanResourceManager,
  isProjectManager,
  resolvePermissionPrincipal,
} from "@/contexts/authhelper";
import { ref, get } from "firebase/database";
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
import { fetchAnalysisSummary } from "@/lib/analysis";
import { resolveAccessibleProgrammes, resolveActiveProgramme } from "@/lib/programme-access";

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

interface OfftakeRecord {
  id: string;
  date?: string | number | Date;
  Date?: string | number | Date;
  createdAt?: string | number;
  programme?: string;
  totalGoats?: number | string;
  goatsBought?: number | string;
  goats?: unknown;
  Goats?: unknown;
}

interface AnimalHealthVaccine {
  type?: string;
  doses?: number | string;
}

interface AnimalHealthRecord {
  id: string;
  date?: string;
  createdAt?: string | number;
  programme?: string;
  vaccines?: AnimalHealthVaccine[];
  vaccinetype?: string;
  number_doses?: number | string;
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

const getArrayLikeSize = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return 0;
};

const getLeaderName = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
};

const getGoatTotal = (goats: any): number => {
  if (typeof goats === "number") return goats;
  if (typeof goats === "object" && goats !== null && typeof goats.total === "number") return goats.total;
  return 0;
};

const getOfftakeGoatsTotal = (record: OfftakeRecord): number =>
  Math.max(
    getNumberField(record, "totalGoats"),
    getNumberField(record, "goatsBought"),
    getNumberField(record, "goats"),
    getArrayLikeSize(record.goats),
    getArrayLikeSize(record.Goats),
    0,
  );

const getAnimalHealthTotalDoses = (record: AnimalHealthRecord): number => {
  if (Array.isArray(record.vaccines)) {
    return record.vaccines.reduce((sum, vaccine) => sum + (Number(vaccine?.doses) || 0), 0);
  }
  return getNumberField(record, "number_doses");
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

const USE_REMOTE_ANALYTICS =
  typeof window !== "undefined" && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

type PerformanceReportData = {
  scope: "performance-report";
  resolvedProgrammes: string[];
  totalFarmers: number;
  maleFarmers: number;
  femaleFarmers: number;
  malePercentage: string;
  femalePercentage: string;
  totalAnimals: number;
  totalGoats: number;
  totalSheep: number;
  goatsPercentage: string;
  sheepPercentage: string;
  totalTrainedFarmers: number;
  countyPerformanceData: Array<{ name: string; value: number }>;
  registrationTrendData: Array<{ name: string; registrations: number }>;
  topLocations: Array<{ name: string; value: number }>;
  topCustomers: Array<{ name: string; value: number; county: string }>;
  totalGoatsPurchased: number;
  topFieldOfficers: Array<{ name: string; value: number }>;
  topStaffAwarded: Array<{ name: string; value: number }>;
  totalDosesGivenOut: number;
  uniqueCounties: number;
  totalBreedsDistributed: number;
  breedsMale: number;
  breedsFemale: number;
  breedsMalePercentage: string;
  breedsFemalePercentage: string;
  vaccinationRate: string;
  vaccinatedAnimals: number;
  vaccinatedFarmersCount: number;
  breedsByCountyData: Array<{ name: string; value: number }>;
  breedsBySubcountyData: Array<{ name: string; value: number }>;
  vaccinationByCountyData: Array<{ name: string; value: number }>;
  vaccinationBySubcountyData: Array<{ name: string; value: number }>;
};

const EMPTY_PERFORMANCE_DATA: PerformanceReportData = {
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
  vaccinationRate: "0.0",
  vaccinatedAnimals: 0,
  vaccinatedFarmersCount: 0,
  breedsByCountyData: [],
  breedsBySubcountyData: [],
  vaccinationByCountyData: [],
  vaccinationBySubcountyData: [],
};

const normalizeProgramme = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

function computeLocalPerformanceReportData(
  farmers: Farmer[],
  trainingRecords: TrainingRecord[],
  animalHealthActivities: AnimalHealthRecord[],
  offtakeRecords: OfftakeRecord[],
  dateRange: { startDate: string; endDate: string },
  timeFrame: "weekly" | "monthly" | "yearly",
  selectedProgramme: string | null,
  selectedYear: number | null,
): PerformanceReportData {
  if (!selectedProgramme) return EMPTY_PERFORMANCE_DATA;

  const requestedProgramme = normalizeProgramme(selectedProgramme);
  const includeAllProgrammes = !requestedProgramme || requestedProgramme === "ALL";
  const filteredFarmers = farmers.filter((farmer) => {
    const programme = normalizeProgramme(farmer.programme);
    const farmerDate = farmer.createdAt || farmer.registrationDate;
    return (includeAllProgrammes || programme === requestedProgramme) &&
      isDateInRange(farmerDate, dateRange.startDate, dateRange.endDate);
  });

  const filteredTraining = trainingRecords.filter((record) => {
    const programme = normalizeProgramme(record.programme);
    const recordDate = record.createdAt || record.startDate;
    return (includeAllProgrammes || programme === requestedProgramme) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const filteredAnimalHealthActivities = animalHealthActivities.filter((record) => {
    const programme = normalizeProgramme(record.programme);
    const recordDate = record.createdAt || record.date;
    return (includeAllProgrammes || programme === requestedProgramme) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });
  const filteredOfftakeRecords = offtakeRecords.filter((record) => {
    const programme = normalizeProgramme(record.programme);
    const recordDate = record.date || record.Date || record.createdAt;
    return (includeAllProgrammes || programme === requestedProgramme) &&
      isDateInRange(recordDate, dateRange.startDate, dateRange.endDate);
  });

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
  const countyMap: Record<string, number> = {};
  const locationMap: Record<string, number> = {};
  const topCustomersMap: Record<string, { name: string; value: number; county: string }> = {};
  const topFieldOfficersMap: Record<string, number> = {};
  const topStaffAwardedMap: Record<string, number> = {};
  const breedsByCountyMap: Record<string, number> = {};
  const breedsBySubcountyMap: Record<string, number> = {};
  const vaccinationByCountyMap: Record<string, number> = {};
  const vaccinationBySubcountyMap: Record<string, number> = {};
  const selectedYearNumber = selectedYear && Number.isFinite(selectedYear) ? selectedYear : null;
  const currentYear = new Date().getFullYear();
  const trendYear = selectedYearNumber ?? null;

  for (const farmer of filteredFarmers) {
    const gender = String(farmer.gender || "").trim().toLowerCase();
    if (gender === "male") maleFarmers += 1;
    else if (gender === "female") femaleFarmers += 1;

    const goats = getGoatTotal(farmer.goats);
    const sheep = getNumberField(farmer, "sheep");
    const cattle = getNumberField(farmer, "cattle");
    const totalAnimalsForFarmer = goats + sheep + cattle;
    totalGoats += goats;
    totalSheep += sheep;
    totalCattle += cattle;

    const maleBreedCount = getNumberField(farmer, "maleBreeds");
    const femaleBreedCount = getNumberField(farmer, "femaleBreeds");
    breedsMale += maleBreedCount;
    breedsFemale += femaleBreedCount;

    const county = String(farmer.county || "Unknown").trim() || "Unknown";
    const location = String(farmer.location || "Unknown").trim() || "Unknown";
    countyMap[county] = (countyMap[county] || 0) + 1;
    locationMap[location] = (locationMap[location] || 0) + 1;

    const farmerName = String(farmer.name || farmer.farmerName || farmer.farmerId || farmer.id || "Unknown").trim() || "Unknown";
    const currentTop = topCustomersMap[farmerName] || { name: farmerName, value: 0, county };
    currentTop.value += totalAnimalsForFarmer;
    if (county !== "Unknown") currentTop.county = county;
    topCustomersMap[farmerName] = currentTop;

    const fieldOfficerName = typeof farmer.username === "string" ? farmer.username.trim() : "";
    if (fieldOfficerName) {
      topFieldOfficersMap[fieldOfficerName] = (topFieldOfficersMap[fieldOfficerName] || 0) + 1;
    }

    if (farmer.vaccinated === true) {
      totalVaccinatedAnimals += totalAnimalsForFarmer;
      vaccinatedFarmersCount += 1;
      vaccinationByCountyMap[county] = (vaccinationByCountyMap[county] || 0) + totalAnimalsForFarmer;
      const subcounty = String(farmer.subcounty || "Unknown").trim() || "Unknown";
      vaccinationBySubcountyMap[subcounty] = (vaccinationBySubcountyMap[subcounty] || 0) + totalAnimalsForFarmer;
    }

    if (maleBreedCount + femaleBreedCount > 0) {
      breedsByCountyMap[county] = (breedsByCountyMap[county] || 0) + maleBreedCount + femaleBreedCount;
      const subcounty = String(farmer.subcounty || "Unknown").trim() || "Unknown";
      breedsBySubcountyMap[subcounty] = (breedsBySubcountyMap[subcounty] || 0) + maleBreedCount + femaleBreedCount;
    }
  }

  filteredTraining.forEach((record) => {
    const staffName = getLeaderName(record.fieldOfficer || record.username, "");
    const farmersReached = getNumberField(record, "totalFarmers");
    if (!staffName || farmersReached <= 0) return;
    topStaffAwardedMap[staffName] = (topStaffAwardedMap[staffName] || 0) + farmersReached;
  });

  filteredAnimalHealthActivities.forEach((record) => {
    totalDosesGivenOut += getAnimalHealthTotalDoses(record);
  });

  filteredOfftakeRecords.forEach((record) => {
    totalGoatsPurchased += getOfftakeGoatsTotal(record);
  });

  const totalAnimals = totalGoats + totalSheep + totalCattle;
  const totalTrainedFarmers = filteredTraining.reduce((sum, record) => sum + getNumberField(record, "totalFarmers"), 0);
  const countyPerformanceData = Object.entries(countyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const topLocations = Object.entries(locationMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topCustomers = Object.values(topCustomersMap)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topFieldOfficers = Object.entries(topFieldOfficersMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const topStaffAwarded = Object.entries(topStaffAwardedMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const registrationTrendData = (() => {
    const trendData: Array<{ name: string; registrations: number }> = [];
    if (timeFrame === "weekly") {
      for (let offset = 3; offset >= 0; offset -= 1) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - (offset * 7) - weekStart.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const count = filteredFarmers.filter((farmer) => {
          const date = parseDate(farmer.createdAt || farmer.registrationDate);
          return !!date && date >= weekStart && date <= weekEnd;
        }).length;
        trendData.push({ name: `Week ${4 - offset}`, registrations: count });
      }
      return trendData;
    }

    if (timeFrame === "monthly") {
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
        trendData.push({ name: monthName, registrations: count });
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
      trendData.push({ name: String(year), registrations: count });
    }
    return trendData;
  })();
  const uniqueCounties = new Set(
    filteredFarmers.map((farmer) => String(farmer.county || "").trim()).filter(Boolean),
  ).size;
  const totalBreedsDistributed = breedsMale + breedsFemale;
  const breedsByCountyData = Object.entries(breedsByCountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const breedsBySubcountyData = Object.entries(breedsBySubcountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const vaccinationByCountyData = Object.entries(vaccinationByCountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const vaccinationBySubcountyData = Object.entries(vaccinationBySubcountyMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    scope: "performance-report",
    resolvedProgrammes: includeAllProgrammes ? ["KPMD", "RANGE"] : [requestedProgramme],
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
    vaccinationRate: totalAnimals > 0 ? ((totalVaccinatedAnimals / totalAnimals) * 100).toFixed(1) : "0.0",
    vaccinatedAnimals: totalVaccinatedAnimals,
    vaccinatedFarmersCount,
    breedsByCountyData,
    breedsBySubcountyData,
    vaccinationByCountyData,
    vaccinationBySubcountyData,
  };
}

// --- Custom Hook for Data Processing ---
const useProcessedData = (
  _allFarmers: Farmer[],
  _trainingRecords: TrainingRecord[],
  _animalHealthActivities: AnimalHealthRecord[],
  _offtakeRecords: OfftakeRecord[],
  dateRange: { startDate: string; endDate: string },
  timeFrame: 'weekly' | 'monthly' | 'yearly',
  selectedProgramme: string | null,
  selectedYear: number | null,
) => {
  const queryResult = useQuery({
    queryKey: [
      "performance-report",
      selectedProgramme,
      dateRange.startDate,
      dateRange.endDate,
      timeFrame,
      selectedYear,
    ],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "performance-report",
        programme: selectedProgramme,
        dateRange,
        timeFrame,
        selectedYear,
      }),
    enabled: USE_REMOTE_ANALYTICS && !!selectedProgramme,
    staleTime: 2 * 60 * 1000,
  });

  const localData = useMemo(
    () =>
      USE_REMOTE_ANALYTICS
        ? undefined
        : computeLocalPerformanceReportData(
            _allFarmers,
            _trainingRecords,
            _animalHealthActivities,
            _offtakeRecords,
            dateRange,
            timeFrame,
            selectedProgramme,
            selectedYear,
          ),
    [_allFarmers, _trainingRecords, _animalHealthActivities, _offtakeRecords, dateRange, timeFrame, selectedProgramme, selectedYear],
  );

  return {
    data: (queryResult.data as PerformanceReportData | undefined) ?? localData ?? EMPTY_PERFORMANCE_DATA,
    isLoading: queryResult.isLoading || queryResult.isFetching,
  };
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

type ReportAudience = "hr" | "project-manager" | "default";
type ReportSectionId =
  | "hr-summary"
  | "hr-rankings"
  | "hr-distribution"
  | "default-registration"
  | "default-animal-health";

const REPORT_VIEW_PROFILES: Record<ReportAudience, { title: string; sections: ReportSectionId[] }> = {
  hr: {
    title: "HR Performance Dashboard",
    sections: ["hr-summary", "hr-rankings", "hr-distribution"],
  },
  "project-manager": {
    title: "Performance Dashboard",
    sections: ["default-registration", "default-animal-health"],
  },
  default: {
    title: "Performance Dashboard",
    sections: ["default-registration", "default-animal-health"],
  },
};

const resolveReportAudience = (
  userRole: string | null | undefined,
  userAttribute?: string | null,
): ReportAudience => {
  const principal = resolvePermissionPrincipal(userRole, userAttribute);
  if (isHummanResourceManager(principal)) return "hr";
  if (isProjectManager(principal)) return "project-manager";
  return "default";
};

// --- Main Component ---

const PerformanceReport = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();
  const currentMonthDates = useMemo(() => getCurrentMonthDates(), []);
  
  const cacheRef = useRef<{
    farmers: Farmer[] | null;
    training: TrainingRecord[] | null;
    animalHealth: AnimalHealthRecord[] | null;
    offtakes: OfftakeRecord[] | null;
    timestamp: number;
  }>({ farmers: null, training: null, animalHealth: null, offtakes: null, timestamp: 0 });
  
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [animalHealthActivities, setAnimalHealthActivities] = useState<AnimalHealthRecord[]>([]);
  const [offtakeRecords, setOfftakeRecords] = useState<OfftakeRecord[]>([]);
  
  const [dateRange, setDateRange] = useState({
    startDate: currentMonthDates.startDate,
    endDate: currentMonthDates.endDate,
  });
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const [selectedQuarter, setSelectedQuarter] = useState<string>("");
  
  const availableYears = useMemo(() => {
    const years: string[] = [];
    for(let i = 0; i < 5; i++) {
      years.push(String(currentYear - i));
    }
    return years;
  }, [currentYear]);

  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );
  const reportAudience = useMemo(
    () => resolveReportAudience(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const reportViewProfile = REPORT_VIEW_PROFILES[reportAudience];
  const hasSection = useCallback(
    (section: ReportSectionId) => reportViewProfile.sections.includes(section),
    [reportViewProfile.sections]
  );
  const showProgrammeFilter = userCanViewAllProgrammeData;
  
  const selectedYearNum = useMemo(() => {
    const parsed = parseInt(selectedYear, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [selectedYear]);
  
  const { data, isLoading: analysisLoading } = useProcessedData(
    allFarmers,
    trainingRecords,
    animalHealthActivities,
    offtakeRecords,
    dateRange,
    timeFrame,
    activeProgram || null,
    selectedYearNum,
  );

  const fetchAllData = async () => {
    if (USE_REMOTE_ANALYTICS) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const now = Date.now();
      let farmersList: Farmer[] = [];
      let trainingList: TrainingRecord[] = [];
      let animalHealthList: AnimalHealthRecord[] = [];
      let offtakeList: OfftakeRecord[] = [];

      if (cacheRef.current.farmers && 
          cacheRef.current.training && 
          cacheRef.current.animalHealth &&
          cacheRef.current.offtakes &&
          (now - cacheRef.current.timestamp < CACHE_DURATION)) {
        console.log("Using cached data");
        farmersList = cacheRef.current.farmers;
        trainingList = cacheRef.current.training;
        animalHealthList = cacheRef.current.animalHealth;
        offtakeList = cacheRef.current.offtakes;
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

        const animalHealthRef = ref(db, 'AnimalHealthActivities');
        const animalHealthSnap = await get(animalHealthRef);

        if (animalHealthSnap.exists()) {
          animalHealthSnap.forEach((childSnapshot) => {
            const activity = childSnapshot.val();
            animalHealthList.push({
              id: childSnapshot.key || '',
              date: activity.date || '',
              createdAt: activity.createdAt,
              programme: activity.programme || undefined,
              vaccines: Array.isArray(activity.vaccines) ? activity.vaccines : undefined,
              vaccinetype: activity.vaccinetype || undefined,
              number_doses: activity.number_doses,
            });
          });
        }

        const offtakesRef = ref(db, 'offtakes');
        const offtakesSnap = await get(offtakesRef);

        if (offtakesSnap.exists()) {
          offtakesSnap.forEach((childSnapshot) => {
            const record = childSnapshot.val();
            offtakeList.push({
              id: childSnapshot.key || '',
              date: record.date,
              Date: record.Date,
              createdAt: record.createdAt,
              programme: record.programme || record.Programme || undefined,
              totalGoats: record.totalGoats,
              goatsBought: record.goatsBought,
              goats: record.goats,
              Goats: record.Goats,
            });
          });
        }

        cacheRef.current = {
          farmers: farmersList,
          training: trainingList,
          animalHealth: animalHealthList,
          offtakes: offtakeList,
          timestamp: now
        };
      }

      setAllFarmers(farmersList);
      setTrainingRecords(trainingList);
      setAnimalHealthActivities(animalHealthList);
      setOfftakeRecords(offtakeList);
      
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialDates = getCurrentMonthDates();
    setDateRange(initialDates);
    fetchAllData();
  }, []);

  useEffect(() => {
    if (userCanViewAllProgrammeData) {
      setActiveProgram((prev) => (prev === "KPMD" || prev === "RANGE" ? prev : "KPMD"));
      return;
    }
    setActiveProgram((prev) => resolveActiveProgramme(prev, accessibleProgrammes));
  }, [accessibleProgrammes, userCanViewAllProgrammeData]);

  const handleDateRangeChange = useCallback((key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleYearChange = useCallback((year: string) => {
    const yearNum = parseInt(year, 10);
    setSelectedYear(year);
    setSelectedQuarter("");
    setDateRange({ 
      startDate: `${yearNum}-01-01`, 
      endDate: `${yearNum}-12-31` 
    });
    setTimeFrame('yearly'); 
  }, []);

  // --- New Handler for Quarter Dropdown ---
  const handleQuarterChange = useCallback((value: string) => {
    setSelectedQuarter(value);
    const parsedYear = parseInt(selectedYear, 10);
    const yearNum = Number.isNaN(parsedYear) ? new Date().getFullYear() : parsedYear;
    if (Number.isNaN(parsedYear)) {
      setSelectedYear(String(yearNum));
    }
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
    // Remove all filters except programme
    setSelectedYear("");
    setSelectedQuarter("");
    
    // Clear Date Range
    setDateRange({ startDate: "", endDate: "" });
    
    // Reset TimeFrame to default
    setTimeFrame('monthly');
    
    // Note: activeProgram is NOT reset as per requirements
  }, []);

  const setWeekFilter = useCallback(() => {
    const dates = getCurrentWeekDates();
    setDateRange(dates);
    setTimeFrame('weekly');
    setSelectedQuarter("");
  }, []);

  const setMonthFilter = useCallback(() => {
    const dates = getCurrentMonthDates();
    setDateRange(dates);
    setTimeFrame('monthly');
    setSelectedQuarter("");
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

  if (analysisLoading || loading) {
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
          <h1 className="text-xl font-semibold text-gray-900">{reportViewProfile.title}</h1>
        </div>

        <Card className="w-full md:w-auto border-0 shadow-lg bg-white">
          <CardContent className="p-4">
            <div className="flex flex-colmd:flex-row lg:flex-row xl:flex-row gap-4 items-end">
              
              {/* Year Selector */}
              <div className="w-full md:w-40 space-y-1">
                <Label className="text-xs text-gray-500 font-semibold">Fiscal Year</Label>
                <Select value={selectedYear || undefined} onValueChange={handleYearChange}>
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
                  <Label className="text-xs text-gray-500 font-semibold">PROJECT</Label>
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
                <Select value={selectedQuarter || undefined} onValueChange={handleQuarterChange}>
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
               <Button onClick={clearFilters} variant="ghost" size="sm" className="text-red-500 hover:text-red-600">Reset Filters</Button>
              <div className="flex flex- gap-2 w-full md:w-auto">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-semibold">From</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="border-gray-200 text-xs focus:border-blue-500 h-9 pr-2"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500 font-semibold">To</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="border-gray-200 text-xs focus:border-blue-500 h-9 pr-2"
                  />
                </div>
              

            
                <Button variant="outline" onClick={setWeekFilter} size="sm">This Week</Button>
                <Button variant="outline" onClick={setMonthFilter} size="sm">This Month</Button>
               
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {hasSection("hr-summary") && (
        <section>
          <SectionHeader title="HR Summary" />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 mb-6">
            <StatsCard
              title="Total Goats Purchased"
              value={data.totalGoatsPurchased.toLocaleString()}
              icon={Beef}
              subtext="Goats purchased in the selected period"
              color="orange"
            />

            <StatsCard
              title="Total Registered Farmers"
              value={data.totalFarmers.toLocaleString()}
              icon={Users}
              subtext="Farmer registrations in the selected period"
              color="blue"
            />

            <StatsCard
              title="Total Trained Farmers"
              value={data.totalTrainedFarmers.toLocaleString()}
              icon={GraduationCap}
              subtext="Farmers reached through training"
              color="yellow"
            />

            <StatsCard
              title="Total Breeds Distributed"
              value={data.totalBreedsDistributed.toLocaleString()}
              icon={TargetIcon}
              subtext={`Male: ${data.breedsMale} | Female: ${data.breedsFemale}`}
              color="teal"
            />

            <StatsCard
              title="Total Doses Given Out"
              value={data.totalDosesGivenOut.toLocaleString()}
              icon={Syringe}
              subtext="Animal health doses recorded in the selected period"
              color="red"
            />
          </div>
        </section>
      )}

      {hasSection("hr-rankings") && (
        <section>
          <SectionHeader title="HR Rankings" />

          <div className="grid gap-6 md:grid-cols-2 mb-6">
            <Card className="border-0 shadow-lg bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <Users className="h-4 w-4 text-blue-600" />
                  Top Field Officers (Mobile Users)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.topFieldOfficers} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                    <XAxis type="number" axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.darkBlue} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <Award className="h-4 w-4 text-yellow-600" />
                  Top Staff Awarded
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.topStaffAwarded} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                    <XAxis type="number" axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.yellow} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {hasSection("hr-distribution") && (
        <section>
          <SectionHeader title="Distribution And Registration" />

          <div className="grid gap-6 md:grid-cols-2 mb-6">
            <Card className="border-0 shadow-lg bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <MapPin className="h-4 w-4 text-green-600" />
                  Top Location In Registration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.topLocations} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                    <XAxis type="number" axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={12} fill={COLORS.green} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg bg-white h-[350px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                  <Award className="h-4 w-4 text-teal-600" />
                  Breeds Distributed By County
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
          </div>

          <Card className="border-0 shadow-lg bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-gray-800">
                <TrendingUp className="h-4 w-4 text-teal-600" />
                Breeds Distributed Per Subcounty
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
        </section>
      )}

      {hasSection("default-registration") && (
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
      )}

      {hasSection("default-animal-health") && (
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
      )}
    </div>
  );
};

export default PerformanceReport;

