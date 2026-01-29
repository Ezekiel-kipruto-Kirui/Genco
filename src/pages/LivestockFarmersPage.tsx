import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "firebase/auth"; // Import getAuth to access UID
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
import { Download, Users, MapPin, Eye, Calendar, Scale, Phone, CreditCard, Edit, Trash2, ShieldCheck, Activity, ChevronRight, Upload } from "lucide-react"; // Added Upload icon
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";

// --- Types ---

interface AgeDistribution {
  "1-4"?: number;
  "5-8"?: number;
  "8+"?: number;
}

interface GoatsData {
  female?: number;
  male?: number;
  total: number;
}

interface FarmerData {
  id: string;
  createdAt: number | string;
  farmerId: string;
  name: string;
  gender: string;
  idNumber?: string;
  phone: string;
  county: string; // Renamed from county to county to match JSON
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
  // Additional fields from JSON
  aggregationGroup?: string;
  bucksServed?: string;
  femaleBreeds?: string;
  maleBreeds?: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  county: string;
  subcounty: string;
  gender: string;
}

interface Stats {
  totalFarmers: number;
  totalGoats: number;
  totalSheep: number;
  totalCattle: number;
  vaccinatedCount: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  name: string;
  gender: string;
  idNumber: string;
  phone: string;
  county: string;
  subcounty: string;
  location: string;
  vaccinated: boolean;
  traceability: boolean;
  vaccines: string;
  programme: string;
}

// --- Constants ---
const PAGE_LIMIT = 15;

// --- Helper Functions ---

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
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: startOfMonth.toISOString().split('T')[0],
    endDate: endOfMonth.toISOString().split('T')[0]
  };
};

const getGoatTotal = (goats: any): number => {
  if (typeof goats === 'number') return goats;
  if (typeof goats === 'object' && goats !== null && typeof goats.total === 'number') return goats.total;
  return 0;
};

// --- Main Component ---

const LivestockFarmersPage = () => {
  const { user, userRole } = useAuth(); // Destructure user object to get UID
  const { toast } = useToast();
  
  // State
  const [allFarmers, setAllFarmers] = useState<FarmerData[]>([]);
  const [filteredFarmers, setFilteredFarmers] = useState<FarmerData[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]); // Dynamic list
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  
  // Upload State
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Dialog States
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSingleDeleteDialogOpen, setIsSingleDeleteDialogOpen] = useState(false);
  
  // Current Action Data
  const [viewingRecord, setViewingRecord] = useState<FarmerData | null>(null);
  const [editingRecord, setEditingRecord] = useState<FarmerData | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<FarmerData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  const currentMonth = useMemo(getCurrentMonthDates, []);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Filters
  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    county: "all",
    subcounty: "all",
    gender: "all"
  });

  const [stats, setStats] = useState<Stats>({
    totalFarmers: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    vaccinatedCount: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    gender: "",
    idNumber: "",
    phone: "",
    county: "",
    subcounty: "",
    location: "",
    vaccinated: false,
    traceability: false,
    vaccines: "",
    programme: ""
  });

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);

  // --- 1. Fetch User Permissions & Determine Available Programmes ---
  useEffect(() => {
    if (isChiefAdmin(userRole)) {
      // Chief Admins see both programmes
      setAvailablePrograms(["RANGE", "KPMD"]);
      if (!activeProgram) setActiveProgram("RANGE"); // Default to RANGE if nothing selected
      return;
    }

    // For other roles, fetch specific permissions from DB
    const auth = getAuth();
    const uid = auth.currentUser?.uid;
    
    if (!uid) return;

    const userRef = ref(db, `users/${uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.allowedProgrammes) {
        // Extract keys where value is true
        const programs = Object.keys(data.allowedProgrammes).filter(
          key => data.allowedProgrammes[key] === true
        );
        setAvailablePrograms(programs);
        
        // Auto-select the first available programme if current activeProgram is invalid
        if (programs.length > 0 && !programs.includes(activeProgram)) {
          setActiveProgram(programs[0]);
        } else if (programs.length === 0) {
            // User has no programmes assigned
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
    // Query specifically for the active programme using the index defined in rules
    const farmersQuery = query(
      ref(db, 'farmers'), 
      orderByChild('programme'), 
      equalTo(activeProgram)
    );

    const unsubscribe = onValue(farmersQuery, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        setAllFarmers([]);
        setLoading(false);
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
          county: item.county || item.county || '', // Handle camelCase/PascalCase
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
          // Additional fields
          aggregationGroup: item.aggregationGroup || '',
          bucksServed: item.bucksServed || '0',
          femaleBreeds: item.femaleBreeds || '0',
          maleBreeds: item.maleBreeds || '0'
        };
      });

      farmersList.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
      setAllFarmers(farmersList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching farmers data:", error);
      toast({ title: "Error", description: "Failed to load farmers data", variant: "destructive" });
      setLoading(false);
    });

    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram, toast]);

  // --- Filtering Logic ---
  useEffect(() => {
    if (allFarmers.length === 0) {
      setFilteredFarmers([]);
      setStats({ totalFarmers: 0, totalGoats: 0, totalSheep: 0, totalCattle: 0, vaccinatedCount: 0 });
      return;
    }

    let filtered = allFarmers.filter(record => {
      // County Filter
      if (filters.county !== "all" && record.county?.toLowerCase() !== filters.county.toLowerCase()) return false;
      // Subcounty Filter
      if (filters.subcounty !== "all" && record.subcounty?.toLowerCase() !== filters.subcounty.toLowerCase()) return false;
      // Gender Filter
      if (filters.gender !== "all" && record.gender?.toLowerCase() !== filters.gender.toLowerCase()) return false;

      // Date Filter
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

      // Search Filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = [
          record.name, record.farmerId, record.location, record.county, record.idNumber, record.phone
        ].some(field => field?.toLowerCase().includes(searchTerm));
        if (!searchMatch) return false;
      }

      return true;
    });

    setFilteredFarmers(filtered);
    
    // Calculate Stats
    const totalFarmers = filtered.length;
    const totalGoats = filtered.reduce((sum, f) => sum + getGoatTotal(f.goats), 0);
    const totalSheep = filtered.reduce((sum, f) => sum + (Number(f.sheep) || 0), 0);
    const totalCattle = filtered.reduce((sum, f) => sum + (Number(f.cattle) || 0), 0);
    const vaccinatedCount = filtered.filter(f => f.vaccinated).length;

    setStats({ totalFarmers, totalGoats, totalSheep, totalCattle, vaccinatedCount });

    // Update Pagination
    const totalPages = Math.ceil(filtered.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination(prev => ({
      ...prev, page: currentPage, totalPages, hasNext: currentPage < totalPages, hasPrev: currentPage > 1
    }));
  }, [allFarmers, filters, pagination.limit, pagination.page]);

  // --- Handlers ---
  
  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters(prev => ({ 
        ...prev, 
        search: "", 
        startDate: currentMonth.startDate, 
        endDate: currentMonth.endDate, 
        county: "all", 
        subcounty: "all", 
        gender: "all" 
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
    setEditingRecord(record);
    setEditForm({
      name: record.name, gender: record.gender, idNumber: record.idNumber, phone: record.phone,
      county: record.county, subcounty: record.subcounty, location: record.location,
      vaccinated: record.vaccinated, traceability: record.traceability,
      vaccines: record.vaccines.join(', '), programme: record.programme
    });
    setIsEditDialogOpen(true);
  }, []);
  const openSingleDeleteConfirm = useCallback((record: FarmerData) => { setRecordToDelete(record); setIsSingleDeleteDialogOpen(true); }, []);
  const openBulkDeleteConfirm = useCallback(() => { setIsDeleteConfirmOpen(true); }, []);

  const handleEditSubmit = async () => {
    if (!editingRecord) return;
    try {
      await update(ref(db, `farmers/${editingRecord.id}`), {
        name: editForm.name, gender: editForm.gender, idNumber: editForm.idNumber, phone: editForm.phone,
        county: editForm.county, subcounty: editForm.subcounty, location: editForm.location,
        vaccinated: editForm.vaccinated, traceability: editForm.traceability,
        vaccines: editForm.vaccines.split(',').map(s => s.trim()).filter(s => s),
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
    if (!recordToDelete) return;
    try {
      setDeleteLoading(true);
      await remove(ref(db, `farmers/${recordToDelete.id}`));
      toast({ title: "Success", description: "Record deleted" });
      setIsSingleDeleteDialogOpen(false);
      setRecordToDelete(null);
    } catch (error) {
      toast({ title: "Error", description: "Deletion failed", variant: "destructive" });
    } finally { setDeleteLoading(false); }
  };

  const handleDeleteMultiple = async () => {
    if (selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);
      const updates: { [key: string]: null } = {};
      selectedRecords.forEach(id => updates[`farmers/${id}`] = null);
      await update(ref(db), updates);
      toast({ title: "Success", description: `${selectedRecords.length} records deleted` });
      setSelectedRecords([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Bulk delete failed", variant: "destructive" });
    } finally { setDeleteLoading(false); }
  };

  // --- Upload Functionality ---
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setUploadFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadLoading(true);
    try {
      const text = await uploadFile.text();
      const isJSON = uploadFile.name.endsWith('.json');
      let parsedData: any[] = [];

      if (isJSON) {
        parsedData = JSON.parse(text);
      } else {
        // CSV Parsing
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) throw new Error("CSV file is empty or has no data rows");
        
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '')); // Basic header cleaning
        const lowerHeaders = headers.map(h => h.toLowerCase());

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          const obj: any = {};
          
          headers.forEach((h, idx) => {
            // Map CSV headers to JSON keys
            const val = values[idx];
            const lKey = h.toLowerCase();
            
            if (lKey.includes('name')) obj.name = val;
            if (lKey.includes('gender')) obj.gender = val;
            if (lKey.includes('county')) obj.county = val;
            if (lKey.includes('subcounty') || lKey.includes('sub county')) obj.subcounty = val;
            if (lKey.includes('location')) obj.location = val;
            if (lKey.includes('cattle')) obj.cattle = Number(val) || 0;
            if (lKey.includes('sheep')) obj.sheep = Number(val) || 0;
            if (lKey.includes('id') && lKey.includes('number')) obj.idNumber = val;
            if (lKey.includes('phone')) obj.phone = val;
            if (lKey.includes('farmer') && lKey.includes('id')) obj.farmerId = val;
            if (lKey.includes('registration') && lKey.includes('date')) obj.registrationDate = val;
            if (lKey.includes('vaccinated')) {
               obj.vaccinated = val.toLowerCase() === 'yes' || val === 'true';
            }
            if (lKey.includes('traceability')) {
               obj.traceability = val.toLowerCase() === 'yes' || val === 'true';
            }
            if (lKey.includes('vaccine')) {
               obj.vaccines = val.split(';').map(s => s.trim()).filter(s => s);
            }
          });

          // Handle Goats Structure (Total, Male, Female)
          const goatsTotal = headers.findIndex(h => h.toLowerCase() === 'goats' || h.toLowerCase() === 'goats (total)');
          const goatsMale = headers.findIndex(h => h.toLowerCase() === 'goats male' || h.toLowerCase() === 'goats(male)');
          const goatsFemale = headers.findIndex(h => h.toLowerCase() === 'goats female' || h.toLowerCase() === 'goats(female)');
          
          if (goatsTotal > -1) {
             obj.goats = { total: Number(values[goatsTotal]) || 0, male: 0, female: 0 };
          }
          if (goatsMale > -1 && goatsFemale > -1) {
             obj.goats = { 
                male: Number(values[goatsMale]) || 0, 
                female: Number(values[goatsFemale]) || 0, 
                total: (Number(values[goatsMale]) || 0) + (Number(values[goatsFemale]) || 0)
             };
          }

          parsedData.push(obj);
        }
      }

      let count = 0;
      const collectionRef = ref(db, "farmers");
      
      for (const item of parsedData) {
        // Construct the payload exactly as Firebase expects it
        await push(collectionRef, {
          ...item,
          programme: activeProgram, // Force active programme
          createdAt: Date.now(), // Set timestamp
          username: user?.displayName || user?.email || "Admin" // Set creator
        });
        count++;
      }

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

      const headers = ['Farmer ID', 'Name', 'Gender', 'Phone', 'ID Number', 'County', 'Subcounty', 'Cattle', 'Goats (Total)', 'Sheep', 'Vaccinated', 'Traceability', 'Vaccines', 'Programme', 'Created By', 'Registration Date'];
      const csvData = filteredFarmers.map(f => [
        f.farmerId, f.name, f.gender, f.phone, f.idNumber, f.county, f.subcounty, f.cattle,
        getGoatTotal(f.goats), f.sheep, f.vaccinated ? 'Yes' : 'No', f.traceability ? 'Yes' : 'No',
        f.vaccines.join('; '), f.programme, f.username, formatDate(f.createdAt)
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
  const uniqueGenders = useMemo(() => [...new Set(allFarmers.map(f => f.gender).filter(Boolean))], [allFarmers]);
  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const StatsCard = memo(({ title, value, icon: Icon, description, color = "blue" }: any) => (
    <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-${color}-600 to-purple-800`}></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pl-6 pb-4 flex flex-row">
        <div className="mr-2 rounded-full">
          <Icon className={`h-8 w-8 text-${color}-600`} />
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-800 mb-2">{value}</div>
          {description && <p className="text-xs mt-2 bg-gray-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>}
        </div>
      </CardContent>
    </Card>
  ));

  return (
    <div className="space-y-6">
      <div className="flex md:flex-row flex-col justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Livestock Farmers Registry
          </h2>
          <div className="flex items-center gap-2 text-sm text-gray-600">
             {activeProgram && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-bold px-3 py-1">{activeProgram} PROGRAMME</Badge>}
          </div>
        </div>
         
         <div className="flex flex-wrap md:flex-nowrap gap-4 items-end justify-between w-full md:w-auto">
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4 flex-1">
                <div className="space-y-2">
                    <Input id="startDate" type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9" />
                </div>
                <div className="space-y-2">
                    <Input id="endDate" type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9" />
                </div>
            </div>
            
            {/* Programme Selector - Hidden for non-chiefs */}
            {userIsChiefAdmin ? (
                <div className="space-y-2 w-[180px]">
                    <Select value={activeProgram} onValueChange={handleProgramChange} disabled={availablePrograms.length === 0}>
                        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9 font-bold">
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
                <div className="w-[180px]"></div> // Spacer
            )}

            <Button variant="outline" size="sm" onClick={() => setFilters({ ...filters, search: "", startDate: "", endDate: "", county: "all", subcounty: "all", gender: "all" })} className="h-9 px-6">
                Clear Filters
            </Button>
          </div>
          
        <div className="flex flex-wrap gap-2">
          {selectedRecords.length > 0 && (
            <Button variant="destructive" size="sm" onClick={openBulkDeleteConfirm} disabled={deleteLoading} className="text-xs">
              <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedRecords.length})
            </Button>
          )}
          {userIsChiefAdmin && (
             <>
                <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="border-green-300 text-green-700">
                    <Upload className="h-4 w-4 mr-2" /> Upload
                </Button>
                <Button onClick={handleExport} disabled={exportLoading || filteredFarmers.length === 0} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs">
                <Download className="h-4 w-4 mr-2" /> Export ({filteredFarmers.length})
                </Button>
             </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard title="FARMERS REGISTERED" value={stats.totalFarmers.toLocaleString()} icon={Users} description="Registered farmers" color="blue" />
        <StatsCard title="ANIMAL CENSUS" value={(stats.totalSheep+stats.totalGoats).toLocaleString()} icon={Activity} description={"Sheep: "+stats.totalSheep.toLocaleString()+" "+"Goats: "+stats.totalGoats.toLocaleString()} color="purple" />
        <StatsCard title="TRAINED FARMERS" value={stats.vaccinatedCount.toLocaleString()} icon={ShieldCheck} description="Farmers with vaccination records" color="green" />
      </div>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-6 pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">County</Label>
                <Select value={filters.county} onValueChange={(value) => handleFilterChange("county", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="Select County" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Counties</SelectItem>
                        {uniqueCounties.map(county => <SelectItem key={county} value={county}>{county}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Subcounty</Label>
                <Select value={filters.subcounty} onValueChange={(value) => handleFilterChange("subcounty", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="Select Subcounty" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Subcounties</SelectItem>
                        {uniqueSubcounties.map(sub => <SelectItem key={sub} value={sub}>{sub}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Gender</Label>
                <Select value={filters.gender} onValueChange={(value) => handleFilterChange("gender", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="Select Gender" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Genders</SelectItem>
                        {uniqueGenders.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Search</Label>
                <Input placeholder="Name, ID, Phone..." defaultValue={filters.search} onChange={(e) => handleSearchChange(e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9" />
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
                      <th className="py-3 px-3 font-semibold text-gray-700">ID</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">County</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Subcounty</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Location</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Cattle</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Goats</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Sheep</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Vaccinated</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Programme</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Created By</th>
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
                        <td className="py-2 px-3 text-xs font-mono">{record.idNumber}</td>
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
                         <td className="py-2 px-3 text-xs italic text-gray-500">{record.username}</td>
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

              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
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
        <DialogContent className="sm:max-w-3xl bg-white rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Farmer Profile Details</DialogTitle>
            <DialogDescription>Complete information for {viewingRecord?.name}</DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="col-span-2 bg-blue-50 p-4 rounded-lg flex items-center justify-between">
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
              <DetailRow label="Phone" value={viewingRecord.phone} />
              <DetailRow label="Gender" value={viewingRecord.gender} />
              <DetailRow label="ID Number" value={viewingRecord.idNumber || 'N/A'} />
              <DetailRow label="Registration Date" value={viewingRecord.registrationDate} />
              
              <div className="col-span-2 border-t pt-4 mt-2">
                <h4 className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Scale className="h-4 w-4"/>Livestock Ownership</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-orange-600">{viewingRecord.cattle}</span>
                        <span className="text-xs text-gray-500 uppercase">Cattle</span>
                   </div>
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-green-600">{getGoatTotal(viewingRecord.goats)}</span>
                        <span className="text-xs text-gray-500 uppercase">Goats</span>
                        {typeof viewingRecord.goats === 'object' && viewingRecord.goats.total && (
                            <div className="text-[10px] text-gray-400 mt-1">
                                {viewingRecord.goats.male}M / {viewingRecord.goats.female}F
                            </div>
                        )}
                   </div>
                   <div className="bg-gray-50 p-4 rounded text-center border">
                        <span className="block font-bold text-2xl text-purple-600">{viewingRecord.sheep}</span>
                        <span className="text-xs text-gray-500 uppercase">Sheep</span>
                   </div>
                </div>

                {viewingRecord.ageDistribution && Object.keys(viewingRecord.ageDistribution).length > 0 && (
                    <div className="mt-4 bg-gray-50 p-4 rounded border">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Age Distribution</p>
                        <div className="flex gap-4">
                            {Object.entries(viewingRecord.ageDistribution).map(([key, val]) => (
                                <div key={key} className="text-sm">
                                    <span className="font-bold text-gray-700">{val}</span> <span className="text-gray-400">({key})</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-4 border-t pt-4">
                <div className="p-4 border rounded flex flex-col gap-2">
                   <div className="flex items-center gap-3">
                       <ShieldCheck className={`h-5 w-5 ${viewingRecord.vaccinated ? 'text-green-600' : 'text-gray-300'}`} />
                       <div>
                         <p className="text-xs text-gray-500 font-bold uppercase">Vaccination Status</p>
                         <p className="font-medium">{viewingRecord.vaccinated ? 'Vaccinated' : 'Not Vaccinated'}</p>
                       </div>
                   </div>
                   {viewingRecord.vaccines && viewingRecord.vaccines.length > 0 && (
                       <div className="ml-8 flex flex-wrap gap-2">
                           {viewingRecord.vaccines.map(v => <Badge key={v} variant="secondary" className="text-xs">{v}</Badge>)}
                       </div>
                   )}
                </div>
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
        <DialogContent className="sm:max-w-lg bg-white rounded-2xl">
          <DialogHeader><DialogTitle>Edit Farmer Details</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name</Label><Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>County</Label><Input value={editForm.county} onChange={e => setEditForm({...editForm, county: e.target.value})} /></div>
              <div className="space-y-2"><Label>Subcounty</Label><Input value={editForm.subcounty} onChange={e => setEditForm({...editForm, subcounty: e.target.value})} /></div>
            </div>
            <div className="space-y-2"><Label>Programme</Label>
                <Select value={editForm.programme} onValueChange={(val) => setEditForm({...editForm, programme: val})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {availablePrograms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2"><Label>Vaccines (Comma separated)</Label><Input placeholder="e.g. PPR, Anthrax" value={editForm.vaccines} onChange={e => setEditForm({...editForm, vaccines: e.target.value})} /></div>
            <div className="flex gap-4 items-center border p-3 rounded">
                <Checkbox checked={editForm.vaccinated} onCheckedChange={(c) => setEditForm({...editForm, vaccinated: !!c})} id="edit-vaccinated" />
                <Label htmlFor="edit-vaccinated" className="cursor-pointer">Vaccinated</Label>
            </div>
            <div className="flex gap-4 items-center border p-3 rounded">
                <Checkbox checked={editForm.traceability} onCheckedChange={(c) => setEditForm({...editForm, traceability: !!c})} id="edit-trace" />
                <Label htmlFor="edit-trace" className="cursor-pointer">Enable Traceability</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit} className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Farmers Data</DialogTitle>
            <DialogDescription>
              Upload CSV or JSON file. Data will be assigned to the <strong>{activeProgram}</strong> programme.
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete <strong>{recordToDelete?.name}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSingleDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSingleDelete} disabled={deleteLoading}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
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