import { useState, useEffect, useCallback, useMemo, useRef, ChangeEvent, memo } from "react";
import { useNavigate } from "react-router-dom"; 
import { useAuth } from "@/contexts/AuthContext";
import { getAuth, signOut } from "firebase/auth"; 
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"; 
import { Download, Eye, Calendar, FileText, Edit, Trash2, Car, Wallet, CheckCircle, XCircle, MapPin, Printer, Plus, Minus, Save, FileImage, ExternalLink, MoreHorizontal, LogOut, History, Clock, ChevronDown } from "lucide-react"; 
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// --- Types ---
interface PerdiemItem {
  date?: string | number; 
  name: string;
  price: number;
}

interface HistoryEntry {
  id?: string; 
  action: string;
  actor: string;
  timestamp: number;
  details?: string;
}

interface RequisitionData {
  id: string;
  type: 'fuel and Service' | 'perdiem';
  status: 'pending' | 'approved' | 'rejected' | 'complete';
  username: string;
  name?: string;
  userName?: string;
  email?: string;
  submittedAt: string | number;
  county?: string;
  subcounty?: string;
  programme?: string;
  phone?: string;
  phoneNumber?: string;
  approvedBy?: string;
  approvedAt?: string | number;
  authorizedBy?: string;
  authorizedAt?: string | number;
  createdAt?: number | string;
  totalAmount?: number;
  history?: HistoryEntry[];
  
  // Fuel & Service Fields
  lastReading?: number;
  currentReading?: number;
  distanceTraveled?: number;
  fuelAmount?: number;
  fuelPurpose?: string;
  
  // Perdiem Fields
  fromLocation?: string; 
  toLocation?: string; 
  tripFrom?: string;   
  tripTo?: string;     
  tripPurpose?: string; 
  numberOfDays?: number;
  items?: PerdiemItem[]; 
  total?: number;
  location?: string; 
  
  // Mobile App Upload Fields
  fileUploaded?: boolean;
  fileUploadedAt?: string | number;
  requisitionUrl?: string;
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

const formatDateTime = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? parsedDate.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) : 'N/A';
};

const toInputDate = (date: any): string => {
  const d = parseDate(date);
  if (!d) return "";
  return d.toISOString().split('T')[0];
};

const getOfficerName = (record: RequisitionData | null | undefined): string => {
  if (!record) return "Unknown";
  return record.name || record.userName || record.username || record.email || "Unknown";
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(),1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    startDate: formatDate(startOfMonth),
    endDate: formatDate(endOfMonth),
  };
};

const getRequisitionImages = (urlString: string | undefined): string[] => {
  if (!urlString) return [];
  return urlString.split('|').map(url => url.trim()).filter(url => url.length > 0);
};

// --- Helper to Log History ---
const logHistory = async (recordId: string, action: string, details: string) => {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const entry: HistoryEntry = {
    action,
    actor: currentUser.displayName || currentUser.email || "Admin",
    timestamp: Date.now(),
    details
  };

  try {
    await push(ref(db, `requisitions/${recordId}/history`), entry);
  } catch (error) {
    console.error("Failed to log history:", error);
  }
};

// --- Main Component ---

const RequisitionsPage = () => {
  const { user, userRole, userName } = useAuth();
  const navigate = useNavigate(); 
  const { toast } = useToast();
  
  // List State
  const [allRequisitions, setAllRequisitions] = useState<RequisitionData[]>([]);
  const [filteredRequisitions, setFilteredRequisitions] = useState<RequisitionData[]>([]);
  const [activeProgram, setActiveProgram] = useState<string>("ALL"); 
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  
  // Dialog States
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<RequisitionData | null>(null);
  
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [viewingImages, setViewingImages] = useState<string[]>([]);
  
  // History State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);

  // Edit State
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<RequisitionData | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<RequisitionData>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Print State
  const [printDate, setPrintDate] = useState<string>('');

  // Delete State
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<RequisitionData | null>(null);
  
  const docRef = useRef<HTMLDivElement>(null);
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
  const canApproveRequisition = userRole === 'admin' || userIsChiefAdmin;
  const canAuthorizeRequisition = userRole === 'hr';
  const canCompleteRequisition = canApproveRequisition || canAuthorizeRequisition;

  // --- 1. Fetch User Permissions (HR SEES ALL) ---
  useEffect(() => {
    if (userRole === 'hr') {
      setAvailablePrograms([]);
      setActiveProgram("ALL");
      return;
    }

    if (isChiefAdmin(userRole)) {
      setAvailablePrograms(["RANGE", "KPMD"]);
      setActiveProgram((prev) => (!prev || prev === "ALL" ? "RANGE" : prev));
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
          if (!prev || prev === "ALL" || !programs.includes(prev)) return programs[0];
          return prev;
        });
      } else {
        setAvailablePrograms([]);
        setActiveProgram("");
      }
    }, (error) => { console.error("Error fetching user permissions:", error); });
    return () => unsubscribe();
  }, [userRole]);

  // --- 2. Data Fetching ---
  useEffect(() => {
    if (userRole !== 'hr' && !activeProgram) {
        setAllRequisitions([]);
        setLoading(false);
        return;
    }
    setLoading(true);

    let reqQuery;
    if (userRole === 'hr' || activeProgram === "ALL") {
        reqQuery = ref(db, 'requisitions');
    } else {
        reqQuery = query(ref(db, 'requisitions'), orderByChild('programme'), equalTo(activeProgram));
    }

    const unsubscribe = onValue(reqQuery, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setAllRequisitions([]);
            setLoading(false);
            return;
        }
        const records = Object.keys(data).map((key) => {
            const item = data[key];
            let dateVal = item.submittedAt;
            if (typeof dateVal === 'string') {
               const d = parseDate(dateVal);
               dateVal = d ? d.getTime() : Date.now();
            } else if (typeof dateVal !== 'number') {
               dateVal = Date.now();
            }
            const isFuel = item.type === 'fuel and Service';
            const normalizedPhone = item.phoneNumber || item.phone || item.phone_number || item.Phone || item.mobile || item.contact || item.telephone || '';
            return {
                id: key,
                ...item,
                phoneNumber: normalizedPhone,
                tripPurpose: isFuel ? item.fuelPurpose : item.tripPurpose,
                items: Array.isArray(item.items) ? item.items : [], 
                createdAt: dateVal, 
                totalAmount: (isFuel ? item.fuelAmount : item.total) || 0,
                fileUploaded: item.fileUploaded || false
            };
        });
        records.sort((a, b) => (b.createdAt as number) - (a.createdAt as number));
        setAllRequisitions(records);
        setLoading(false);
    }, (error) => {
        console.error("Error fetching requisition data:", error);
        toast({ title: "Error", description: "Failed to load requisition data", variant: "destructive" });
        setLoading(false);
    });
    return () => { if(typeof unsubscribe === 'function') unsubscribe(); };
  }, [activeProgram, userRole, toast]);

  // --- 3. Filtering & Stats Logic ---
  useEffect(() => {
    if (allRequisitions.length === 0) {
      setFilteredRequisitions([]);
      setStats({ totalRequests: 0, pendingRequests: 0, totalAmount: 0 });
      return;
    }
    let filteredList = allRequisitions.filter(record => {
      if (userRole === 'hr') {
        if (record.status !== 'approved' && record.status !== 'complete') return false;
      }

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
      
      if (userRole !== 'hr' && filters.status !== "all" && record.status?.toLowerCase() !== filters.status.toLowerCase()) return false;
      
      if (filters.type !== "all" && record.type?.toLowerCase() !== filters.type.toLowerCase()) return false;
      
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
    
    const totalRequests = filteredList.length;
    const pendingRequests = filteredList.filter(r => r.status === 'pending').length;
    const totalAmount = filteredList.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
    
    setStats({ totalRequests, pendingRequests, totalAmount });
    
    const totalPages = Math.ceil(filteredList.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    setPagination(prev => ({
      ...prev, page: currentPage, totalPages, hasNext: currentPage < totalPages, hasPrev: currentPage > 1
    }));
  }, [allRequisitions, filters, pagination.limit, pagination.page, userRole]);

  // --- Handlers ---
  const handleLogout = async () => {
    try {
      await signOut(getAuth());
      navigate("/auth");
      toast({ title: "Logged out", description: "You have been logged out successfully." });
    } catch (error) {
      toast({ title: "Error", description: "Failed to log out", variant: "destructive" });
    }
  };

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

  const openViewDialog = useCallback(async (record: RequisitionData) => { 
    setViewingRecord(record); 
    
    // Fetch history for this record
    if (record.id) {
      const historyRef = ref(db, `requisitions/${record.id}/history`);
      onValue(historyRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const historyArr = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            historyArr.sort((a, b) => b.timestamp - a.timestamp);
            setHistoryList(historyArr);
        } else {
            setHistoryList([]);
        }
      });
    }
    
    setIsViewDialogOpen(true); 
  }, []);

  const openHistoryOnly = useCallback((record: RequisitionData) => {
    setViewingRecord(record);
    if (record.id) {
      const historyRef = ref(db, `requisitions/${record.id}/history`);
      onValue(historyRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const historyArr = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            historyArr.sort((a, b) => b.timestamp - a.timestamp);
            setHistoryList(historyArr);
        } else {
            setHistoryList([]);
        }
        setIsHistoryOpen(true);
      }, { onlyOnce: true });
    }
  }, []);

  const handleOpenImageViewer = (record: RequisitionData, printImmediately = false) => {
    const images = getRequisitionImages(record.requisitionUrl);
    if (images.length === 0) {
      toast({ title: "No Images", description: "No receipts uploaded for this record." });
      return;
    }
    setViewingImages(images);
    setIsImageViewerOpen(true);
    if (printImmediately) setTimeout(() => window.print(), 500);
  };

  const openEditDialog = useCallback((record: RequisitionData) => {
    setEditRecord(record);
    setEditFormData({
      ...record,
      items: record.items ? [...record.items] : []
    });
    setIsEditDialogOpen(true);
  }, []);

  const handleEditFieldChange = (field: keyof RequisitionData, value: any) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePerdiemItemChange = (index: number, field: 'name' | 'price' | 'date', value: any) => {
    const currentItems = editFormData.items || [];
    const updatedItems = currentItems.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    );
    setEditFormData(prev => ({ ...prev, items: updatedItems }));
    if (field === 'price') {
      const newTotal = updatedItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      setEditFormData(prev => ({ ...prev, total: newTotal }));
    }
  };

  const addPerdiemItem = () => {
    const currentItems = editFormData.items || [];
    setEditFormData(prev => ({
      ...prev,
      items: [...currentItems, { name: '', price: 0, date: toInputDate(new Date()) }]
    }));
  };

  const removePerdiemItem = (index: number) => {
    const currentItems = editFormData.items || [];
    const updatedItems = currentItems.filter((_, i) => i !== index);
    const newTotal = updatedItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    setEditFormData(prev => ({ ...prev, items: updatedItems, total: newTotal }));
  };

  const saveEdit = async () => {
    if (!editRecord) return;
    setIsSaving(true);
    try {
      const actorName = userName || user?.displayName || user?.email || "Admin";
      const previousStatus = String(editRecord.status || '').toLowerCase();
      const nextStatus = String(editFormData.status || editRecord.status || '').toLowerCase();
      const statusChanged = previousStatus !== nextStatus;

      const updatePayload: any = {
        county: editFormData.county,
        subcounty: editFormData.subcounty,
        tripPurpose: editFormData.tripPurpose,
        status: editFormData.status,
      };

      if (statusChanged && nextStatus === 'approved') {
        if (!canApproveRequisition) {
          toast({ title: "Unauthorized", description: "Only Admin and Chief Admin can approve requisitions.", variant: "destructive" });
          return;
        }
        updatePayload.approvedBy = actorName;
        updatePayload.approvedAt = Date.now();
      }

      if (statusChanged && nextStatus === 'complete') {
        if (!canCompleteRequisition) {
          toast({ title: "Unauthorized", description: "Only HR, Admin or Chief Admin can complete requisitions.", variant: "destructive" });
          return;
        }
        const authorizedBy = String(editRecord.authorizedBy || '').trim();
        if (!authorizedBy) {
          toast({ title: "Authorization Required", description: "Requisition can only be completed after HR authorization.", variant: "destructive" });
          return;
        }
      }

      if (editRecord.type === 'fuel and Service') {
        updatePayload.lastReading = editFormData.lastReading;
        updatePayload.currentReading = editFormData.currentReading;
        updatePayload.distanceTraveled = editFormData.distanceTraveled;
        updatePayload.fuelAmount = editFormData.fuelAmount;
        updatePayload.fuelPurpose = editFormData.tripPurpose; 
      } else {
        updatePayload.fromLocation = editFormData.fromLocation;
        updatePayload.toLocation = editFormData.toLocation;
        updatePayload.tripFrom = editFormData.tripFrom;
        updatePayload.tripTo = editFormData.tripTo;
        updatePayload.numberOfDays = editFormData.numberOfDays;
        updatePayload.items = editFormData.items;
        updatePayload.total = editFormData.total;
        updatePayload.location = editFormData.location;
      }
      await update(ref(db, `requisitions/${editRecord.id}`), updatePayload);

      if (statusChanged && nextStatus === 'approved') {
        await logHistory(editRecord.id, "Approved", `Approved by ${actorName}`);
      } else if (statusChanged && nextStatus === 'complete') {
        await logHistory(editRecord.id, "Completed", `Marked complete by ${actorName}`);
      } else if (statusChanged && nextStatus === 'rejected') {
        await logHistory(editRecord.id, "Rejected", `Rejected by ${actorName}`);
      } else {
        await logHistory(editRecord.id, "Edited", "Requisition details updated.");
      }

      toast({ title: "Success", description: "Requisition updated successfully." });
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to update requisition.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = (record: RequisitionData) => {
    setRecordToDelete(record);
    setIsDeleteConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (!recordToDelete) return;
    setDeleteLoading(true);
    try {
      await remove(ref(db, `requisitions/${recordToDelete.id}`));
      toast({ title: "Deleted", description: "Requisition deleted successfully" });
      setIsDeleteConfirmOpen(false);
      setRecordToDelete(null);
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!viewingRecord) return;
    if (!canApproveRequisition) {
      toast({ title: "Unauthorized", description: "Only Admin and Chief Admin can approve requisitions.", variant: "destructive" });
      return;
    }
    try {
        const approverName = userName || user?.displayName || user?.email || "Admin";
        await update(ref(db, `requisitions/${viewingRecord.id}`), {
            status: 'approved',
            approvedBy: approverName,
            approvedAt: Date.now()
        });
        
        await logHistory(viewingRecord.id, "Approved", `Approved by ${approverName}`);
        
        toast({ title: "Approved", description: "Requisition approved successfully" });
        setIsViewDialogOpen(false); 
    } catch (error) {
        toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  // --- HR Authorization Handler ---
  const handleAuthorize = async () => {
    if (!viewingRecord) return;
    if (!canAuthorizeRequisition) {
      toast({ title: "Unauthorized", description: "Only HR can authorize requisitions.", variant: "destructive" });
      return;
    }
    if (viewingRecord.status !== 'approved') {
      toast({ title: "Invalid Status", description: "Only approved requisitions can be authorized.", variant: "destructive" });
      return;
    }
    try {
        const actorName = userName || user?.displayName || user?.email || "Admin";
        
        // Only updates authorizedBy and authorizedAt, keeps status as 'approved'
        await update(ref(db, `requisitions/${viewingRecord.id}`), {
            authorizedBy: actorName,
            authorizedAt: Date.now()
        });

        await logHistory(viewingRecord.id, "Authorized", `Authorized by ${actorName}`);

        toast({ title: "Authorized", description: "Requisition authorized successfully." });
        
        // Update local state
        setViewingRecord(prev => prev ? { 
            ...prev, 
            authorizedBy: actorName, 
            authorizedAt: Date.now() 
        } : null);
    } catch (error) {
        toast({ title: "Error", description: "Failed to authorize", variant: "destructive" });
    }
  };

  // --- Mark Complete Handler ---
  const handleMarkComplete = async () => {
    if (!viewingRecord) return;
    if (!canCompleteRequisition) {
      toast({ title: "Unauthorized", description: "Only HR, Admin or Chief Admin can complete requisitions.", variant: "destructive" });
      return;
    }
    if (viewingRecord.status !== 'approved') {
      toast({ title: "Invalid Status", description: "Only approved requisitions can be marked complete.", variant: "destructive" });
      return;
    }
    if (!viewingRecord.authorizedBy) {
      toast({ title: "Authorization Required", description: "Requisition can only be completed after HR authorization.", variant: "destructive" });
      return;
    }
    try {
        const actorName = userName || user?.displayName || user?.email || "Admin";
        
        const updatePayload: any = {
            status: 'complete',
        };

        await update(ref(db, `requisitions/${viewingRecord.id}`), updatePayload);

        await logHistory(viewingRecord.id, "Completed", `Marked complete by ${actorName}`);

        toast({ title: "Completed", description: "Requisition marked as complete." });
        
        setViewingRecord(prev => prev ? { ...prev, status: 'complete' } : null);
        setIsHistoryOpen(false);
    } catch (error) {
        toast({ title: "Error", description: "Failed to mark complete", variant: "destructive" });
    }
  };

  const handlePrint = () => {
    setPrintDate(new Date().toLocaleString());
    // Allow the state to update before triggering print
    setTimeout(() => {
        window.print();
    }, 300);
  };

  const handleDownload = useCallback(async () => {
    if (!docRef.current || !viewingRecord) return;
    const element = docRef.current;
    const parent = element.parentElement as HTMLElement; 
    const grandParent = parent?.parentElement as HTMLElement; 
    
    toast({ title: "Generating PDF", description: "Please wait..." });
    
    const originalParentOverflow = parent?.style.overflow;
    const originalParentHeight = parent?.style.height;
    const originalGrandParentMaxHeight = grandParent?.style.maxHeight;
    const originalGrandParentHeight = grandParent?.style.height;

    try {
      if (parent) {
        parent.style.overflow = 'visible';
        parent.style.height = 'auto';
      }
      if (grandParent) {
        grandParent.style.maxHeight = 'none';
        grandParent.style.height = 'auto';
        grandParent.style.overflow = 'visible';
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(element, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff',
        windowWidth: element.scrollWidth, 
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
      pdf.save(`Requisition_${viewingRecord.id}_${viewingRecord.type}.pdf`);
      toast({ title: "Success", description: "Document downloaded." });
    } catch (error) {
      console.error("PDF Gen Error:", error);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    } finally {
      if (parent) {
        parent.style.overflow = originalParentOverflow || '';
        parent.style.height = originalParentHeight || '';
      }
      if (grandParent) {
        grandParent.style.maxHeight = originalGrandParentMaxHeight || '';
        grandParent.style.height = originalGrandParentHeight || '';
      }
    }
  }, [viewingRecord, toast]);

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredRequisitions.slice(startIndex, endIndex);
  }, [filteredRequisitions, pagination.page, pagination.limit]);

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
    <>
   <style>
{`
@media print {

    /* Paper setup */
    @page { 
        size: A4 portrait; 
        margin: 10mm; 
    }

    /* Reset root */
    html, body {
        width: 100% !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: white !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* Hide everything except print wrapper */
    body > *:not(.print-content-wrapper) {
        display: none !important;
    }

    /* Main wrapper */
    .print-content-wrapper {
        position: static !important;  /* 🔥 FIXED */
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        display: block !important;
        height: auto !important;
        min-height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        border: none !important;
        box-shadow: none !important;
        transform: none !important;
    }

    /* Remove dialog UI elements */
    .print-content-wrapper button,
    .print-content-wrapper .fixed,
    .print-content-wrapper .no-print {
        display: none !important;
    }

    /* Remove scroll containers */
    .print-content-wrapper .overflow-y-auto,
    .print-content-wrapper .overflow-auto {
        overflow: visible !important;
        max-height: none !important;
        height: auto !important;
    }

    /* Main printable content */
    .printable-area {
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        padding: 0 !important;
        margin: 0 !important;
        border: none !important;
        box-shadow: none !important;
    }

    /* Tables */
    table {
        width: 100% !important;
        border-collapse: collapse !important;
    }

    /* Fix grid layouts breaking */
    .grid {
        display: block !important;
    }

    .grid > div {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 20px !important;
    }

    /* Fix Tailwind aspect ratio issue */
    .aspect-\\[4\\/3\\] {
        aspect-ratio: auto !important;
        height: auto !important;
    }

    /* Images */
    .print-content-wrapper img {
        max-width: 100% !important;
        width: 100% !important;
        height: auto !important;
        display: block !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 15px !important;
    }

}
`}
</style>


    <div className="space-y-6 px-2 sm:px-4 md:px-0">
      {/* Header Section */}
      <div className="flex flex-row md:flex-row justify-between items-start gap-4 md:items-center">
        <div className="w-full md:w-auto flex flex-row items-center gap-4">
          <h2 className="text-md font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Requisitions
          </h2>
          {userRole === 'hr' && ( <div className="flex justify-between items-center text-sm">
              <div className="font-semibold text-gray-700 rounded-md bg-gray-100 px-2 py-1 border border-gray-300">
                  <span className="font-normal">{userName || user?.email || "System"}</span>
              </div>
            </div> )}
            
          
        </div>
         
         <div className="flex lg:flex-row md:flex-row flex-col gap-4 w-full md:w-auto">
          
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full md:w-auto relative z-50">
              
                <div className="">
                    <Label className="sr-only">Start Date</Label>
                    <Input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9 w-full" />
                </div>
                <div className="">
                    <Label className="sr-only">End Date</Label>
                    <Input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="border-gray-300 focus:border-blue-500 bg-white h-9 w-full" />
                </div>
            </div>
            
            {userIsChiefAdmin && userRole !== 'hr' && (
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
          
        <div className="flex flex-wrap gap-2 w-full md:w-auto mt-2 md:mt-0 justify-end">
          {userRole !== 'hr' && selectedRecords.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => {}} className="text-xs">
               Delete ({selectedRecords.length})
            </Button>
          )}
           
           {userRole === 'hr' ? (
             <Button onClick={handleLogout} variant="outline" size="sm" className="h-9 px-6 w-full md:w-auto text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700">
               <LogOut className="h-4 w-4 mr-2" /> Logout
             </Button>
           ) : (
             <Button onClick={() => {}} disabled={exportLoading} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs h-9 px-6 w-full md:w-auto">
                <Download className="h-4 w-4 mr-2" /> Export ({filteredRequisitions.length})
              </Button>
           )}
        </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard title="TOTAL REQUESTS" value={stats.totalRequests.toLocaleString()} icon={FileText} color="blue"/>
        <StatsCard title="PENDING APPROVAL" value={stats.pendingRequests.toLocaleString()} icon={Calendar} color="orange"/>
        <StatsCard title="TOTAL AMOUNT" value={`KES ${stats.totalAmount.toLocaleString()}`} icon={Wallet} color="green"/>
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
                <Select value={filters.status} onValueChange={(value) => handleFilterChange("status", value)} disabled={userRole === 'hr'}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="complete">Complete</SelectItem>
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
                      <th className="py-3 px-3 font-semibold text-gray-700 text-right">Actions</th>
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
                                variant={record.status === 'approved' || record.status === 'complete' ? "default" : record.status === 'rejected' ? "destructive" : "outline"}
                                className={record.status === 'approved' ? "bg-green-100 text-green-800 hover:bg-green-100" : record.status === 'complete' ? "bg-blue-100 text-blue-800 hover:bg-blue-100" : ""}
                             >
                                {record.status}
                             </Badge>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="  border-b border-gray-500 h-8 w-8 bodder p-2 mr-2 text-gray-500 hover:text-gray-900">
                                    <span className="sr-only">Open menu</span>
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openViewDialog(record)}>
                                    <Eye className="mr-2 h-4 w-4 text-blue-600" /> <span className="text-gray-700">View Details</span>
                                </DropdownMenuItem>
                                
                                <DropdownMenuItem onClick={() => openHistoryOnly(record)}>
                                    <Clock className="mr-2 h-4 w-4 text-purple-600" /> <span className="text-gray-700">View History</span>
                                </DropdownMenuItem>
                                
                                <DropdownMenuItem onClick={() => handleOpenImageViewer(record)}>
                                    <FileImage className="mr-2 h-4 w-4 text-indigo-600" /> <span className="text-gray-700">View Images</span>
                                </DropdownMenuItem>

                                {userRole !== 'hr' && <DropdownMenuSeparator />}
                                
                                {userRole !== 'hr' && (
                                    <DropdownMenuItem onClick={() => openEditDialog(record)}>
                                        <Edit className="mr-2 h-4 w-4 text-gray-600" /> <span className="text-gray-700">Edit</span>
                                    </DropdownMenuItem>
                                )}
                                
                                {userRole !== 'hr' && (
                                    <DropdownMenuItem onClick={() => confirmDelete(record)} className="text-red-600 focus:text-red-700 focus:bg-red-50">
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* --- VIEW DIALOG --- */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="print-content-wrapper font-times sm:max-w-5xl bg-gray-200 rounded-none w-[95vw] sm:w-full max-h-[95vh] flex flex-col">
          <div className="overflow-y-auto flex-1">
            {viewingRecord && (
              <div ref={docRef} className="gridgrid-cols-1 bg-white shadow-lg w-full md:p-12 min-h-[800px] relative flex flex-col printable-area">
                <div className="pb-10 flex-1 ml-10 mr-10">
                  <div className="flex flex-col items-center justify-center">
                      <div className="w-[260px] m-0 p-0 mb-4">
                        <img src="/img/logo.png" alt="Logo" className="w-full" />
                      </div>
                      <h1 className="font-times text-2xl font-bold uppercase tracking-tight leading-tight mb-2">
                        {viewingRecord.type === "fuel and Service" ? "Fuel & Service" : "Perdiem"}{" "}
                        Requisition Form
                      </h1>
                  </div>
                  
                 

                  <div className="mt-5 flex flex-col gap-2 mb-2 text-sm">
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">Date of Request:</span><span className="font-medium flex-1 text-[17px]">{formatDate(viewingRecord.submittedAt)}</span></div>
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">County:</span><span className="font-medium flex-1 text-[17px]">{viewingRecord.county}</span></div>
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">Sub County:</span><span className="font-medium flex-1 text-[17px]">{viewingRecord.subcounty}</span></div>
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">Requested By:</span><span className="font-medium flex-1 text-[17px]">{getOfficerName(viewingRecord)}</span></div>
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">Phone: </span><span className="font-medium  flex-1 text-[17px]">{viewingRecord.phoneNumber || viewingRecord.phone || 'N/A'}</span></div>
                    <div className="flex flex-row gap-2"><span className="text-gray-700 text-[17px]">Purpose : </span><span className="font-medium  flex-1 text-[17px]">{viewingRecord.tripPurpose}</span></div>
                  </div>

                  {viewingRecord.type === 'fuel and Service' ? (
                    <div className="space-y-2 font-times">
                      <div className="grid grid-cols-1 gap-4">
                        <div className="flex flex-row items-center gap-2"><span className="text-gray-800 text-[17px] ">Last Speedometer Reading : </span><span className="text-gray-800">{viewingRecord.lastReading} km</span></div>
                        <div className="flex flex-row items-center gap-2"><span className="text-gray-800 text-[17px] ">Current Speedometer Reading :</span><span className="text-gray-800">{viewingRecord.currentReading} km</span></div>
                        <div className="flex flex-row items-center gap-2"><span className="text-gray-800 text-[17px] ">Distance Traveled : </span><span className="text-gray-800">{viewingRecord.distanceTraveled} km</span></div>
                        <div className="flex flex-row items-center gap-2"><span className="text-gray-800 text-[17px] ">Amount Requested : </span><span className="text-gray-800">KES {viewingRecord.fuelAmount?.toLocaleString()}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="items-center"><u><h3 className="font-times text-center font-bold text-gray-800 uppercase text-lg">TRAVEL REQUEST REIMBURSEMENT SHEET</h3></u></div>
                      <div className="grid grid-cols-1 md:grid-cols-2">
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px] "> From : </span><span className="font-medium">{viewingRecord.fromLocation || 'N/A'}</span></div>
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px] "> To : </span><span className="font-medium">{viewingRecord.toLocation || 'N/A'}</span></div>
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px] "> Trip Starts On : </span><span className="font-medium">{formatDate(viewingRecord.tripFrom)}</span></div>
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px] ">Trip End on : </span><span className="font-medium">{formatDate(viewingRecord.tripTo)}</span></div>
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px] ">Number of Days : </span><span className="font-medium">{viewingRecord.numberOfDays} Days</span></div>
                        <div className="flex flex-row items-center"><span className="text-gray-800 text-[17px]  flex items-center gap-2">Location :</span><span className="font-medium">{viewingRecord.location || 'N/A'}</span></div>
                      </div>
                      <div className="mt-4 flex flex-col items-center justify-center">
                        <span className="text-gray-800 text-xl uppercase font-bold block mb-2 ">Cost Breakdown</span>
                        <div className="w-full text-sm border-collapse border border-gray-400">
                          <table className="w-full border-collapse border border-gray-300">
                            <thead><tr className="bg-gray-100"><td className="p-2 border border-gray-500 text-left text-[17px] font-semibold text-gray-700">Date</td><td className="p-2 border border-gray-500 text-left text-[17px] font-semibold text-gray-700">Item/Description</td><td className="p-2 border border-gray-500 text-right text-[17px] font-semibold text-gray-700">Amount (KES)</td></tr></thead>
                            <tbody className="divide-y divide-gray-300">
                              {viewingRecord.items && viewingRecord.items.length > 0 ? viewingRecord.items.map((item, idx) => (
                                <tr key={idx} className=""><td className="p-2 text-[17px] border-r border-gray-500 w-32">{formatDate(item.date)}</td><td className="p-2 text-[17px] border-r border-gray-500 flex-1">{item.name}</td><td className="p-2 text-[17px] text-right w-32">{item.price.toLocaleString()}</td></tr>
                              )) : <div className="p-4 text-center text-gray-500 italic">No items found.</div>}
                              <tr className=""><td className="p-2 text-[17px] ">Total Amount</td><td></td><td className="p-2 text-[17px] text-right border-l border-gray-800 text-gray-700">{viewingRecord.total?.toLocaleString()}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-8">
                    <div className="grid grid-cols-1 top-5 gap-8">
                      <div className="flex flex-col">
                        <div className="flex flex-row justify-between">
                          <div className="flex flex-col gap-2 items-center justify-start"></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 mt-4 gap-8">
                        <div className="flex flex-row">
                          <span className="text-[17px] text-gray-700">Approved By : </span>
                          <div className="flex-1 flex relative h-6">{viewingRecord.approvedBy ? <span className="text-[17px] ml-2">{viewingRecord.approvedBy} (Admin/Chief Admin)</span> : <span className="text-xs italic text-gray-300">Pending Approval</span>}</div></div>
                        <div className="flex flex-row"><span className="text-[17px]">Date : </span><div className="flex justify-between text-2xs text-gray-900 ml-2"><span>{viewingRecord.approvedAt ? formatDateTime(viewingRecord.approvedAt) : 'Date'}</span></div></div>
                        
                       
                          <div className="flex flex-row">
                             <span className="text-[17px] text-gray-800 ">Authorized By :</span>
                          <div className="flex-1 h-6 ml-2">
                            {viewingRecord.authorizedBy ? <span className="text-[17px]">{viewingRecord.authorizedBy}</span> : ""}
                          </div>

                          </div>
                          <div className="flex-1 flex flex-row justify-between mt-2">
                          <span className="text-[17px]">Date : </span>
                          <div className="flex-1 h-6  ml-2">
                            {viewingRecord.authorizedAt ? formatDateTime(viewingRecord.authorizedAt) : ""}
                          </div>
                        </div>
                          
                          <div>
                            <div className="flex-1 flex flex-col justify-between mt-2">
                          <span className="text-[17px]">Signature : </span>
                          
                        </div>
                          </div>
                          <div><div className="flex-1 flex flex-col justify-between mt-2">
                          <span className="text-[17px]">Official Stumb : </span>
                         
                        </div></div>
                          
                         
                       
                        
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* PRINT FOOTER - Always at bottom of printable area */}
                <div className="shrink-0 mt-8 pt-6 text-center">
                    <p className="text-sm font-semibold text-gray-800 mb-2">Printed on {printDate || new Date().toLocaleString()}</p>
                    <p className="text-xs italic text-gray-600 mb-1">This document is marked complete once transaction receipt is received.</p>
                    
                </div>
              </div>
            )}
          </div>

          {/* Dialog Actions (Non-Printable) */}
          <div className="bg-gray-200 p-4 flex flex-col-reverse sm:flex-row justify-between items-center gap-4 border-t border-gray-300 z-10 shrink-0 no-print">
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" onClick={handlePrint} className="flex-1 sm:flex-none"><Printer className="h-4 w-4 mr-2" /> Print</Button>
              <Button variant="outline" onClick={handleDownload} className="flex-1 sm:flex-none"><Download className="h-4 w-4 mr-2" /> Download</Button>
            </div>
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              {canApproveRequisition && !viewingRecord?.approvedBy && (
                <Button onClick={handleApprove} className="bg-green-600 hover:bg-green-700 flex-1 sm:flex-none">
                  <CheckCircle className="h-4 w-4 mr-2" /> Approve Requisition
                </Button>
              )}
              
              {/* HR Authorization Button */}
              {canAuthorizeRequisition && viewingRecord?.status === 'approved' && !viewingRecord.authorizedBy && (
                <Button onClick={handleAuthorize} className="bg-indigo-600 hover:bg-indigo-700 flex-1 sm:flex-none">
                  <CheckCircle className="h-4 w-4 mr-2" /> Authorize
                </Button>
              )}

              {/* HR/Admin/Chief Mark Complete Button (after HR authorization) */}
              {canCompleteRequisition && viewingRecord?.status === 'approved' && !!viewingRecord.authorizedBy && (
                <Button onClick={handleMarkComplete} className="bg-blue-800 hover:bg-blue-900 flex-1 sm:flex-none">
                  <CheckCircle className="h-4 w-4 mr-2" /> Mark Complete
                </Button>
              )}

              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)} className="flex-1 sm:flex-none">Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* --- HISTORY DIALOG --- */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Document History
                </DialogTitle>
            </DialogHeader>
            <div className="max-h-[400px] overflow-y-auto">
                {historyList.length === 0 ? (
                    <p className="text-sm text-gray-500 italic text-center py-4">No history recorded for this document.</p>
                ) : (
                    <div className="space-y-4">
                        {historyList.map((entry) => (
                            <div key={entry.id} className="flex gap-4 text-sm">
                                <div className="flex flex-col items-center">
                                    <div className="w-2 h-2 rounded-full bg-blue-600 mt-1.5"></div>
                                    <div className="w-0.5 h-full bg-gray-200 mt-1"></div>
                                </div>
                                <div className="pb-4 flex-1">
                                    <div className="flex justify-between items-start">
                                        <span className="font-semibold text-gray-800">{entry.action}</span>
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                            {formatDateTime(entry.timestamp)}
                                        </span>
                                    </div>
                                    <p className="text-gray-600 text-xs mt-1">{entry.actor}</p>
                                    {entry.details && <p className="text-gray-500 text-xs mt-0.5 italic">{entry.details}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsHistoryOpen(false)}>Close</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- IMAGE VIEWER DIALOG --- */}
      {/* FIXED: Added print-content-wrapper class here to enable printing */}
      <Dialog open={isImageViewerOpen} onOpenChange={setIsImageViewerOpen}>
        <DialogContent className="print-content-wrapper sm:max-w-4xl max-h-[90vh] flex flex-col bg-gray-50">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 no-print">
                    <FileImage className="h-5 w-5" />
                    Uploaded Receipts
                </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
                {viewingImages.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {viewingImages.map((url, idx) => (
                            <div key={idx} className="group relative border border-gray-200 rounded-lg shadow-sm bg-white overflow-hidden hover:shadow-md transition-shadow">
                                <div className="aspect-[4/3] w-full bg-gray-100 flex items-center justify-center">
                                    <img 
                                    src={url} 
                                    alt={`Receipt ${idx + 1}`} 
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    />
                                </div>
                                <div className="p-3 border-t border-gray-100 flex justify-between items-center">
                                    <span className="text-sm font-medium text-gray-700">Receipt #{idx + 1}</span>
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 no-print">
                                        Open Original <ExternalLink className="h-3 w-3"/>
                                    </a>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 text-gray-500">No images to display.</div>
                )}
            </div>
            <DialogFooter className="bg-white border-t p-4 no-print">
                <Button variant="outline" onClick={() => setIsImageViewerOpen(false)}>Close</Button>
                <Button onClick={() => window.print()} variant="default">
                    <Printer className="h-4 w-4 mr-2" /> Print Images
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- EDIT DIALOG --- */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Requisition</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 pr-2">
            {editRecord && (
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Type</Label><Input value={editRecord.type} disabled className="bg-gray-100" /></div>
                  <div className="space-y-2"><Label>Status</Label>
                    <Select value={editFormData.status} onValueChange={(val) => handleEditFieldChange('status', val)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="complete">Complete</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>County</Label><Input value={editFormData.county || ''} onChange={(e) => handleEditFieldChange('county', e.target.value)} /></div>
                  <div className="space-y-2"><Label>Sub County</Label><Input value={editFormData.subcounty || ''} onChange={(e) => handleEditFieldChange('subcounty', e.target.value)} /></div>
                </div>
                {editRecord.type === 'fuel and Service' ? (
                  <div className="space-y-4 border p-4 rounded-lg bg-gray-50">
                    <h3 className="font-semibold text-sm uppercase text-gray-700">Fuel & Service Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Purpose</Label><Input value={editFormData.tripPurpose || ''} onChange={(e) => handleEditFieldChange('tripPurpose', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Amount (KES)</Label><Input type="number" value={editFormData.fuelAmount || ''} onChange={(e) => handleEditFieldChange('fuelAmount', Number(e.target.value))} /></div>
                      <div className="space-y-2"><Label>Last Reading (km)</Label><Input type="number" value={editFormData.lastReading || ''} onChange={(e) => handleEditFieldChange('lastReading', Number(e.target.value))} /></div>
                      <div className="space-y-2"><Label>Current Reading (km)</Label><Input type="number" value={editFormData.currentReading || ''} onChange={(e) => handleEditFieldChange('currentReading', Number(e.target.value))} /></div>
                      <div className="space-y-2"><Label>Distance (km)</Label><Input type="number" value={editFormData.distanceTraveled || ''} onChange={(e) => handleEditFieldChange('distanceTraveled', Number(e.target.value))} /></div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 border p-4 rounded-lg bg-gray-50">
                    <h3 className="font-semibold text-sm uppercase text-gray-700">Perdiem Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Purpose</Label><Input value={editFormData.tripPurpose || ''} onChange={(e) => handleEditFieldChange('tripPurpose', e.target.value)} /></div>
                      <div className="space-y-2"><Label>From Location</Label><Input value={editFormData.fromLocation || ''} onChange={(e) => handleEditFieldChange('fromLocation', e.target.value)} /></div>
                      <div className="space-y-2"><Label>To Location</Label><Input value={editFormData.toLocation || ''} onChange={(e) => handleEditFieldChange('toLocation', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Trip Start Date</Label><Input type="date" value={toInputDate(editFormData.tripFrom)} onChange={(e) => handleEditFieldChange('tripFrom', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Trip End Date</Label><Input type="date" value={toInputDate(editFormData.tripTo)} onChange={(e) => handleEditFieldChange('tripTo', e.target.value)} /></div>
                      <div className="space-y-2"><Label>Days</Label><Input type="number" value={editFormData.numberOfDays || ''} onChange={(e) => handleEditFieldChange('numberOfDays', Number(e.target.value))} /></div>
                      <div className="space-y-2"><Label>Total (KES)</Label><Input type="number" value={editFormData.total || ''} onChange={(e) => handleEditFieldChange('total', Number(e.target.value))} /></div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label className="text-sm font-bold">Items</Label>
                        <Button size="sm" variant="outline" onClick={addPerdiemItem}><Plus className="h-4 w-4 mr-1"/> Add Item</Button>
                      </div>
                      <div className="space-y-2">
                        {editFormData.items && editFormData.items.map((item, idx) => (
                          <div key={idx} className="flex gap-2 items-center">
                            <Input type="date" className="flex-1" value={toInputDate(item.date)} onChange={(e) => handlePerdiemItemChange(idx, 'date', e.target.value)} />
                            <Input placeholder="Item Name" className="flex-[2]" value={item.name} onChange={(e) => handlePerdiemItemChange(idx, 'name', e.target.value)} />
                            <Input type="number" placeholder="Price" className="w-24" value={item.price} onChange={(e) => handlePerdiemItemChange(idx, 'price', Number(e.target.value))} />
                            <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => removePerdiemItem(idx)}><Minus className="h-4 w-4"/></Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={isSaving}><Save className="h-4 w-4 mr-2" /> {isSaving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DELETE DIALOG --- */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription className="text-base">
              You are about to delete <strong>{recordToDelete?.type}</strong> requisition submitted by <strong>{getOfficerName(recordToDelete)}</strong>.
              <br/><br/>
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={executeDelete} disabled={deleteLoading}>
              {deleteLoading ? "Deleting..." : "Yes, Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </>
  );
};

export default RequisitionsPage;
