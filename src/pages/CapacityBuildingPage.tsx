import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "firebase/auth"; // Import to get UID
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
import { isChiefAdmin } from "./onboardingpage";

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
  // Legacy
  Gender?: string;
  Modules?: string;
  Name?: string;
  Phone?: string;
  region?: string;
  // Note: Assuming maleFarmers and femaleFarmers might exist in DB for stats
  maleFarmers?: number;
  femaleFarmers?: number;
}

interface Filters {
  search: string;
  gender: string;
  startDate: string;
  endDate: string;
  modules: string;
  region: string;
}

interface Stats {
  totalParticipants: number;
  totalMaleFarmers: number;
  totalFemaleFarmers: number;
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
}

// --- Constants & Helpers ---
const PAGE_LIMIT = 15;

const EXPORT_HEADERS = [
  'Date Created', 'Topic/Module', 'County/Region', 'Subcounty/Location', 
  'Start Date', 'End Date', 'Total Farmers', 'Male Farmers', 'Female Farmers', 'Officer', 'Programme'
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

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(),1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() +1, 0);
  return {
    startDate: startOfMonth.toISOString().split('T')[0],
    endDate: endOfMonth.toISOString().split('T')[0]
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
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]); // Dynamic permissions
  
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
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebounce(searchValue, 300);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    gender: "all",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    modules: "all",
    region: "all"
  });

  const [stats, setStats] = useState<Stats>({
    totalParticipants: 0,
    totalMaleFarmers: 0,
    totalFemaleFarmers: 0
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
    programme: ""
  });

  // --- 1. Fetch User Permissions & Determine Available Programmes ---
  useEffect(() => {
    if (!userRole) return;

    if (isChiefAdmin(userRole)) {
      // Chief Admins see both programmes
      setAvailablePrograms(["RANGE", "KPMD"]);
      if (!activeProgram) setActiveProgram("KPMD"); // Default to KPMD
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
        
        // Auto-select the first available programme if current activeProgram is invalid or empty
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

  // --- 2. Data Fetching (Realtime with Programme Query) ---
  useEffect(() => {
    if (!activeProgram) {
        setAllRecords([]);
        setLoading(false);
        return;
    }

    setLoading(true);
    // Query specifically for active programme using index defined in rules
    const dbQuery = query(
        ref(db, "capacityBuilding"), 
        orderByChild("programme"), 
        equalTo(activeProgram)
    );

    const unsubscribe = onValue(dbQuery, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        setAllRecords([]);
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
  }, [activeProgram, toast]);

  // --- Filtering Logic ---
  useEffect(() => {
    if (allRecords.length === 0) {
      setFilteredRecords([]);
      setStats({ totalParticipants: 0, totalMaleFarmers: 0, totalFemaleFarmers: 0 });
      return;
    }

    const filtered = allRecords.filter(record => {
      // 1. Region Filter
      const recordRegion = record.county || record.region;
      if (filters.region !== "all" && recordRegion?.toLowerCase() !== filters.region.toLowerCase()) {
        return false;
      }

      // 2. Modules Filter
      const recordModules = record.topicTrained || record.Modules;
      if (filters.modules !== "all" && recordModules?.toLowerCase() !== filters.modules.toLowerCase()) {
        return false;
      }

      // 3. Date Filter
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

      // 4. Search Filter
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

    const uniqueModules = new Set(filtered.map(r => r.topicTrained || r.Modules).filter(Boolean));
    
    // Update Stats
    const totalParticipants = filtered.reduce((sum, r) => sum + (Number(r.totalFarmers) || 0), 0);
    // Using optional chaining and defaulting to 0, assuming these fields might exist in DB
    const totalMaleFarmers = filtered.reduce((sum, r) => sum + (Number((r as any).maleFarmers) || 0), 0);
    const totalFemaleFarmers = filtered.reduce((sum, r) => sum + (Number((r as any).femaleFarmers) || 0), 0);

    setStats({
      totalParticipants,
      totalMaleFarmers,
      totalFemaleFarmers
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
        gender: "all",
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
    setEditingRecord(record);
    setEditForm({
      Name: record.username || record.Name || "",
      topicTrained: record.topicTrained || record.Modules || "",
      county: record.county || record.region || "",
      subcounty: record.subcounty || record.location || "",
      startDate: record.startDate || "",
      endDate: record.endDate || "",
      totalFarmers: record.totalFarmers || 0,
      programme: record.programme || activeProgram
    });
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = async () => {
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
        programme: editForm.programme
      });
      
      toast({ title: "Success", description: "Record updated." });
      setIsEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    }
  };

  const openDeleteConfirm = () => {
    if (selectedRecords.length === 0) {
      toast({ title: "Warning", description: "No records selected", variant: "destructive" });
      return;
    }
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteMultiple = async () => {
    try {
      setDeleteLoading(true);
      const updates: { [key: string]: null } = {};
      selectedRecords.forEach(id => updates[`capacityBuilding/${id}`] = null);

      await update(ref(db), updates);
      
      toast({ title: "Success", description: `Deleted ${selectedRecords.length} records.` });
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
    try {
      await remove(ref(db, `capacityBuilding/${id}`));
      toast({ title: "Success", description: "Record deleted." });
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
  };

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
        const lines = text.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, idx) => obj[h] = values[idx]);
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
      setIsUploadDialogOpen(false);
      setUploadFile(null);
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
        formatDate(r.createdAt || r.rawTimestamp),
        r.topicTrained || r.Modules || 'N/A',
        r.county || r.region || 'N/A',
        r.subcounty || r.location || 'N/A',
        r.startDate || 'N/A',
        r.endDate || 'N/A',
        r.totalFarmers || 0,
        (r as any).maleFarmers || 0,
        (r as any).femaleFarmers || 0,
        r.fieldOfficer || r.username || 'N/A',
        r.programme || activeProgram
      ]);

      const csvContent = [EXPORT_HEADERS, ...csvData]
        .map(row => row.map(f => `"${f}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
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
                gender: "all", 
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
                      <SelectTrigger className="w-[200px] border-gray-300 focus:border-blue-500 bg-white">
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
        <StatsCard title="TOTAL PARTICIPANTS" value={stats.totalParticipants.toLocaleString()} icon={Users} description="Total attendance" />
        <StatsCard title="MALE FARMERS" value={stats.totalMaleFarmers.toLocaleString()} icon={User} description="Male attendees" />
        <StatsCard title="FEMALE FARMERS" value={stats.totalFemaleFarmers.toLocaleString()} icon={UserCircle} description="Female attendees" />
      </div>

      <Card className="shadow-lg bg-white">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
            <div className="space-y-2">
              <Label>Module/Topic</Label>
              <Select value={filters.modules} onValueChange={(v) => handleFilterChange("modules", v)}>
                <SelectTrigger><SelectValue placeholder="Select Module" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Modules</SelectItem>{uniqueModules.slice(0, 20).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} />
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-blue-100">
                    <tr>
                      <th className="p-4"><Checkbox checked={selectedRecords.length === currentPageRecords.length} onCheckedChange={handleSelectAll} /></th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Topic/Module</th>
                      <th className="p-4">County</th>
                      <th className="p-4">Sub County</th>
                      <th className="p-4">Village</th>
                      <th className="p-4">Farmers</th>
                      <th className="p-4">Officer</th>
                      <th className="p-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <tr key={record.id} className="border-b hover:bg-blue-50">
                        <td className="p-4"><Checkbox checked={selectedRecords.includes(record.id)} onCheckedChange={() => handleSelectRecord(record.id)} /></td>
                        <td className="p-4">{formatDate(record.createdAt || record.rawTimestamp)}</td>
                        <td className="p-4 font-medium">{record.topicTrained || record.Modules || 'N/A'}</td>
                        <td className="p-4">{record.county || 'N/A'}</td>
                        <td className="p-4">{record.subcounty || 'N/A'}</td>
                        <td className="p-4">{ record.location || 'N/A'}</td>
                        <td className="p-4"><Badge>{record.totalFarmers || 0}</Badge></td>
                        <td className="p-4 text-gray-600">{record.fieldOfficer || record.username || 'N/A'}</td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => { setViewingRecord(record); setIsViewDialogOpen(true); }}><Eye className="h-4 w-4" /></Button>
                            {userIsChiefAdmin && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => openEditDialog(record)}><Edit className="h-4 w-4" /></Button>
                                <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" onClick={() => handleDeleteSingle(record.id)}><Trash2 className="h-4 w-4" /></Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t flex justify-between items-center bg-gray-50">
                <span className="text-sm text-gray-600">Showing {currentPageRecords.length} of {filteredRecords.length} records</span>
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
              <div className="grid grid-cols-2 gap-4"><div><Label>Topic</Label><p>{viewingRecord.topicTrained || viewingRecord.Modules}</p></div><div><Label>Date</Label><p>{formatDate(viewingRecord.createdAt)}</p></div></div>
              <div className="grid grid-cols-2 gap-4"><div><Label>Region</Label><p>{viewingRecord.county}</p></div><div><Label>Location</Label><p>{viewingRecord.subcounty}</p></div></div>
              <div className="bg-gray-50 p-4 rounded"><Label>Details</Label><p className="text-sm mt-1">{viewingRecord.totalFarmers} farmers trained by {viewingRecord.fieldOfficer}.</p></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Session</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
             <div className="grid grid-cols-2 gap-4">
                <div><Label>Officer Name</Label><Input value={editForm.Name} onChange={e => setEditForm({...editForm, Name: e.target.value})} /></div>
                <div><Label>Topic</Label><Input value={editForm.topicTrained} onChange={e => setEditForm({...editForm, topicTrained: e.target.value})} /></div>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div><Label>Region (County)</Label><Input value={editForm.county} onChange={e => setEditForm({...editForm, county: e.target.value})} /></div>
                <div><Label>Location (Subcounty)</Label><Input value={editForm.subcounty} onChange={e => setEditForm({...editForm, subcounty: e.target.value})} /></div>
             </div>
             <div className="grid grid-cols-2 gap-4">
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