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
import { Download, Eye, Calendar, FileText, Edit, Trash2, Car, Wallet, CheckCircle, XCircle, MapPin, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";

// --- Types ---

interface PerdiemItem {
  name: string;
  price: number;
}

interface RequisitionData {
  id: string;
  // Common Fields
  type: 'fuel and Service' | 'perdiem';
  status: 'pending' | 'approved' | 'rejected';
  username: string;
  name?: string;
  userName?: string;
  email?: string;
  submittedAt: string | number;
  county?: string;
  subcounty?: string;
  programme?: string;
  phoneNumber?: string;
  approvedBy?: string;
  approvedAt?: string | number;
  
  // FIX: Added createdAt and totalAmount to interface
  createdAt?: number | string;
  totalAmount?: number;

  // Fuel & Service Fields
  lastReading?: number;
  currentReading?: number;
  distanceTraveled?: number;
  fuelAmount?: number;
  fuelPurpose?: string;

  // Perdiem Fields
  tripFrom?: string;
  tripTo?: string;
  numberOfDays?: number;
  items?: PerdiemItem[]; // Matches the JSON array structure
  total?: number;
  tripPurpose?: string;
  location?: string; // Added based on provided JSON
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
}

interface Stats {
  totalRequests: number;
  pendingRequests: number;
  totalAmount: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// --- Constants ---
const PAGE_LIMIT = 10;

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === 'number') return new Date(date);
    if (typeof date === 'string') {
      // Handle formats like "26 Jan 2026" or standard ISO
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

const getOfficerName = (record: RequisitionData | null | undefined): string => {
  if (!record) return "Unknown";
  return record.name || record.userName || record.username || record.email || "Unknown";
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    startDate: formatDate(startOfMonth),
    endDate: formatDate(endOfMonth),
  };
};

// --- Main Component ---

const RequisitionsPage = () => {
  const { user, userRole, userName } = useAuth();
  const { toast } = useToast();
  
  // State
  const [allRequisitions, setAllRequisitions] = useState<RequisitionData[]>([]);
  const [filteredRequisitions, setFilteredRequisitions] = useState<RequisitionData[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>(""); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  
  // Dialog States
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<RequisitionData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  
  const currentMonth = useMemo(getCurrentMonthDates, []);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Filters
  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    type: "all",
    status: "all"
  });

  const [stats, setStats] = useState<Stats>({
    totalRequests: 0,
    pendingRequests: 0,
    totalAmount: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);

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

  // --- 2. Data Fetching (Requisitions) ---
  useEffect(() => {
    if (!activeProgram) {
        setAllRequisitions([]);
        setLoading(false);
        return;
    }

    setLoading(true);

    const reqQuery = query(
        ref(db, 'requisitions'), 
        orderByChild('programme'), 
        equalTo(activeProgram)
    );

    const unsubscribe = onValue(reqQuery, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setAllRequisitions([]);
            setLoading(false);
            return;
        }
        const records = Object.keys(data).map((key) => {
            const item = data[key];
            // Attempt to parse submittedAt, but fallback to current time if invalid
            let dateVal = item.submittedAt;
            if (typeof dateVal === 'string') {
               const d = parseDate(dateVal);
               dateVal = d ? d.getTime() : Date.now();
            } else if (typeof dateVal !== 'number') {
               dateVal = Date.now();
            }
            
            return {
                id: key,
                ...item,
                // Ensure items is an array, default to empty if null/undefined
                items: Array.isArray(item.items) ? item.items : [], 
                createdAt: dateVal, 
                totalAmount: (item.type === 'fuel and Service' ? item.fuelAmount : item.total) || 0
            };
        });
        
        // Sort by date descending
        records.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
        
        setAllRequisitions(records);
        setLoading(false);
    }, (error) => {
        console.error("Error fetching requisition data:", error);
        toast({ title: "Error", description: "Failed to load requisition data", variant: "destructive" });
        setLoading(false);
    });

    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram, toast]);

  // --- 3. Filtering & Stats Logic ---
  useEffect(() => {
    if (allRequisitions.length === 0) {
      setFilteredRequisitions([]);
      setStats({ totalRequests: 0, pendingRequests: 0, totalAmount: 0 });
      return;
    }

    let filteredList = allRequisitions.filter(record => {
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

      // Status/Type Filters
      if (filters.status !== "all" && record.status?.toLowerCase() !== filters.status.toLowerCase()) return false;
      if (filters.type !== "all" && record.type?.toLowerCase() !== filters.type.toLowerCase()) return false;

      // Search
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const match = [
          getOfficerName(record), record.county, record.subcounty, record.location
        ].some(field => field?.toLowerCase().includes(term));
        if (!match) return false;
      }
      return true;
    });

    setFilteredRequisitions(filteredList);

    // Calculate Stats
    const totalRequests = filteredList.length;
    const pendingRequests = filteredList.filter(r => r.status === 'pending').length;
    const totalAmount = filteredList.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
    
    setStats({ totalRequests, pendingRequests, totalAmount });

    const totalPages = Math.ceil(filteredList.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination(prev => ({
      ...prev, page: currentPage, totalPages, hasNext: currentPage < totalPages, hasPrev: currentPage > 1
    }));
  }, [allRequisitions, filters, pagination.limit, pagination.page]);

  // --- Handlers ---

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters(prev => ({ 
        ...prev, search: "", 
        startDate: currentMonth.startDate, 
        endDate: currentMonth.endDate, 
        type: "all", status: "all"
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
      const totalPages = Math.ceil(filteredRequisitions.length / prev.limit);
      const validatedPage = Math.max(1, Math.min(newPage, totalPages));
      return { ...prev, page: validatedPage, hasNext: validatedPage < totalPages, hasPrev: validatedPage > 1 };
    });
  }, [filteredRequisitions.length]);

  const openViewDialog = useCallback((record: RequisitionData) => { setViewingRecord(record); setIsViewDialogOpen(true); }, []);

  // --- Approve Logic ---
  const handleApprove = async () => {
    if (!viewingRecord) return;
    try {
        const approverName = userName || user?.displayName || user?.email || "Admin";
        
        await update(ref(db, `requisitions/${viewingRecord.id}`), {
            status: 'approved',
            approvedBy: approverName,
            approvedAt: Date.now()
        });

        toast({ title: "Approved", description: "Requisition approved successfully" });
        setIsViewDialogOpen(false); // Close to refresh
    } catch (error) {
        console.error(error);
        toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };
  
  const handleDeleteMultiple = async () => {
    // Optional: Implement delete if needed
  };

  const handleExport = async () => {
    // Optional: Implement Export
  };

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredRequisitions.slice(startIndex, endIndex);
  }, [filteredRequisitions, pagination.page, pagination.limit]);

  // --- Sub-components ---
  const StatsCard = memo(({ title, value, icon: Icon, color = "blue", description }: any) => (
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
            <div className="text-3xl font-bold text-gray-800">{value}</div>
        </div>
        {description && <p className="text-xs mt-2 bg-gray-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>}
      </CardContent>
    </Card>
  ));

  // --- Render ---
  return (
    <div className="space-y-6 px-2 sm:px-4 md:px-0">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-4 md:items-center">
        <div className="w-full md:w-auto">
          <h2 className="text-md font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Requisitions
          </h2>
        </div>
         
         <div className="flex lg:flex-row md:flex-row flex-col gap-4 w-full md:w-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full md:w-auto">
                <div className="space-y-2">
                    <Label className="sr-only">Start Date</Label>
                    <Input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9 w-full" />
                </div>
                <div className="space-y-2">
                    <Label className="sr-only">End Date</Label>
                    <Input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9 w-full" />
                </div>
            </div>
            
            {userIsChiefAdmin && (
                <div className="space-y-2 w-full md:w-[180px]">
                    <Select value={activeProgram} onValueChange={handleProgramChange} disabled={availablePrograms.length === 0}>
                        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9 font-bold w-full">
                            <SelectValue placeholder="Select Programme" />
                        </SelectTrigger>
                        <SelectContent>
                            {availablePrograms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div className="w-full md:w-auto flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setFilters({ ...filters, search: "", startDate: "", endDate: "", type: "all", status: "all" })} className="h-9 px-6 w-full md:w-auto">
                    Clear Filters
                </Button>
            </div>
          </div>
          
        <div className="flex flex-wrap gap-2 w-full md:w-auto mt-2 md:mt-0 justify-end">
          {selectedRecords.length > 0 && (
            <Button variant="destructive" size="sm" onClick={handleDeleteMultiple} className="text-xs">
               Delete ({selectedRecords.length})
            </Button>
          )}
           <Button onClick={handleExport} disabled={exportLoading} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs">
            <Download className="h-4 w-4 mr-2" /> Export ({filteredRequisitions.length})
          </Button>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard 
            title="TOTAL REQUESTS" 
            value={stats.totalRequests.toLocaleString()} 
            icon={FileText} 
            color="blue"
        />
        
        <StatsCard 
            title="PENDING APPROVAL" 
            value={stats.pendingRequests.toLocaleString()} 
            icon={Calendar} 
            color="orange"
        />
             
        <StatsCard 
            title="TOTAL AMOUNT" 
            value={`KES ${stats.totalAmount.toLocaleString()}`} 
            icon={Wallet} 
            color="green"
        />
      </div>

      {/* Filter Section */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-6 pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Type</Label>
                <Select value={filters.type} onValueChange={(value) => handleFilterChange("type", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Types" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="fuel and Service">Fuel & Service</SelectItem>
                        <SelectItem value="perdiem">Perdiem</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Status</Label>
                <Select value={filters.status} onValueChange={(value) => handleFilterChange("status", value)}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2 lg:col-span-2">
                <Label className="font-semibold text-gray-700 text-xs uppercase">Search User</Label>
                <Input placeholder="Name, County, Location..." defaultValue={filters.search} onChange={(e) => handleSearchChange(e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Table Section */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="text-muted-foreground mt-2">Loading requisitions...</p></div>
          ) : getCurrentPageRecords().length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No records found matching your criteria</div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-blue-50 text-xs">
                      <th className="py-3 px-3 font-semibold text-gray-700">Date</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Type</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Field Officer</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Purpose</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Amount</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Status</th>
                      <th className="py-3 px-3 font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getCurrentPageRecords().map((record) => (
                      <tr key={record.id} className="border-b hover:bg-blue-50 transition-colors group">
                        <td className="py-2 px-3 text-xs text-gray-500">{formatDate(record.submittedAt)}</td>
                        <td className="py-2 px-3 text-xs font-medium">
                            {record.type === 'fuel and Service' ? (
                                <span className="flex items-center gap-1"><Car className="h-3 w-3"/> Fuel</span>
                            ) : (
                                <span className="flex items-center gap-1"><Wallet className="h-3 w-3"/> Perdiem</span>
                            )}
                        </td>
                        <td className="py-2 px-3 text-xs">{getOfficerName(record)}</td>
                        <td className="py-2 px-3 text-xs truncate max-w-[150px]">
                            {record.type === 'fuel and Service' ? record.fuelPurpose : record.tripPurpose}
                        </td>
                        <td className="py-2 px-3 text-xs font-semibold text-green-700">
                            KES {record.type === 'fuel and Service' ? record.fuelAmount?.toLocaleString() : record.total?.toLocaleString()}
                        </td>
                        <td className="py-2 px-3">
                             <Badge 
                                variant={record.status === 'approved' ? "default" : record.status === 'rejected' ? "destructive" : "outline"}
                                className={record.status === 'approved' ? "bg-green-100 text-green-800 hover:bg-green-100" : ""}
                             >
                                {record.status}
                             </Badge>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openViewDialog(record)}><Eye className="h-3.5 w-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t bg-gray-50 gap-4">
                <div className="text-sm text-muted-foreground">{filteredRequisitions.length} total records • Page {pagination.page} of {pagination.totalPages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Document Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-4xl bg-gray-200 rounded-none w-[95vw] sm:w-full max-h-[95vh] flex flex-col">
          {/* Scrollable Content Area */}
          <div className="overflow-y-auto flex-1">
            {viewingRecord && (
              <div className="grid bg-white shadow-lg w-full p-8 md:p-12 min-h-[800px] relative">
                <div className="w-[90px] mb-6">
                  <img src="/img/logo.png" alt="Logo" className="h-auto w-full object-contain" />
                </div>
                
                {/* Added pb-56 to create space at the bottom for the absolute signatures */}
                <div className="pb-56">
                  {/* --- Header --- */}
                  <div className="border-b-2 border-black pb-4 mb-8 flex justify-between items-end">
                    <div>
                      <h1 className="text-3xl font-bold uppercase tracking-tight mb-2">
                        {viewingRecord.type === 'fuel and Service' ? "Fuel & Service" : "Perdiem"} Requisition
                      </h1>
                    </div>
                  </div>

                  {/* --- Top Info Grid --- */}
                  <div className="flex flex-col gap-6 mb-8 text-sm">
                    <div className="flex flex-row gap-16">
                      <span className="text-gray-500 text-xs uppercase font-bold w-32">Date of Request</span>
                      <span className="font-medium border-b border-gray-300 pb-1 flex-1">{formatDate(viewingRecord.submittedAt)}</span>
                    </div>
                    <div className="flex flex-row gap-16">
                      <span className="text-gray-500 text-xs uppercase font-bold w-32">County</span>
                      <span className="font-medium border-b border-gray-300 pb-1 flex-1">{viewingRecord.county}</span>
                    </div>
                    <div className="flex flex-row gap-16">
                      <span className="text-gray-500 text-xs uppercase font-bold w-32">Subcounty</span>
                      <span className="font-medium border-b border-gray-300 pb-1 flex-1">{viewingRecord.subcounty}</span>
                    </div>
                    <div className="flex flex-row gap-16">
                      <span className="text-gray-500 text-xs uppercase font-bold w-32">Requested By</span>
                      <span className="font-medium border-b border-gray-300 pb-1 flex-1">{getOfficerName(viewingRecord)}</span>
                    </div>
                  </div>

                
                  {viewingRecord.type === 'fuel and Service' ? (
                    // Fuel Layout
                    <div className="space-y-6">
                      <h3 className="font-bold text-gray-800 border-l-4 border-blue-600 pl-3 uppercase text-lg">Fuel Details</h3>

                      <div className="grid grid-cols-2 gap-6">
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Last Speedometer Reading</span>
                          <span className="font-mono font-bold text-xl text-gray-800">{viewingRecord.lastReading} km</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Current Speedometer Reading</span>
                          <span className="font-mono font-bold text-xl text-gray-800">{viewingRecord.currentReading} km</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Distance Traveled</span>
                          <span className="font-bold text-gray-800">{viewingRecord.distanceTraveled} km</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Amount Requested</span>
                          <span className="font-bold text-green-700 text-xl">KES {viewingRecord.fuelAmount?.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex flex-col">
                        <span className="text-gray-500 text-xs uppercase font-bold">Purpose : </span>
                        <p className="font-medium bg-gray-50 border border-gray-300">{viewingRecord.fuelPurpose}</p>
                      </div>
                    </div>
                  ) : (
                    // Perdiem Layout
                    <div className="space-y-6">
                      <h3 className="font-bold text-gray-800 border-l-4 border-blue-600 pl-3 uppercase text-lg">Perdiem Details</h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Trip From</span>
                          <span className="font-medium border-b border-gray-300 pb-1">{formatDate(viewingRecord.tripFrom)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Trip To</span>
                          <span className="font-medium border-b border-gray-300 pb-1">{formatDate(viewingRecord.tripTo)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold">Number of Days</span>
                          <span className="font-medium border-b border-gray-300 pb-1">{viewingRecord.numberOfDays} Days</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-gray-500 text-xs uppercase font-bold flex items-center gap-2">
                            <MapPin className="h-3 w-3" /> Location
                          </span>
                          <span className="font-medium border-b border-gray-300 pb-1">{viewingRecord.location || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <span className="text-gray-500 text-xs uppercase font-bold mb-2 block">Breakdown</span>
                        <div className="w-full text-sm border-collapse border border-gray-400">
                          <div>
                            {viewingRecord.items && viewingRecord.items.length > 0 ? (
                              viewingRecord.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between border-b border-gray-300">
                                  <p className="p-2 border-r border-gray-300 flex-1">{item.name}</p>
                                  <p className="p-2 text-right w-32">{item.price.toLocaleString()}</p>
                                </div>
                              ))
                            ) : (
                              <div className="p-4 text-center text-gray-500 italic">No items found.</div>
                            )}
                          </div>
                          <div>
                            <div className="bg-gray-100 border-t-2 border-gray-800 font-bold flex justify-between">
                              <p className="p-2 border-r border-gray-800">Total Amount</p>
                              <p className="p-2 text-right text-green-700">{viewingRecord.total?.toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className=" flex flex-row mt-4 items-center gap-2">
                        <span className="text-gray-500 text-xs uppercase font-bold block">Purpose : </span>
                        <span className="font-medium border-b border-gray-300 flex-1">{viewingRecord.tripPurpose}</span>
                       
                      </div>
                    </div>
                  )}
                </div>

                <div className="absolute left-8 right-8 bottom-0">
                  <div className="grid grid-cols-1 top-5 gap-8 mt-16 pt-8 mb-24">
                  {/* Approved By */}
                    <div className="flex flex-col">
                      <div className="flex flex-row items-end gap-4">
                        <span className="text-xs uppercase text-gray-600 font-bold mb-2">Approved By</span>
                        <div className="flex-1 border-b-2 border-black mb-1 flex items-center justify-center relative h-6">
                          {viewingRecord.approvedBy ? (
                            <span className="text-sm font-bold text-blue-700">{viewingRecord.approvedBy}</span>
                          ) : (
                            <span className="text-xs italic text-gray-300">Pending Approval</span>
                          )}
                           
                        </div>
                        <span>Date :</span>
                        <div className="flex justify-between text-2xs text-gray-900 ">
                          
                        <span> 
                          {viewingRecord.approvedAt ? formatDate(viewingRecord.approvedAt) : 'Date'}
                           <div className="flex-1 border-b-2 border-black mb-1"></div>
                          </span>
                        
                      </div>
                      </div>
                     
                    </div>

                    {/* Authorized By */}
                    <div className="flex flex-col">
                      <div className="flex flex-row items-end gap-4">
                        <span className="text-xs uppercase text-gray-600 font-bold mb-2">Authorized By</span>
                        <div className="flex-1 border-b-2 border-black mb-1"></div>
                        
                          <span>Signature</span>
                          <div className="flex-1 border-b-2 border-black mb-1"></div>
                        <span>Date</span>
                        <div className="flex-1 border-b-2 border-black mb-1"></div>
                        
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 px-32">
                        
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer / Action Bar */}
          <div className="bg-gray-200 p-4 flex flex-col-reverse sm:flex-row justify-between items-center gap-4 border-t border-gray-300 z-10 shrink-0">
            
            {/* Left Side: Print & Download */}
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none">
                <Printer className="h-4 w-4 mr-2" /> Print
              </Button>
              <Button variant="outline" onClick={() => { /* Add handleDownload logic here */ }} className="flex-1 sm:flex-none">
                <Download className="h-4 w-4 mr-2" /> Download
              </Button>
            </div>

            {/* Right Side: Approve (Conditional) & Close */}
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              {!viewingRecord?.approvedBy && (
                <Button onClick={handleApprove} className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-none">
                  <CheckCircle className="h-4 w-4 mr-2" /> Approve Requisition
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)} className="flex-1 sm:flex-none">
                Close
              </Button>
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RequisitionsPage;