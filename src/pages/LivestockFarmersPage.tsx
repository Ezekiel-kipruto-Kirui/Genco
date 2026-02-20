import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "firebase/auth";
import { ref, set, update, remove, push, onValue, query, orderByChild, equalTo } from "firebase/database";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Download, Users, MapPin, Eye, Calendar, Scale, Phone, CreditCard, Edit, Trash2, ShieldCheck, Activity, ChevronRight, Upload, GraduationCap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";

// --- Types ---

interface AgeDistribution {
  "1-4"?: number;
  "5-8"?: number;
  "8+": number;
}

interface GoatsData {
  female?: number;
  male?: number;
  total: number;

  idNumber?: string;
}

interface FarmerData {
  id: string;
  createdAt: number | string;
  farmerId: string;
  name: string;
  gender: string;
  idNumber?: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  cattle: string | number;
  goats: number | GoatsData; 
  sheep: string | number;
  vaccinated: boolean;
  traceability: boolean;
  vaccines: string[]; 
  ageDistribution?: AgeDistribution;
  registrationDate: string;
  programme: string; 
  username?: string;
  aggregationGroup?: string;
  bucksServed?: string;
  femaleBreeds?: string;
  maleBreeds?: string;
  dewormed?: boolean;
  dewormingDate?: string;
  vaccinationDate?: string;
  acres?: number;
}

interface TrainingData {
  id: string;
  county?: string; 
  subcounty?: string; 
  location?: string;
  topicTrained?: string; 
  totalFarmers?: number; 
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  rawTimestamp?: number;
  programme?: string; 
  username?: string;
  fieldOfficer?: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  county: string;
  subcounty: string;
  gender: string;
  location: string; 
}

interface Stats {
  totalFarmers: number;
  totalGoats: number;
  totalSheep: number;
  totalCattle: number;
  totalAcres: number;
  vaccinatedCount: number;
  maleFarmers: number;
  femaleFarmers: number;
  totalTrainedFarmers: number; 
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  farmerId: string;
  name: string;
  gender: string;
  idNumber: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  cattle: number;
  goats: number;
  sheep: number;
  vaccinated: boolean;
  programme: string;
}

const PAGE_LIMIT = 15;

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
    console.error('Error parsing date:', error, date);
  }
  return null;
};

const formatDate = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? parsedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) : 'N/A';
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() +1, 0);
  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    startDate: formatDate(startOfMonth), 
    endDate: formatDate(endOfMonth),
  };
};

const getGoatTotal = (goats: any): number => {
  if (typeof goats === 'number') return goats;
  if (typeof goats === 'object' && goats !== null) {
     return typeof goats.total === 'number' ? goats.total : 0;
  }
  return 0;
};

const getAcreTotal = (item: Record<string, any>): number => {
  const rawAcreValue =
    item.acres ??
    item.totalAcres ??
    item.totalAcresPasture ??
    item.landSize ??
    item.land_under_pasture ??
    item.landUnderPasture;

  if (typeof rawAcreValue === "number") return Number.isFinite(rawAcreValue) ? rawAcreValue : 0;
  if (typeof rawAcreValue === "string") {
    const parsed = Number(rawAcreValue.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const LivestockFarmersPage = () => {
  const { user, userRole, userName } = useAuth();
  const { toast } = useToast();
  
  const [allFarmers, setAllFarmers] = useState<FarmerData[]>([]);
  const [filteredFarmers, setFilteredFarmers] = useState<FarmerData[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<TrainingData[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSingleDeleteDialogOpen, setIsSingleDeleteDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<FarmerData | null>(null);
  const [editingRecord, setEditingRecord] = useState<FarmerData | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<FarmerData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const currentMonth = useMemo(getCurrentMonthDates, []);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    county: "all",
    subcounty: "all",
    gender: "all",
    location: "all" 
  });

  const [stats, setStats] = useState<Stats>({
    totalFarmers: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    totalAcres: 0,
    vaccinatedCount: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    totalTrainedFarmers: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page:1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const [editForm, setEditForm] = useState<EditForm>({
    farmerId: "",
    name: "",
    gender: "",
    idNumber: "",
    phone: "",
    county: "",
    subcounty: "",
    location: "",
    cattle: 0,
    goats: 0,
    sheep: 0,
    vaccinated: false,
    programme: ""
  });

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const requireChiefAdmin = () => {
    if (userIsChiefAdmin) return true;
    toast({
      title: "Access denied",
      description: "Only chief admin can create, edit, or delete records on this page.",
      variant: "destructive",
    });
    return false;
  };

  const getCachedData = (key: string) => {
    try {
      const cached = localStorage.getItem(key);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      console.error("Cache read error", e);
    }
    return null;
  };

  useEffect(() => {
    if (isChiefAdmin(userRole)) {
      setAvailablePrograms(["RANGE", "KPMD"]);
      setActiveProgram((prev) => (prev ? prev : "RANGE"));
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
        setActiveProgram((prev) => {
          if (programs.length === 0) return "";
          if (!prev || !programs.includes(prev)) return programs[0];
          return prev;
        });
      } else {
        setAvailablePrograms([]);
        setActiveProgram("");
      }
    }, (error) => {
        console.error("Error fetching user permissions:", error);
    });
    return () => unsubscribe();
  }, [userRole]);

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
          farmerId: item.farmerId || 'N/A',
          name: item.name || '',
          gender: item.gender || '',
          idNumber: item.idNumber || '',
          phone: item.phone || '',
          county: item.county || '',
          subcounty: item.subcounty || '',
          location: item.location || item.subcounty || '',
          cattle: item.cattle || '0',
          goats: item.goats || 0,
          sheep: item.sheep || '0',
          vaccinated: !!item.vaccinated,
          traceability: !!item.traceability,
          vaccines: Array.isArray(item.vaccines) ? item.vaccines : [],
          ageDistribution: item.ageDistribution || {},
          registrationDate: item.registrationDate || formatDate(dateValue),
          programme: item.programme || activeProgram,
          username: item.username || 'Unknown',
          aggregationGroup: item.aggregationGroup || '',
          bucksServed: item.bucksServed || '0',
          femaleBreeds: item.femaleBreeds || '0',
          maleBreeds: item.maleBreeds || '0',
          dewormed: !!item.dewormed,
          dewormingDate: item.dewormingDate || null,
          vaccinationDate: item.vaccinationDate || null,
          acres: getAcreTotal(item)
        };
      });

      farmersList.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
      setAllFarmers(farmersList);
      setLoading(false);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(farmersList));
      } catch (e) {
        console.warn("Cache write failed (likely full)", e);
      }
    }, (error) => {
      console.error("Error fetching farmers data:", error);
      toast({ title: "Error", description: "Failed to load farmers data", variant: "destructive" });
      setLoading(false);
    });
    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram, toast]);

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
        const records = Object.keys(data).map((key) => ({
            id: key,
            ...data[key]
        }));
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

  useEffect(() => {
    if (allFarmers.length === 0) {
      setFilteredFarmers([]);
      setStats({ totalFarmers: 0, totalGoats: 0, totalSheep: 0, totalCattle: 0, totalAcres: 0, vaccinatedCount: 0, maleFarmers: 0, femaleFarmers: 0, totalTrainedFarmers: 0 });
      return;
    }

    let filteredFarmersList = allFarmers.filter(record => {
      if (filters.startDate || filters.endDate) {
        const recordDate = parseDate(record.createdAt);
        if (recordDate) {
          const recordDateOnly = new Date(recordDate);
          recordDateOnly.setHours(0, 0, 0, 0);
          const startDate = filters.startDate ? new Date(filters.startDate) : null;
          const endDate = filters.endDate ? new Date(filters.endDate) : null;
          if (startDate) startDate.setHours(0, 0, 0, 0);
          if (endDate) endDate.setHours(23, 59, 59, 999);
          if (startDate && recordDateOnly < startDate) return false;
          if (endDate && recordDateOnly > endDate) return false;
        } else if (filters.startDate || filters.endDate) return false;
      }
      if (filters.county !== "all" && record.county?.toLowerCase() !== filters.county.toLowerCase()) return false;
      if (filters.subcounty !== "all" && record.subcounty?.toLowerCase() !== filters.subcounty.toLowerCase()) return false;
      if (filters.location !== "all" && record.location?.toLowerCase() !== filters.location.toLowerCase()) return false;
      if (filters.gender !== "all" && record.gender?.toLowerCase() !== filters.gender.toLowerCase()) return false;
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = [
          record.name, record.farmerId, record.location, record.county, record.idNumber, record.phone, record.username
        ].some(field => field?.toLowerCase().includes(searchTerm));
        if (!searchMatch) return false;
      }
      return true;
    });

    setFilteredFarmers(filteredFarmersList);
    
    let filteredTraining = trainingRecords.filter(record => {
        if (filters.startDate || filters.endDate) {
            const recordDate = parseDate(record.startDate || record.createdAt || record.rawTimestamp);
            if (recordDate) {
                const recordDateOnly = new Date(recordDate);
                recordDateOnly.setHours(0, 0, 0, 0);
                const startDate = filters.startDate ? new Date(filters.startDate) : null;
                const endDate = filters.endDate ? new Date(filters.endDate) : null;
                if (startDate) startDate.setHours(0, 0, 0, 0);
                if (endDate) endDate.setHours(23, 59, 59, 999);
                if (startDate && recordDateOnly < startDate) return false;
                if (endDate && recordDateOnly > endDate) return false;
            } else if (filters.startDate || filters.endDate) return false;
        }
        return true;
    });

    const totalFarmers = filteredFarmersList.length;
    const totalGoats = filteredFarmersList.reduce((sum, f) => sum + getGoatTotal(f.goats), 0);
    const totalSheep = filteredFarmersList.reduce((sum, f) => sum + (Number(f.sheep) || 0), 0);
    const totalCattle = filteredFarmersList.reduce((sum, f) => sum + (Number(f.cattle) || 0), 0);
    const totalAcres = filteredFarmersList.reduce((sum, f) => sum + (Number(f.acres) || 0), 0);
    const vaccinatedCount = filteredFarmersList.filter(f => f.vaccinated).length;
    const maleFarmers = filteredFarmersList.filter(f => f.gender?.toLowerCase() === 'male').length;
    const femaleFarmers = filteredFarmersList.filter(f => f.gender?.toLowerCase() === 'female').length;
    const totalTrainedFarmers = filteredTraining.reduce((sum, t) => sum + (Number(t.totalFarmers) || 0), 0);

    setStats({ totalFarmers, totalGoats, totalSheep, totalCattle, totalAcres, vaccinatedCount, maleFarmers, femaleFarmers, totalTrainedFarmers });

    const totalPages = Math.ceil(filteredFarmersList.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination(prev => ({
      ...prev, page: currentPage, totalPages, hasNext: currentPage < totalPages, hasPrev: currentPage > 1
    }));
  }, [allFarmers, trainingRecords, filters, pagination.limit, pagination.page]);

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters(prev => ({ 
        ...prev, 
        search: "", 
        startDate: currentMonth.startDate, 
        endDate: currentMonth.endDate, 
        county: "all", 
        subcounty: "all", 
        gender: "all",
        location: "all" 
    }));
    setSelectedRecords([]);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSearchChange = useCallback((value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value }));
      setPagination(prev => ({ ...prev, page: 1 }));
    }, 300);
  }, []);

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => {
      const totalPages = Math.ceil(filteredFarmers.length / prev.limit);
      const validatedPage = Math.max(1, Math.min(newPage, totalPages));
      return { ...prev, page: validatedPage, hasNext: validatedPage < totalPages, hasPrev: validatedPage > 1 };
    });
  }, [filteredFarmers.length]);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords(prev => prev.includes(recordId) ? prev.filter(id => id !== recordId) : [...prev, recordId]);
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = getCurrentPageRecords().map(f => f.id);
    setSelectedRecords(prev => prev.length === currentPageIds.length ? [] : currentPageIds);
  }, [filteredFarmers, pagination]);

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredFarmers.slice(startIndex, endIndex);
  }, [filteredFarmers, pagination.page, pagination.limit]);

  const openViewDialog = useCallback((record: FarmerData) => { setViewingRecord(record); setIsViewDialogOpen(true); }, []);
  
  const openEditDialog = useCallback((record: FarmerData) => {
    if (!userIsChiefAdmin) return;
    setEditingRecord(record);
    const cattleVal = typeof record.cattle === 'number' ? record.cattle : parseInt(record.cattle as string) || 0;
    const sheepVal = typeof record.sheep === 'number' ? record.sheep : parseInt(record.sheep as string) || 0;
    const goatsVal = getGoatTotal(record.goats);

    setEditForm({
      farmerId: record.farmerId,
      name: record.name,
      gender: record.gender,
      idNumber: record.idNumber || '',
      phone: record.phone,
      county: record.county,
      subcounty: record.subcounty,
      location: record.location,
      cattle: cattleVal,
      goats: goatsVal,
      sheep: sheepVal,
      vaccinated: record.vaccinated,
      programme: record.programme
    });
    setIsEditDialogOpen(true);
  }, [userIsChiefAdmin]);
  
  const openSingleDeleteConfirm = useCallback((record: FarmerData) => {
    if (!userIsChiefAdmin) return;
    setRecordToDelete(record);
    setIsSingleDeleteDialogOpen(true);
  }, [userIsChiefAdmin]);
  const openBulkDeleteConfirm = useCallback(() => {
    if (!userIsChiefAdmin) return;
    setIsDeleteConfirmOpen(true);
  }, [userIsChiefAdmin]);

  const handleEditSubmit = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingRecord) return;
    try {
      await update(ref(db, `farmers/${editingRecord.id}`), {
        farmerId: editForm.farmerId,
        name: editForm.name,
        gender: editForm.gender,
        idNumber: editForm.idNumber,
        phone: editForm.phone,
        county: editForm.county,
        subcounty: editForm.subcounty,
        location: editForm.location,
        cattle: Number(editForm.cattle),
        goats: Number(editForm.goats),
        sheep: Number(editForm.sheep),
        vaccinated: editForm.vaccinated,
        programme: editForm.programme
      });
      toast({ title: "Success", description: "Farmer record updated" });
      setIsEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      toast({ title: "Error", description: "Update failed", variant: "destructive" });
    }
  };

  const handleSingleDelete = async () => {
    if (!requireChiefAdmin()) return;
    if (!recordToDelete) return;
    try {
      setDeleteLoading(true);
      await remove(ref(db, `farmers/${recordToDelete.id}`));
      localStorage.removeItem(`farmers_cache_${activeProgram}`);
      toast({ title: "Success", description: "Record deleted" });
      setIsSingleDeleteDialogOpen(false);
      setRecordToDelete(null);
    } catch (error) {
      toast({ title: "Error", description: "Deletion failed", variant: "destructive" });
    } finally { setDeleteLoading(false); }
  };

  const handleDeleteMultiple = async () => {
    if (!requireChiefAdmin()) return;
    if (selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);
      const updates: { [key: string]: null } = {};
      selectedRecords.forEach(id => updates[`farmers/${id}`] = null);
      await update(ref(db), updates);
      localStorage.removeItem(`farmers_cache_${activeProgram}`);
      toast({ title: "Success", description: `${selectedRecords.length} records deleted` });
      setSelectedRecords([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Bulk delete failed", variant: "destructive" });
    } finally { setDeleteLoading(false); }
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setUploadFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!requireChiefAdmin()) return;
    if (!uploadFile) return;
    setUploadLoading(true);
    try {
      const text = await uploadFile.text();
      const isJSON = uploadFile.name.endsWith('.json');
      let parsedData: any[] = [];

      if (isJSON) {
        parsedData = JSON.parse(text);
      } else {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error("CSV file is empty or has no data rows");

        const rawHeaders = parseCSVLine(lines[0]);
        const headers = rawHeaders.map(h =>
          h.replace(/^﻿/, '').trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
        );

        const findIndex = (keys: string[]) => headers.findIndex(h => keys.some(k => h.includes(k)));

        const idxName = findIndex(['farmer name', 'name']);
        const idxGender = findIndex(['gender']);
        const idxCounty = findIndex(['county']);
        const idxSub = findIndex(['subcounty', 'sub county']);
        const idxLoc = findIndex(['location']);
        const idxCattle = findIndex(['cattle']);
        const idxSheep = findIndex(['sheep']);
        const idxIdNumber = findIndex(['id number', 'idnumber']);
        const idxPhone = findIndex(['phone']);
        const idxFarmerId = findIndex(['farmer id']);
        const idxRegDate = findIndex(['registration date', 'reg date', 'date']);
        const idxVaccinated = findIndex(['vaccinated']);
        const idxTrace = findIndex(['traceability']);
        const idxVaccines = findIndex(['vaccine']);
        const idxDewormed = findIndex(['dewormed']);
        const idxDewormingDate = findIndex(['deworming date', 'deworm date']);
        const idxAggregationGroup = findIndex(['aggregation group', 'group']);
        const idxVaccinationDate = findIndex(['vaccination date', 'vaccine date', 'vax date']);
        const idxFieldOfficer = findIndex(['field officer', 'officer', 'officer name', 'created by', 'username']);

        const idxGoatsTotal = findIndex(['goats', 'goats total', 'total goats', 'no of goats', 'number of goats', 'goats number', 'goat count', 'total goat']);
        const idxGoatsMale = findIndex(['male', 'male goats', 'male goat', 'goat male', 'goats m', 'm goats', 'goatsmale']);
        const idxGoatsFemale = findIndex(['female', 'female goats', 'female goat', 'goat female', 'goats f', 'f goats', 'goatsfemale']);

        const parseBool = (val: string) => {
          const v = (val || '').toLowerCase().trim();
          return v === 'yes' || v === 'true' || v === '1';
        };

        const valAt = (values: string[], idx: number) => (idx >= 0 && idx < values.length ? values[idx] : '').trim();

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          if (!values.some(v => v.trim() !== '')) continue;

          const obj: any = {};

          if (idxName !== -1) obj.name = valAt(values, idxName);
          if (idxGender !== -1) obj.gender = valAt(values, idxGender);
          if (idxCounty !== -1) obj.county = valAt(values, idxCounty);
          if (idxSub !== -1) obj.subcounty = valAt(values, idxSub);
          if (idxLoc !== -1) obj.location = valAt(values, idxLoc);
          if (idxCattle !== -1) obj.cattle = Number(valAt(values, idxCattle)) || 0;
          if (idxSheep !== -1) obj.sheep = Number(valAt(values, idxSheep)) || 0;
          if (idxIdNumber !== -1) obj.idNumber = valAt(values, idxIdNumber);
          if (idxPhone !== -1) obj.phone = valAt(values, idxPhone);
          if (idxFarmerId !== -1) obj.farmerId = valAt(values, idxFarmerId);
          
          let createdAtTimestamp = Date.now();

          if (idxRegDate !== -1) {
            const regDateStr = valAt(values, idxRegDate);
            obj.registrationDate = regDateStr; 
            const dateObj = new Date(regDateStr);
            if (!isNaN(dateObj.getTime())) {
              createdAtTimestamp = dateObj.getTime();
            }
          }
          obj.createdAt = createdAtTimestamp; 

          if (idxVaccinated !== -1) obj.vaccinated = parseBool(valAt(values, idxVaccinated));
          if (idxTrace !== -1) obj.traceability = parseBool(valAt(values, idxTrace));
          if (idxVaccines !== -1) {
            const raw = valAt(values, idxVaccines);
            obj.vaccines = raw ? raw.split(';').map(s => s.trim()).filter(s => s) : [];
          }

          if (idxDewormed !== -1) obj.dewormed = parseBool(valAt(values, idxDewormed));
          if (idxDewormingDate !== -1) obj.dewormingDate = valAt(values, idxDewormingDate);
          if (idxAggregationGroup !== -1) obj.aggregationGroup = valAt(values, idxAggregationGroup);
          if (idxVaccinationDate !== -1) obj.vaccinationDate = valAt(values, idxVaccinationDate);

          if (idxFieldOfficer !== -1) obj.username = valAt(values, idxFieldOfficer);

          const foundGoatsMale = idxGoatsMale > -1;
          const foundGoatsFemale = idxGoatsFemale > -1;
          const foundGoatsTotal = idxGoatsTotal > -1;

          if (foundGoatsMale || foundGoatsFemale) {
             const maleCount = foundGoatsMale ? (Number(valAt(values, idxGoatsMale)) || 0) : 0;
             const femaleCount = foundGoatsFemale ? (Number(valAt(values, idxGoatsFemale)) || 0) : 0;
             let totalGoats = foundGoatsTotal ? (Number(valAt(values, idxGoatsTotal)) || 0) : (maleCount + femaleCount);
             obj.goats = { male: maleCount, female: femaleCount, total: totalGoats };
          } else if (foundGoatsTotal) {
             const totalGoats = Number(valAt(values, idxGoatsTotal)) || 0;
             obj.goats = { total: totalGoats, male: 0, female: 0 };
          }
          parsedData.push(obj);
        }
      }

      let count = 0;
      const collectionRef = ref(db, "farmers");
      
      for (const item of parsedData) {
        await push(collectionRef, {
          ...item,
          programme: activeProgram,
          username: item.username || "Unknown"
        });
        count++;
      }

      localStorage.removeItem(`farmers_cache_${activeProgram}`);

      toast({ title: "Success", description: `Uploaded ${count} records to ${activeProgram}.` });
      setIsUploadDialogOpen(false);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Upload failed. Please check file format.", variant: "destructive" });
    } finally {
      setUploadLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredFarmers.length === 0) return;

      const headers = [
        'Farmer ID', 'Name', 'Gender', 'Phone', 'ID Number', 
        'County', 'Subcounty', 'Location', 
        'Cattle', 'Goats (Total)', 'Goats (Male)', 'Goats (Female)', 'Sheep', 
        'Vaccinated', 'Traceability', 'Vaccines', 
        'Programme', 'Field Officer', 'Created By', 'Registration Date',
        'Dewormed', 'Deworming Date', 'Vaccination Date',
        'Aggregation Group', 'Bucks Served', 'Female Breeds', 'Male Breeds',
        'Age 1-4', 'Age 5-8', 'Age 8+'
      ];

      const csvData = filteredFarmers.map(f => [
        f.farmerId, f.name, f.gender, f.phone, f.idNumber, 
        f.county, f.subcounty, f.location, 
        f.cattle, getGoatTotal(f.goats), 
        (typeof f.goats === 'object' && f.goats?.male) || 0,
        (typeof f.goats === 'object' && f.goats?.female) || 0,
        f.sheep, 
        f.vaccinated ? 'Yes' : 'No', f.traceability ? 'Yes' : 'No',
        f.vaccines.join('; '), 
        f.programme, 
        f.username, f.username, 
        formatDate(f.createdAt),
        f.dewormed ? 'Yes' : 'No',
        f.dewormingDate || '',
        f.vaccinationDate || '',
        f.aggregationGroup || '',
        f.bucksServed || '',
        f.femaleBreeds || '',
        f.maleBreeds || '',
        f.ageDistribution?.['1-4'] || '',
        f.ageDistribution?.['5-8'] || '',
        f.ageDistribution?.['8+'] || ''
      ]);

      const csvContent = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `farmers_export_${activeProgram}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: "Success", description: "Data exported successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Export failed", variant: "destructive" });
    } finally { setExportLoading(false); }
  };

  const uniqueCounties = useMemo(() => [...new Set(allFarmers.map(f => f.county).filter(Boolean))], [allFarmers]);
  const uniqueSubcounties = useMemo(() => [...new Set(allFarmers.map(f => f.subcounty).filter(Boolean))], [allFarmers]);
  const uniqueLocations = useMemo(() => [...new Set(allFarmers.map(f => f.location).filter(Boolean))], [allFarmers]);
  const uniqueGenders = useMemo(() => [...new Set(allFarmers.map(f => f.gender).filter(Boolean))], [allFarmers]);
  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const StatsCard = memo(({ title, value, icon: Icon, description, color = "blue", children, maleCount, femaleCount, totalCount }: any) => (
    <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-${color}-600 to-purple-800`}></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pl-6 pb-4 flex flex-col">
        <div className="flex items-center gap-3 mb-1">
            <div className="rounded-full bg-gray-50 p-2">
                <Icon className={`h-5 w-5 text-${color}-600`} />
            </div>
            <div className="text-xl font-bold text-gray-800">{value}</div>
        </div>
        {(maleCount !== undefined && femaleCount !== undefined) ? (
          <div className="mt-3 flex items-center justify-between w-full bg-gray-50 text-xs">
             <div className="flex flex-row">
                <span className="text-gray-500">Male</span>
                <span className="font-bold text-blue-600 text-sm">{maleCount}  |  <span className="text-gray-400 font-normal">({totalCount > 0 ? Math.round((maleCount/totalCount)*100) : 0}%)</span></span>
             </div>
             <div className="h-8 w-[1px] bg-gray-100"></div>
             <div className="flex flex-row text-right">
                <span className="text-gray-500">Female</span> 
                <span className="font-bold text-pink-600 text-sm">{femaleCount} |<span className="text-gray-400 font-normal">({totalCount > 0 ? Math.round((femaleCount/totalCount)*100) : 0}%)</span></span>
             </div>
          </div>
        ) : children ? (
            children
        ) : (
            description && <p className="text-xs mt-2 bg-gray-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>
        )}
      </CardContent>
    </Card>
  ));

  return (
    <div className="space-y-6 px-2 sm:px-4 md:px-0">
      <div className="flex flex-col justify-between items-start gap-4">
        <div className="w-full md:w-auto">
          <h2 className="text-md font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Livestock Farmers
          </h2>
          <div className="flex items-center gap-2">
                       <div className="bg-blue-50 text-blue-700 border-blue-200 text-xs w-fit">
                          {activeProgram || "No Access"} PROJECT
                       </div>
                    </div>
        </div>
         
         <div className="flex flex-col md:flex-row lg:flex-row lg:flex-wrap gap-2 w-full ">
            {/* UPDATED DATE INPUTS SECTION */}
            <div className="flex flex-col md:flex-row lg:flex-row gap-2 items-center">
               
                  
                    <Input 
                        id="startDate" 
                        type="date" 
                        value={filters.startDate} 
                        onChange={(e) => handleFilterChange("startDate", e.target.value)} 
                        className="border-gray-300 focus:border-blue-500 bg-white h-10 w-full text-sm pr-10 cursor-pointer appearance-auto lg:min-w-[170px]" 
                    />
                
                    
                    <Input 
                        id="endDate" 
                        type="date" 
                        value={filters.endDate} 
                        onChange={(e) => handleFilterChange("endDate", e.target.value)} 
                        className="border-gray-300 focus:border-blue-500 bg-white h-10 w-full text-sm pr-10 cursor-pointer appearance-auto lg:min-w-[170px]" 
                    />
                
            
            
            {userIsChiefAdmin ? (
                <div className="space-y-2 w-full lg:w-[180px]">
                    <Select value={activeProgram} onValueChange={handleProgramChange} disabled={availablePrograms.length === 0}>
                        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-10 font-bold w-full">
                            <SelectValue placeholder="Select Programme" />
                        </SelectTrigger>
                        <SelectContent>
                            {availablePrograms.map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : (
                <div className="hidden lg:block w-[180px]"></div>
            )}
</div>
            <div className="flex flex-row xl:flex-row gap-2 items-center">
                <Button variant="outline" size="sm" onClick={() => setFilters({ ...filters, search: "", startDate: "", endDate: "", county: "all", subcounty: "all", gender: "all", location: "all" })} className="h-10 px-6 w-full xl:w-auto">
                    Clear Filters
                </Button>
            
          
            {selectedRecords.length > 0 && (
            <Button variant="destructive" size="sm" onClick={openBulkDeleteConfirm} disabled={deleteLoading} className="text-xs h-10">
              <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedRecords.length})
            </Button>
          )}
          {userIsChiefAdmin && (
             <>
                <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="border-green-300 text-green-700 h-10">
                    <Upload className="h-4 w-4 mr-2" /> Upload
                </Button>
                <Button onClick={handleExport} disabled={exportLoading || filteredFarmers.length === 0} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs h-10">
                <Download className="h-4 w-4 mr-2" /> Export ({filteredFarmers.length})
                </Button>
             </>
          )}
        </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
        <StatsCard 
            title="FARMERS REGISTERED" 
            value={stats.totalFarmers.toLocaleString()} 
            icon={Users} 
            color="blue"
            maleCount={stats.maleFarmers}
            femaleCount={stats.femaleFarmers}
            totalCount={stats.totalFarmers}
        />
        <StatsCard 
            title="ANIMAL CENSUS" 
            value={(stats.totalSheep+stats.totalGoats).toLocaleString()} 
            icon={Activity} 
            color="blue"
        >
            <div className="flex items-center justify-between w-full mt-3 text-xs border-t border-gray-100 pt-2">
                 <div className="flex flex-row text-left">
                    <span className="text-gray-500 font-medium">Goats</span>
                    <span className="font-bold text-purple-600">
                        {stats.totalGoats} |
                        <span className="text-gray-400 font-normal ml-1">
                            {(stats.totalSheep+stats.totalGoats) > 0 ? Math.round((stats.totalGoats/(stats.totalSheep+stats.totalGoats))*100) : 0}%
                        </span>
                    </span>
                 </div>
                 <div className="flex flex-row text-right">
                    <span className="text-gray-500 font-medium">Sheep</span>
                    <span className="font-bold text-indigo-600">
                        {stats.totalSheep} |
                        <span className="text-gray-400 font-normal ml-1">
                            {(stats.totalSheep+stats.totalGoats) > 0 ? Math.round((stats.totalSheep/(stats.totalSheep+stats.totalGoats))*100) : 0}%
                        </span>
                    </span>
                 </div>
            </div>
        </StatsCard>
        <StatsCard 
            title="TRAINED FARMERS" 
            value={stats.totalTrainedFarmers.toLocaleString()} 
            icon={GraduationCap} 
            color="blue"
            description="Participants in training sessions"
        />
      </div>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-6 pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">County</Label>
                <Select value={filters.county} onValueChange={(value) => handleFilterChange("county", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Counties" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Counties</SelectItem>
                        {uniqueCounties.map(county => <SelectItem key={county} value={county}>{county}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Subcounty</Label>
                <Select value={filters.subcounty} onValueChange={(value) => handleFilterChange("subcounty", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Subcounties" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Subcounties</SelectItem>
                        {uniqueSubcounties.map(sub => <SelectItem key={sub} value={sub}>{sub}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Location</Label>
                <Select value={filters.location} onValueChange={(value) => handleFilterChange("location", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Locations" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Locations</SelectItem>
                        {uniqueLocations.map(loc => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Gender</Label>
                <Select value={filters.gender} onValueChange={(value) => handleFilterChange("gender", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Genders" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Genders</SelectItem>
                        {uniqueGenders.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Search</Label>
                <Input placeholder="Name, ID, Phone, Officer..." defaultValue={filters.search} onChange={(e) => handleSearchChange(e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="text-muted-foreground mt-2">Loading farmers registry...</p></div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{activeProgram ? "No records found matching your criteria" : "You do not have access to any programme data."}</div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-blue-50 text-xs">
                      <th className="py-3 px-3"><Checkbox checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0} onCheckedChange={handleSelectAll} /></th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Date</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Farmer Name</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Gender</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Phone</th>
                      <th className="py-3 px-3 font-semibold text-gray-700 hidden sm:table-cell">ID</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">County</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Subcounty</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Location</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Cattle</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Goats</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Sheep</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Vaccinated</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">PROJECT</th>
                      <th className="py-3 px-3 font-semibold text-gray-700 hidden sm:table-cell">Field Officer</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <tr key={record.id} className="border-b hover:bg-blue-50 transition-colors group">
                        <td className="py-2 px-3"><Checkbox checked={selectedRecords.includes(record.id)} onCheckedChange={() => handleSelectRecord(record.id)} /></td>
                        <td className="py-2 px-3 text-xs text-gray-500">{formatDate(record.createdAt)}</td>
                        <td className="py-2 px-3 font-medium text-sm">{record.name}</td>
                        <td className="py-2 px-3"><Badge variant={record.gender === 'Female' ? 'secondary' : 'outline'} className="text-xs">{record.gender}</Badge></td>
                        <td className="py-2 px-3 text-xs">{record.phone}</td>
                        <td className="py-2 px-3 text-xs font-mono hidden sm:table-cell">{record.idNumber}</td>
                        <td className="py-2 px-3 text-xs">{record.county}</td>
                        <td className="py-2 px-3 text-xs">{record.subcounty}</td>
                        <td className="py-2 px-3 text-xs">{record.location}</td>
                        <td className="py-2 px-3 text-xs">{record.cattle}</td>
                        <td className="py-2 px-3 text-xs font-semibold text-green-700">{getGoatTotal(record.goats)}</td>
                        <td className="py-2 px-3 text-xs font-semibold text-purple-700">{record.sheep}</td>
                        <td className="py-2 px-3">
                          {record.vaccinated ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px]">Yes</Badge> : <Badge variant="outline" className="text-gray-400 text-[10px]">No</Badge>}
                        </td>
                        <td className="py-2 px-3">
                            <Badge variant="outline" className="border-blue-200 text-blue-700 text-[10px]">{record.programme || activeProgram}</Badge>
                        </td>
                         <td className="py-2 px-3 text-xs italic text-gray-500 hidden sm:table-cell">{record.username}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:bg-green-50" onClick={() => openViewDialog(record)}><Eye className="h-3.5 w-3.5" /></Button>
                            {userIsChiefAdmin && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEditDialog(record)}><Edit className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => openSingleDeleteConfirm(record)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t bg-gray-50 gap-4">
                <div className="text-sm text-muted-foreground">{filteredFarmers.length} total records • Page {pagination.page} of {pagination.totalPages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-3xl bg-white rounded-2xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Farmer Profile Details</DialogTitle>
            <DialogDescription>Complete information for {viewingRecord?.name}</DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-4">
              <div className="col-span-1 sm:col-span-2 bg-blue-50 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                 <div className="flex items-center gap-4">
                    <div className="bg-blue-100 p-3 rounded-full"><Users className="h-6 w-6 text-blue-600" /></div>
                    <div>
                       <h3 className="font-bold text-lg">{viewingRecord.name}</h3>
                       <p className="text-sm text-gray-600">{viewingRecord.farmerId} • {viewingRecord.programme}</p>
                    </div>
                 </div>
                 <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase font-bold">Created By</p>
                    <p className="text-sm font-medium">{viewingRecord.username}</p>
                 </div>
              </div>
              <DetailRow label="County" value={viewingRecord.county} />
              <DetailRow label="Subcounty" value={viewingRecord.subcounty} />
              <DetailRow label="Location" value={viewingRecord.location} />
              <DetailRow label="Phone" value={viewingRecord.phone} />
              <DetailRow label="Gender" value={viewingRecord.gender} />
              <DetailRow label="ID Number" value={viewingRecord.idNumber || 'N/A'} />
              <DetailRow label="Registration Date" value={viewingRecord.registrationDate} />
              <div className="col-span-1 sm:col-span-2 border-t pt-4 mt-2">
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Scale className="h-4 w-4"/>Livestock Ownership</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-orange-600">{viewingRecord.cattle}</span>
                        <span className="text-xs text-gray-500 uppercase">Cattle</span>
                   </div>
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-green-600">{getGoatTotal(viewingRecord.goats)}</span>
                        <span className="text-xs text-gray-500 uppercase">Goats</span>
                   </div>
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-purple-600">{viewingRecord.sheep}</span>
                        <span className="text-xs text-gray-500 uppercase">Sheep</span>
                   </div>
                </div>
              </div>
              <div className="col-span-1 sm:col-span-2 border-t pt-4">
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Activity className="h-4 w-4"/>Health Status</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 border rounded flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">Vaccinated</p>
                            <p className="font-medium">{viewingRecord.vaccinated ? 'Yes' : 'No'}</p>
                        </div>
                        <ShieldCheck className={`h-5 w-5 ${viewingRecord.vaccinated ? 'text-green-600' : 'text-gray-300'}`} />
                    </div>
                    {viewingRecord.vaccinationDate && (
                         <div className="p-4 border rounded">
                            <p className="text-xs text-gray-500 font-bold uppercase">Vaccination Date</p>
                            <p className="font-medium">{viewingRecord.vaccinationDate}</p>
                        </div>
                    )}
                    <div className="p-4 border rounded flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">Dewormed</p>
                            <p className="font-medium">{viewingRecord.dewormed ? 'Yes' : 'No'}</p>
                        </div>
                        <ShieldCheck className={`h-5 w-5 ${viewingRecord.dewormed ? 'text-blue-600' : 'text-gray-300'}`} />
                    </div>
                    {viewingRecord.dewormingDate && (
                        <div className="p-4 border rounded">
                            <p className="text-xs text-gray-500 font-bold uppercase">Deworming Date</p>
                            <p className="font-medium">{viewingRecord.dewormingDate}</p>
                        </div>
                    )}
                </div>
              </div>
              <div className="col-span-1 sm:col-span-2 border-t pt-4">
                 <div className="p-4 border rounded flex items-center gap-3">
                   <Activity className={`h-5 w-5 ${viewingRecord.traceability ? 'text-blue-600' : 'text-gray-300'}`} />
                   <div>
                     <p className="text-xs text-gray-500 font-bold uppercase">Traceability</p>
                     <p className="font-medium">{viewingRecord.traceability ? 'Enabled' : 'Disabled'}</p>
                   </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setIsViewDialogOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Farmer Details</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
                <Label>Farmer ID</Label>
                <Input value={editForm.farmerId} onChange={e => setEditForm({...editForm, farmerId: e.target.value})} />
            </div>
            <div className="space-y-2">
                <Label>Name</Label>
                <Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
            </div>
            <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={editForm.gender} onValueChange={(val) => setEditForm({...editForm, gender: val})}>
                    <SelectTrigger><SelectValue placeholder="Select Gender" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
            </div>
            <div className="space-y-2 sm:col-span-2">
                <Label>ID Number</Label>
                <Input value={editForm.idNumber} onChange={e => setEditForm({...editForm, idNumber: e.target.value})} />
            </div>
            <div className="space-y-2">
                <Label>County</Label>
                <Input value={editForm.county} onChange={e => setEditForm({...editForm, county: e.target.value})} />
            </div>
            <div className="space-y-2">
                <Label>Subcounty</Label>
                <Input value={editForm.subcounty} onChange={e => setEditForm({...editForm, subcounty: e.target.value})} />
            </div>
            <div className="space-y-2 sm:col-span-2">
                <Label>Location</Label>
                <Input value={editForm.location} onChange={e => setEditForm({...editForm, location: e.target.value})} />
            </div>
            <div className="col-span-1 sm:col-span-2 my-2 border-t pt-2">
                <h4 className="text-sm font-semibold text-gray-500 uppercase">Livestock Counts</h4>
            </div>
            <div className="space-y-2">
                <Label>Cattle</Label>
                <Input type="number" value={editForm.cattle} onChange={e => setEditForm({...editForm, cattle: parseInt(e.target.value) || 0})} />
            </div>
            <div className="space-y-2">
                <Label>Goats</Label>
                <Input type="number" value={editForm.goats} onChange={e => setEditForm({...editForm, goats: parseInt(e.target.value) || 0})} />
            </div>
            <div className="space-y-2">
                <Label>Sheep</Label>
                <Input type="number" value={editForm.sheep} onChange={e => setEditForm({...editForm, sheep: parseInt(e.target.value) || 0})} />
            </div>
            <div className="col-span-1 sm:col-span-2 my-2 border-t pt-2">
                <h4 className="text-sm font-semibold text-gray-500 uppercase">Status & PROJECT</h4>
            </div>
            <div className="space-y-2">
                <Label>PROJECT</Label>
                <Select value={editForm.programme} onValueChange={(val) => setEditForm({...editForm, programme: val})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {availablePrograms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex items-center gap-2 border p-3 rounded h-fit mt-6">
                <Checkbox checked={editForm.vaccinated} onCheckedChange={(c) => setEditForm({...editForm, vaccinated: !!c})} id="edit-vaccinated" />
                <Label htmlFor="edit-vaccinated" className="cursor-pointer">Vaccinated</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit} className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle>Upload Farmers Data</DialogTitle>
            <DialogDescription>
              Upload CSV or JSON file. Data will be assigned to <strong>{activeProgram}</strong> PROJECT.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input type="file" ref={fileInputRef} accept=".csv,.json" onChange={handleFileSelect} className="mb-4" />
            {uploadFile && <p className="text-sm text-gray-600">Selected: {uploadFile.name}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {setIsUploadDialogOpen(false); setUploadFile(null);}}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploadLoading}>
              {uploadLoading ? "Uploading..." : "Upload Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSingleDeleteDialogOpen} onOpenChange={setIsSingleDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] sm:w-full">
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete <strong>{recordToDelete?.name}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSingleDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSingleDelete} disabled={deleteLoading}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] sm:w-full">
          <DialogHeader><DialogTitle>Bulk Delete</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete {selectedRecords.length} selected records?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteMultiple} disabled={deleteLoading}>Delete All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DetailRow = ({ label, value }: { label: string, value: string }) => (
  <div className="flex flex-col">
    <span className="text-xs text-gray-500 font-bold uppercase">{label}</span>
    <span className="text-sm font-medium text-gray-900">{value || 'N/A'}</span>
  </div>
);

export default LivestockFarmersPage;
