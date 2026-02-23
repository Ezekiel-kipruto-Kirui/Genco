import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent } from "react";
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
import { Download, Users, BookOpen, Edit, Trash2, Calendar, Eye, MapPin, GraduationCap, Upload, User, UserCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

// --- Types ---
interface TrainingRecord {
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
  
  // Manual fields (Optional)
  numberOfTrainers?: number;
  numberOfSubCounties?: number;

  // Legacy
  Gender?: string;
  Modules?: string;
  Name?: string;
  Phone?: string;
  region?: string;
  maleFarmers?: number;
  femaleFarmers?: number;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  modules: string;
  region: string;
}

interface Stats {
  totalParticipants: number;
  totalTrainers: number;      // Derived from unique officers
  totalSubCounties: number;    // Derived from unique subcounties
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  Name: string;
  topicTrained: string;
  county: string; 
  subcounty: string; 
  startDate: string;
  endDate: string;
  totalFarmers: number;
  programme: string;
  numberOfTrainers: number;
  numberOfSubCounties: number;
}

// --- Constants & Helpers ---
const PAGE_LIMIT = 15;

const EXPORT_HEADERS = [
  'Date Created', 'Topic/Module', 'County/Region', 'Subcounty/Location', 
  'Start Date', 'End Date', 'Total Farmers', 'Officers (Trainers)', 'Sub Counties', 'Officer', 'Programme'
];

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof date === 'number') return new Date(date);
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return null;
};

const formatDate = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? parsedDate.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }) : 'N/A';
};

const formatDateForExcel = (date: any): string => {
  const parsedDate = parseDate(date);
  if (!parsedDate) return "";

  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  const year = parsedDate.getFullYear();
  return `${month}/${day}/${year}`;
};

const escapeCsvCell = (value: unknown): string => {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(),1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() +1, 0);
  const formatLocalDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    startDate: formatLocalDate(startOfMonth),
    endDate: formatLocalDate(endOfMonth)
  };
};

const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// --- Main Component ---
const CapacityBuildingPage = () => {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  
  // State
  const [allRecords, setAllRecords] = useState<TrainingRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<TrainingRecord[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]); 
  
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  // UI State
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const [viewingRecord, setViewingRecord] = useState<TrainingRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<TrainingRecord | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
  const trainingCacheKey = useMemo(
    () => cacheKey("admin-page", "capacity-building", activeProgram),
    [activeProgram]
  );
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebounce(searchValue, 300);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    modules: "all",
    region: "all"
  });

  const [stats, setStats] = useState<Stats>({
    totalParticipants: 0,
    totalTrainers: 0,
    totalSubCounties: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page:1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const [editForm, setEditForm] = useState<EditForm>({
    Name: "",
    topicTrained: "",
    county: "",
    subcounty: "",
    startDate: "",
    endDate: "",
    totalFarmers: 0,
    programme: "",
    numberOfTrainers: 0,
    numberOfSubCounties: 0
  });

  // --- 1. Fetch User Permissions & Determine Available Programmes ---
  useEffect(() => {
    if (!userRole) return;

    if (isChiefAdmin(userRole)) {
      setAvailablePrograms(["RANGE", "KPMD"]);
      if (!activeProgram) setActiveProgram("KPMD");
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

  // --- 2. Data Fetching ---
  useEffect(() => {
    if (!activeProgram) {
        setAllRecords([]);
        setLoading(false);
        return;
    }

    const cachedRecords = readCachedValue<TrainingRecord[]>(trainingCacheKey);
    if (cachedRecords) {
      setAllRecords(cachedRecords);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const dbQuery = query(
        ref(db, "capacityBuilding"), 
        orderByChild("programme"), 
        equalTo(activeProgram)
    );

    const unsubscribe = onValue(dbQuery, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        setAllRecords([]);
        removeCachedValue(trainingCacheKey);
        setLoading(false);
        return;
      }

      const recordsData = Object.keys(data).map((key) => {
        const item = data[key];
        return {
          id: key,
          ...item
        };
      });

      setAllRecords(recordsData);
      writeCachedValue(trainingCacheKey, recordsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching data:", error);
      toast({
        title: "Error",
        description: "Failed to load training records.",
        variant: "destructive",
      });
      setLoading(false);
    });

    return () => {
       if(typeof unsubscribe === 'function') unsubscribe(); 
    };
  }, [activeProgram, toast, trainingCacheKey]);

  // --- Filtering Logic & Stats Calculation ---
  useEffect(() => {
    if (allRecords.length === 0) {
      setFilteredRecords([]);
      setStats({ totalParticipants: 0, totalTrainers: 0, totalSubCounties: 0 });
      return;
    }

    const filtered = allRecords.filter(record => {
      const recordRegion = record.county || record.region;
      if (filters.region !== "all" && recordRegion?.toLowerCase() !== filters.region.toLowerCase()) {
        return false;
      }

      const recordModules = record.topicTrained || record.Modules;
      if (filters.modules !== "all" && recordModules?.toLowerCase() !== filters.modules.toLowerCase()) {
        return false;
      }

      const recordDate = parseDate(record.startDate) || parseDate(record.createdAt) || parseDate(record.rawTimestamp);
      
      if (filters.startDate || filters.endDate) {
        if (recordDate) {
          const recordDateOnly = new Date(recordDate);
          recordDateOnly.setHours(0, 0, 0, 0);

          const startDate = filters.startDate ? new Date(filters.startDate) : null;
          const endDate = filters.endDate ? new Date(filters.endDate) : null;
          if (startDate) startDate.setHours(0, 0, 0, 0);
          if (endDate) endDate.setHours(23, 59, 59, 999);

          if (startDate && recordDateOnly < startDate) return false;
          if (endDate && recordDateOnly > endDate) return false;
        } else {
          return false;
        }
      }

      if (debouncedSearch) {
        const lowerTerm = debouncedSearch.toLowerCase();
        const searchable = [
          record.topicTrained, record.county, record.subcounty, 
          record.fieldOfficer, record.username, record.location
        ].filter(Boolean).join(" ").toLowerCase();
        
        if (!searchable.includes(lowerTerm)) return false;
      }

      return true;
    });

    setFilteredRecords(filtered);

    // --- CORRECTED STATS CALCULATION ---
    // Derive counts from actual string data (unique officers, unique subcounties)
    // rather than summing empty numeric fields.
    const totalParticipants = filtered.reduce((sum, r) => sum + (Number(r.totalFarmers) || 0), 0);
    
    // Count unique officers (Trainers)
    const allOfficers = filtered.map(r => r.fieldOfficer || r.username).filter(Boolean);
    const uniqueOfficersSet = new Set(allOfficers);
    const totalTrainers = uniqueOfficersSet.size;

    // Count unique subcounties
    const allSubCounties = filtered.map(r => r.subcounty).filter(Boolean);
    const uniqueSubCountiesSet = new Set(allSubCounties);
    const totalSubCounties = uniqueSubCountiesSet.size;

    setStats({
      totalParticipants,
      totalTrainers,
      totalSubCounties
    });

    const totalPages = Math.ceil(filtered.length / pagination.limit);
    setPagination(prev => ({
      ...prev,
      totalPages,
      hasNext: prev.page < totalPages,
      hasPrev: prev.page > 1
    }));

  }, [allRecords, filters, debouncedSearch, pagination.limit, pagination.page]);

  // --- Handlers ---

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters(prev => ({ 
        ...prev, 
        search: "", 
        startDate: currentMonth.startDate, 
        endDate: currentMonth.endDate, 
        modules: "all", 
        region: "all" 
    }));
    setPagination(prev => ({ ...prev, page: 1 }));
    setSelectedRecords([]);
  };

  const handleSearch = (value: string) => {
    setSearchValue(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSelectRecord = (id: string) => {
    setSelectedRecords(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    const currentPageIds = getCurrentPageRecords().map(r => r.id);
    setSelectedRecords(prev => (prev.length === currentPageIds.length && currentPageIds.length > 0) ? [] : currentPageIds);
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => {
      const totalPages = Math.ceil(filteredRecords.length / prev.limit);
      const safePage = Math.max(1, Math.min(newPage, totalPages));
      return { ...prev, page: safePage, hasNext: safePage < totalPages, hasPrev: safePage > 1 };
    });
  };

  const getCurrentPageRecords = () => {
    const start = (pagination.page - 1) * pagination.limit;
    return filteredRecords.slice(start, start + pagination.limit);
  };

  const openEditDialog = (record: TrainingRecord) => {
    if (!userIsChiefAdmin) return;
    setEditingRecord(record);
    setEditForm({
      Name: record.username || record.Name || "",
      topicTrained: record.topicTrained || record.Modules || "",
      county: record.county || record.region || "",
      subcounty: record.subcounty || record.location || "",
      startDate: record.startDate || "",
      endDate: record.endDate || "",
      totalFarmers: record.totalFarmers || 0,
      programme: record.programme || activeProgram,
      numberOfTrainers: record.numberOfTrainers || 0,
      numberOfSubCounties: record.numberOfSubCounties || 0
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingRecord) return;
    try {
      await update(ref(db, `capacityBuilding/${editingRecord.id}`), {
        username: editForm.Name,
        topicTrained: editForm.topicTrained,
        county: editForm.county,
        subcounty: editForm.subcounty,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        totalFarmers: Number(editForm.totalFarmers),
        programme: editForm.programme,
        numberOfTrainers: Number(editForm.numberOfTrainers),
        numberOfSubCounties: Number(editForm.numberOfSubCounties)
      });
      
      toast({ title: "Success", description: "Record updated." });
      removeCachedValue(trainingCacheKey);
      setIsEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    }
  };

  const openDeleteConfirm = () => {
    if (!requireChiefAdmin()) return;
    if (selectedRecords.length === 0) {
      toast({ title: "Warning", description: "No records selected", variant: "destructive" });
      return;
    }
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteMultiple = async () => {
    if (!requireChiefAdmin()) return;
    try {
      setDeleteLoading(true);
      const updates: { [key: string]: null } = {};
      selectedRecords.forEach(id => updates[`capacityBuilding/${id}`] = null);

      await update(ref(db), updates);
      
      toast({ title: "Success", description: `Deleted ${selectedRecords.length} records.` });
      removeCachedValue(trainingCacheKey);
      setSelectedRecords([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    if (!requireChiefAdmin()) return;
    try {
      await remove(ref(db, `capacityBuilding/${id}`));
      toast({ title: "Success", description: "Record deleted." });
      removeCachedValue(trainingCacheKey);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
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
        const headers = rawHeaders.map(h => h.trim());
        const cleanHeaders = headers.map(h =>
          h
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase()
            .replace(/\(.*?\)/g, '')
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\s+/g, ' ')
        );

        const findIndex = (keys: string[]) =>
          cleanHeaders.findIndex(h => keys.some(k => h.includes(k)));

        const idxTopic = findIndex(['topic trained', 'topic', 'module', 'modules', 'training']);
        const idxCounty = findIndex(['county', 'region']);
        const idxSub = findIndex(['subcounty', 'sub county', 'location', 'ward']);
        const idxStart = findIndex(['start date', 'start']);
        const idxEnd = findIndex(['end date', 'end']);
        const idxTotal = findIndex(['total farmers', 'farmers', 'participants', 'number of farmers', 'no of farmers']);
        const idxOfficer = findIndex(['field officer', 'trainer', 'facilitator', 'officer', 'username']);

        const valAt = (values: string[], idx: number) => (idx >= 0 && idx < values.length ? values[idx] : '').trim();

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          if (!values.some(v => v.trim() !== '')) continue;

          const obj: any = {};

          headers.forEach((h, idx) => {
            obj[h] = values[idx] !== undefined ? values[idx].trim() : '';
          });

          if (idxTopic !== -1) obj.topicTrained = valAt(values, idxTopic);
          if (idxCounty !== -1) obj.county = valAt(values, idxCounty);
          if (idxSub !== -1) obj.subcounty = valAt(values, idxSub);
          if (idxStart !== -1) obj.startDate = valAt(values, idxStart);
          if (idxEnd !== -1) obj.endDate = valAt(values, idxEnd);
          if (idxTotal !== -1) obj.totalFarmers = Number(valAt(values, idxTotal)) || 0;
          if (idxOfficer !== -1) obj.fieldOfficer = valAt(values, idxOfficer);

          parsedData.push(obj);
        }
      }

      let count = 0;
      const collectionRef = ref(db, "capacityBuilding");
      
      for (const item of parsedData) {
        await push(collectionRef, {
          ...item,
          programme: activeProgram, 
          createdAt: new Date().toISOString(),
          rawTimestamp: Date.now()
        });
        count++;
      }

      toast({ title: "Success", description: `Uploaded ${count} records to ${activeProgram}.` });
      removeCachedValue(trainingCacheKey);
      setIsUploadDialogOpen(false);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Invalid file format", variant: "destructive" });
    } finally {
      setUploadLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredRecords.length === 0) return;

      const csvData = filteredRecords.map(r => [
        formatDateForExcel(r.createdAt || r.rawTimestamp),
        r.topicTrained || r.Modules || 'N/A',
        r.county || r.region || 'N/A',
        r.subcounty || r.location || 'N/A',
        formatDateForExcel(r.startDate),
        formatDateForExcel(r.endDate),
        r.totalFarmers || 0,
        r.fieldOfficer || r.username || 'N/A', // Exporting Officer name instead of count
        r.subcounty || 'N/A', // Exporting Subcounty name instead of count
        r.fieldOfficer || r.username || 'N/A',
        r.programme || activeProgram
      ]);

      const dateColumns = new Set([0, 4, 5]);
      const csvContent = [
        EXPORT_HEADERS.map(escapeCsvCell).join(','),
        ...csvData.map(row =>
          row
            .map((field, index) => (dateColumns.has(index) ? String(field ?? "") : escapeCsvCell(field)))
            .join(',')
        ),
      ].join('\n');

      const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capacity-building-${activeProgram}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Export failed", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const uniqueRegions = useMemo(() => [...new Set(allRecords.map(r => r.county || r.region).filter(Boolean))], [allRecords]);
  const uniqueModules = useMemo(() => [...new Set(allRecords.map(r => r.topicTrained || r.Modules).filter(Boolean))], [allRecords]);
  const currentPageRecords = useMemo(getCurrentPageRecords, [filteredRecords, pagination.page, pagination.limit]);

  const StatsCard = ({ title, value, icon: Icon, description, children }: any) => (
    <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-600"></div>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pl-6 pb-4 flex flex-row">
        <div className="mr-2 rounded-full">
          <Icon className="h-8 w-8 text-blue-600" />
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-900 mb-2">{value}</div>
          {children}
          {description && <p className="text-xs text-slate-600 mt-2 bg-slate-50 px-2 py-1 rounded border border-slate-100">{description}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Capacity Building
          </h2>
          <div className="flex items-center gap-2">
             <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-bold px-3 py-1 w-fit">
                {activeProgram || "No Access"} PROGRAMME
             </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {selectedRecords.length > 0 && userIsChiefAdmin && (
            <Button variant="destructive" size="sm" onClick={openDeleteConfirm} disabled={deleteLoading}>
              <Trash2 className="h-4 w-4 mr-2" /> Delete ({selectedRecords.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { 
             setFilters({ 
                search: "", 
                startDate: "", 
                endDate: "", 
                modules: "all", 
                region: "all" 
             }); 
             setPagination({...pagination, page: 1}); 
          }}>
            Clear Filters
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setFilters({...filters, ...currentMonth}); }}>
            This Month
          </Button>
          {userIsChiefAdmin && (
            <>
               {/* Programme Selector - ONLY Visible to Chief Admin */}
               <div className="flex justify-end">
                  <Select value={activeProgram} onValueChange={handleProgramChange}>
                      <SelectTrigger className="w-full sm:w-[200px] border-gray-300 focus:border-blue-500 bg-white">
                          <SelectValue placeholder="Select Programme" />
                      </SelectTrigger>
                      <SelectContent>
                          {availablePrograms.map(p => (
                              <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                      </SelectContent>
                  </Select>
               </div>
               <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="border-green-300 text-green-700">
                <Upload className="h-4 w-4 mr-2" /> Upload
              </Button>
              <Button onClick={handleExport} disabled={exportLoading || filteredRecords.length === 0} className="bg-gradient-to-r from-blue-800 to-purple-600 text-white">
                <Download className="h-4 w-4 mr-2" /> Export ({filteredRecords.length})
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard title="TOTAL PARTICIPANTS" value={stats.totalParticipants.toLocaleString()} icon={Users} description="Total farmers trained" />
        <StatsCard title="TOTAL OFFICERS (TRAINERS)" value={stats.totalTrainers.toLocaleString()} icon={User} description="Officers Involved" />
        <StatsCard title="SUB COUNTIES COVERED" value={stats.totalSubCounties.toLocaleString()} icon={MapPin} description="Sub-counties reached" />
      </div>

      <Card className="shadow-lg bg-white">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input placeholder="Topic, region, officer..." value={searchValue} onChange={(e) => handleSearch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>County</Label>
              <Select value={filters.region} onValueChange={(v) => handleFilterChange("region", v)}>
                <SelectTrigger><SelectValue placeholder="Select Region" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Counties</SelectItem>{uniqueRegions.slice(0, 20).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* <div className="space-y-2">
              <Label>Module/Topic</Label>
              <Select value={filters.modules} onValueChange={(v) => handleFilterChange("modules", v)}>
                <SelectTrigger><SelectValue placeholder="Select Module" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Modules</SelectItem>{uniqueModules.slice(0, 20).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div> */}
            <div className="space-y-2">
              <Label>Date Range</Label>
              <div className="flex gap-2">
                 <Input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="flex-1" />
                 <Input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="flex-1" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div></div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{activeProgram ? "No records found" : "You do not have access to any programme data."}</div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-blue-50 text-xs">
                      <th className="py-3 px-3">
                        <Checkbox
                          checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Date</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Topic/Module</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">County</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Sub County</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Village</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Farmers</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Officer</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <tr key={record.id} className="border-b hover:bg-blue-50 transition-colors group">
                        <td className="py-2 px-3">
                          <Checkbox checked={selectedRecords.includes(record.id)} onCheckedChange={() => handleSelectRecord(record.id)} />
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-500">{formatDate(record.createdAt || record.rawTimestamp)}</td>
                        <td className="py-2 px-3 font-medium text-sm">{record.topicTrained || record.Modules || 'N/A'}</td>
                        <td className="py-2 px-3 text-xs">{record.county || 'N/A'}</td>
                        <td className="py-2 px-3 text-xs">{record.subcounty || 'N/A'}</td>
                        <td className="py-2 px-3 text-xs">{record.location || 'N/A'}</td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="text-[10px]">{record.totalFarmers || 0}</Badge>
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-600">{record.fieldOfficer || record.username || 'N/A'}</td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-green-600 hover:bg-green-50"
                              onClick={() => { setViewingRecord(record); setIsViewDialogOpen(true); }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {userIsChiefAdmin && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-blue-600 hover:bg-blue-50"
                                  onClick={() => openEditDialog(record)}
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteSingle(record.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
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
                <span className="text-sm text-muted-foreground">{filteredRecords.length} total records • Page {pagination.page} of {pagination.totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>Previous</Button>
                  <Button size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Session Details</DialogTitle></DialogHeader>
          {viewingRecord && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><Label>Topic</Label><p>{viewingRecord.topicTrained || viewingRecord.Modules}</p></div><div><Label>Date</Label><p>{formatDate(viewingRecord.createdAt)}</p></div></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><Label>Region</Label><p>{viewingRecord.county}</p></div><div><Label>Location</Label><p>{viewingRecord.subcounty}</p></div></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div><Label>Farmers Trained</Label><p>{viewingRecord.totalFarmers}</p></div>
                 <div><Label>Officer</Label><p>{viewingRecord.fieldOfficer}</p></div>
              </div>
              <div className="bg-gray-50 p-4 rounded"><Label>Details</Label><p className="text-sm mt-1">{viewingRecord.totalFarmers} farmers trained by {viewingRecord.fieldOfficer}.</p></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Session</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label>Officer Name</Label><Input value={editForm.Name} onChange={e => setEditForm({...editForm, Name: e.target.value})} /></div>
                <div><Label>Topic</Label><Input value={editForm.topicTrained} onChange={e => setEditForm({...editForm, topicTrained: e.target.value})} /></div>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label>Region (County)</Label><Input value={editForm.county} onChange={e => setEditForm({...editForm, county: e.target.value})} /></div>
                <div><Label>Location (Subcounty)</Label><Input value={editForm.subcounty} onChange={e => setEditForm({...editForm, subcounty: e.target.value})} /></div>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><Label>Start Date</Label><Input type="date" value={editForm.startDate} onChange={e => setEditForm({...editForm, startDate: e.target.value})} /></div>
                <div><Label>End Date</Label><Input type="date" value={editForm.endDate} onChange={e => setEditForm({...editForm, endDate: e.target.value})} /></div>
             </div>
             <div><Label>Total Farmers</Label><Input type="number" value={editForm.totalFarmers} onChange={e => setEditForm({...editForm, totalFarmers: Number(e.target.value)})} /></div>
             {userIsChiefAdmin && (
                <div>
                    <Label>Programme</Label>
                    <Select value={editForm.programme} onValueChange={(val) => setEditForm({...editForm, programme: val})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{availablePrograms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
             )}
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
             <Button onClick={handleEditSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Data</DialogTitle></DialogHeader>
          <div className="py-4">
             <p className="text-sm text-gray-600 mb-2">Data will be assigned to the <strong>{activeProgram}</strong> programme.</p>
             <Input type="file" ref={fileInputRef} accept=".csv,.json" onChange={handleFileSelect} />
             {uploadFile && <p className="mt-2 text-sm text-gray-600">{uploadFile.name}</p>}
          </div>
          <DialogFooter>
             <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>Cancel</Button>
             <Button onClick={handleUpload} disabled={!uploadFile || uploadLoading}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p>Are you sure you want to delete {selectedRecords.length} records?</p>
          <DialogFooter>
             <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
             <Button variant="destructive" onClick={handleDeleteMultiple} disabled={deleteLoading}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default CapacityBuildingPage;

