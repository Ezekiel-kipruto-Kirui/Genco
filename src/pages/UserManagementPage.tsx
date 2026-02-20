import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import { ref, get, set, update, remove, push, serverTimestamp } from "firebase/database";
import { db, secondaryAuth } from "@/lib/firebase";
import { fetchCollection } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Download, Users, User, Edit, Trash2, Mail, Shield, Calendar, Eye, Phone, Plus, AlertTriangle, Briefcase } from "lucide-react"; // Added Briefcase
import { useToast } from "@/hooks/use-toast";
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

// --- Types ---
interface UserRecord {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  createdAt?: any;
  lastLogin?: any;
  status?: string;
  updatedAt?: any;
  uid?: string;
  allowedProgrammes?: { [key: string]: boolean };
}

interface Filters {
  search: string;
  role: string;
  status: string;
  programme: string;
  startDate: string;
  endDate: string;
}

interface Stats {
  totalUsers: number;
  activeUsers: number;
  adminUsers: number;
  chiefAdminUsers: number;
  mobileUsers: number;
  hrUsers: number; // Added HR to stats
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
  email: string;
  role: string;
  status: string;
  allowedProgrammes: { [key: string]: boolean };
}

interface AddUserForm {
  name: string;
  email: string;
  role: string;
  password: string;
  confirmPassword: string;
  allowedProgrammes: { [key: string]: boolean };
}

// --- Constants ---
const PAGE_LIMIT = 15;
const EXPORT_HEADERS = [
  'Name', 'Email', 'Role', 'Status', 'Created At', 'Last Login', 'Updated At'
];

// UPDATED: Now only contains KPMD and RANGE
const AVAILABLE_PROGRAMMES = [
  "KPMD", 
  "RANGE"
];

const USER_MANAGEMENT_CACHE_KEY = cacheKey("admin-page", "users");

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;  
  try {
    if (date?.toDate && typeof date.toDate === 'function') return date.toDate();
    else if (date && typeof date === 'object' && (date.seconds || date._seconds)) return new Date((date.seconds || date._seconds) * 1000);
    else if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    else if (typeof date === 'number') return new Date(date);
  } catch (error) {
    console.error('Error parsing date:', error);
  }
  return null;
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const formatLocalDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  
  return {
    startDate: formatLocalDate(startOfMonth),
    endDate: formatLocalDate(endOfMonth)
  };
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
    minute: '2-digit'
  }) : 'N/A';
};

const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

// --- Extracted Sub-Components (Optimization) ---

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
  children?: React.ReactNode;
}

const StatsCard = ({ title, value, icon: Icon, description, children }: StatsCardProps) => (
  <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-600"></div>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
      <CardTitle className="text-sm font-medium text-slate-700">{title}</CardTitle>
    </CardHeader>
    <CardContent className="pl-6 pb-4 flex flex-row">
      <div className="mr-2 rounded-full">
        <Icon className="h-8 w-8 text-blue-600" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 mb-2">{value}</div>
        {children}
        {description && (
          <p className="text-xs text-slate-600 mt-2 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
            {description}
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);

interface FilterSectionProps {
  searchValue: string;
  filters: Omit<Filters, 'search'>;
  uniqueRoles: string[];
  uniqueStatuses: string[];
  onSearch: (value: string) => void;
  onFilterChange: (key: keyof Omit<Filters, 'search'>, value: string) => void;
}

const FilterSection = ({ searchValue, filters, uniqueRoles, uniqueStatuses, onSearch, onFilterChange }: FilterSectionProps) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
    <div className="space-y-2">
      <Label htmlFor="search" className="font-semibold text-gray-700">Search</Label>
      <Input
        id="search"
        placeholder="Search users..."
        value={searchValue}
        onChange={(e) => onSearch(e.target.value)}
        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="role" className="font-semibold text-gray-700">Role</Label>
      <Select value={filters.role} onValueChange={(value) => onFilterChange("role", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white">
          <SelectValue placeholder="Select role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Roles</SelectItem>
          {uniqueRoles.map(role => (
            <SelectItem key={role} value={role}>
              {role.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label htmlFor="status" className="font-semibold text-gray-700">Status</Label>
      <Select value={filters.status} onValueChange={(value) => onFilterChange("status", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          {uniqueStatuses.map(status => (
            <SelectItem key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {/* Programme Filter */}
    <div className="space-y-2">
      <Label htmlFor="programme" className="font-semibold text-gray-700">Programme</Label>
      <Select value={filters.programme} onValueChange={(value) => onFilterChange("programme", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white">
          <SelectValue placeholder="Access Rights" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Programmes</SelectItem>
          {AVAILABLE_PROGRAMMES.map(prog => (
            <SelectItem key={prog} value={prog}>
              {prog}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label htmlFor="startDate" className="font-semibold text-gray-700">From Date</Label>
      <Input
        id="startDate"
        type="date"
        value={filters.startDate}
        onChange={(e) => onFilterChange("startDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="endDate" className="font-semibold text-gray-700">To Date</Label>
      <Input
        id="endDate"
        type="date"
        value={filters.endDate}
        onChange={(e) => onFilterChange("endDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
      />
    </div>
  </div>
);

interface TableRowProps {
  record: UserRecord;
  selectedRecords: string[];
  onSelectRecord: (id: string) => void;
  onView: (record: UserRecord) => void;
  onEdit: (record: UserRecord) => void;
  onDeleteClick: (record: UserRecord) => void;
  userRole: string | null;
}

const TableRow = ({ record, selectedRecords, onSelectRecord, onView, onEdit, onDeleteClick, userRole }: TableRowProps) => (
  <tr className="border-b hover:bg-blue-50 transition-all duration-200 group text-sm">
    <td className="py-2 px-4 ml-2">
      <Checkbox
        checked={selectedRecords.includes(record.id)}
        onCheckedChange={() => onSelectRecord(record.id)}
      />
    </td>
    <td className="py-2 px-4 text-sm">{record.name || 'N/A'}</td>
    <td className="py-2 px-4 text-sm">{record.email || 'N/A'}</td>
    <td className="py-2 px-4 text-sm">
      <Badge 
        variant="secondary"
        className={
          record.role === 'chief-admin' ? 'bg-purple-100 text-purple-800' :
          record.role === 'admin' ? 'bg-blue-100 text-blue-800' :
          record.role === 'hr' ? 'bg-orange-100 text-orange-800' : // Added HR Color
          record.role === 'mobile' ? 'bg-green-100 text-green-800' :
          'bg-gray-100 text-gray-800'
        }
      >
        {record.role ? record.role.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'N/A'}
      </Badge>
    </td>
    <td className="py-2 px-4 text-sm">
      <Badge 
        variant={record.status === 'active' ? 'default' : 'secondary'}
        className={record.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
      >
        {record.status ? record.status.charAt(0).toUpperCase() + record.status.slice(1) : 'N/A'}
      </Badge>
    </td>
    <td className="py-2 px-4 text-sm">{formatDate(record.createdAt)}</td>
    <td className="py-2 px-4 text-sm">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onView(record)}
          className="h-6 w-6 p-0 hover:bg-green-50 hover:text-green-600 border-green-200"
        >
          <Eye className="h-3 w-3 text-green-500" />
        </Button>
        {userRole === "chief-admin" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(record)}
              className="h-6 w-6 p-0 hover:bg-orange-50 hover:text-blue-600 border-gray-200"
            >
              <Edit className="h-3 w-3 text-orange-400" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeleteClick(record)}
              className="h-6 w-6 p-0 hover:bg-red-50 hover:text-red-600 border-red-200"
            >
              <Trash2 className="h-3 w-3 text-red-500" />
            </Button>
          </>
        )}
      </div>
    </td>
  </tr>
);

// --- Main Component ---

const UserManagementPage = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const userIsChiefAdmin = userRole === "chief-admin";
  const requireChiefAdmin = useCallback(() => {
    if (userIsChiefAdmin) return true;
    toast({
      title: "Access denied",
      description: "Only chief admin can create, edit, or delete records on this page.",
      variant: "destructive",
    });
    return false;
  }, [userIsChiefAdmin, toast]);
  
  // State
  const [allRecords, setAllRecords] = useState<UserRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<UserRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<UserRecord | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<UserRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  
  const currentMonth = useMemo(getCurrentMonthDates, []);

  // Separate search state with debouncing
  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebounce(searchValue, 300);

  const [filters, setFilters] = useState<Omit<Filters, 'search'>>({
    role: "all",
    status: "all",
    programme: "all",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
  });

  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeUsers: 0,
    adminUsers: 0,
    chiefAdminUsers: 0,
    mobileUsers: 0,
    hrUsers: 0, // Initialize HR Users
  });

  const [pagination, setPagination] = useState<Pagination>({
    page:1,
    limit: PAGE_LIMIT,
    totalPages:1,
    hasNext: false,
    hasPrev: false
  });

  const initialProgrammes = AVAILABLE_PROGRAMMES.reduce((acc, prog) => ({ ...acc, [prog]: false }), {});

  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    email: "",
    role: "",
    status: "active",
    allowedProgrammes: initialProgrammes
  });

  const [addForm, setAddForm] = useState<AddUserForm>({
    name: "",
    email: "",
    role: "user",
    password: "",
    confirmPassword: "",
    allowedProgrammes: initialProgrammes
  });

  // Data fetching
  const fetchAllData = useCallback(async () => {
    try {
      const cachedUsers = readCachedValue<UserRecord[]>(USER_MANAGEMENT_CACHE_KEY);
      if (cachedUsers) {
        setAllRecords(cachedUsers);
        setLoading(false);
      } else {
        setLoading(true);
      }
      
      // Only fetch Users
      const recordsData: UserRecord[] = (await fetchCollection("users")) as UserRecord[];
      
      recordsData.sort((a, b) => {
        const dateA = parseDate(a.createdAt) || new Date(0);
        const dateB = parseDate(b.createdAt) || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      setAllRecords(recordsData);
      if (recordsData.length > 0) {
        writeCachedValue(USER_MANAGEMENT_CACHE_KEY, recordsData);
      } else {
        removeCachedValue(USER_MANAGEMENT_CACHE_KEY);
      }
      
    } catch (error) {
      console.error("Error fetching data:", error);
      toast({
        title: "Error",
        description: "Failed to load users from database",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Main filtering logic
  const filterAndProcessData = useCallback((records: UserRecord[], searchTerm: string, filterParams: Omit<Filters, 'search'>) => {
    const filtered = records.filter(record => {
      if (filterParams.role !== "all" && record.role?.toLowerCase() !== filterParams.role.toLowerCase()) {
        return false;
      }

      if (filterParams.status !== "all" && record.status?.toLowerCase() !== filterParams.status.toLowerCase()) {
        return false;
      }

      // Programme Filter
      if (filterParams.programme !== "all") {
        const hasAccess = record.allowedProgrammes && record.allowedProgrammes[filterParams.programme] === true;
        if (!hasAccess) return false;
      }

      if (filterParams.startDate || filterParams.endDate) {
        const recordDate = parseDate(record.createdAt);
        if (recordDate) {
          const recordDateOnly = new Date(recordDate);
          recordDateOnly.setHours(0, 0, 0, 0);

          const startDate = filterParams.startDate ? new Date(filterParams.startDate) : null;
          const endDate = filterParams.endDate ? new Date(filterParams.endDate) : null;
          if (startDate) startDate.setHours(0, 0, 0, 0);
          if (endDate) endDate.setHours(23, 59, 59, 999);

          if (startDate && recordDateOnly < startDate) return false;
          if (endDate && recordDateOnly > endDate) return false;
        }
      }

      if (searchTerm) {
        const searchTermLower = searchTerm.toLowerCase();
        const searchMatch = [
          record.name, record.email, record.role
        ].some(field => field?.toLowerCase().includes(searchTermLower));
        if (!searchMatch) return false;
      }

      return true;
    });

    const activeUsers = filtered.filter(r => r.status?.toLowerCase() === 'active').length;
    const adminUsers = filtered.filter(r => r.role?.toLowerCase() === 'admin').length;
    const chiefAdminUsers = filtered.filter(r => r.role?.toLowerCase() === 'chief-admin').length;
    const mobileUsers = filtered.filter(r => r.role?.toLowerCase() === 'mobile').length;
    const hrUsers = filtered.filter(r => r.role?.toLowerCase() === 'hr').length; // Logic to count HR

    const calculatedStats = {
      totalUsers: filtered.length,
      activeUsers,
      adminUsers,
      chiefAdminUsers,
      mobileUsers,
      hrUsers, // Added to stats object
    };

    const totalPages = Math.ceil(filtered.length / PAGE_LIMIT);

    return {
      filteredRecords: filtered,
      stats: calculatedStats,
      totalPages
    };
  }, []);

  useEffect(() => {
    if (allRecords.length === 0) return;

    const result = filterAndProcessData(allRecords, debouncedSearch, filters);
    
    setFilteredRecords(result.filteredRecords);
    setStats(result.stats);
    
    setPagination(prev => ({
      ...prev,
      totalPages: result.totalPages,
      hasNext: prev.page < result.totalPages,
      hasPrev: prev.page > 1
    }));
  }, [allRecords, debouncedSearch, filters, filterAndProcessData]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleFilterChange = useCallback((key: keyof Omit<Filters, 'search'>, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleExport = useCallback(async () => {
    try {
      setExportLoading(true);
      
      if (filteredRecords.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no users matching your current filters",
          variant: "destructive",
        });
        return;
      }

      const csvData = filteredRecords.map(record => [
        record.name || 'N/A',
        record.email || 'N/A',
        record.role || 'N/A',
        record.status || 'N/A',
        formatDate(record.createdAt),
        formatDate(record.lastLogin),
        formatDate(record.updatedAt)
      ]);

      const csvContent = [EXPORT_HEADERS, ...csvData]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      let filename = `users-management`;
      if (filters.startDate || filters.endDate) {
        filename += `_${filters.startDate || 'start'}_to_${filters.endDate || 'end'}`;
      }
      filename += `_${new Date().toISOString().split('T')[0]}.csv`;
      
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Export Successful",
        description: `Exported ${filteredRecords.length} users with applied filters`,
      });

    } catch (error) {
      console.error("Error exporting data:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportLoading(false);
    }
  }, [filteredRecords, filters.startDate, filters.endDate, toast]);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  }, []);

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredRecords.slice(startIndex, endIndex);
  }, [filteredRecords, pagination.page, pagination.limit]);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords(prev =>
      prev.includes(recordId)
        ? prev.filter(id => id !== recordId)
        : [...prev, recordId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = getCurrentPageRecords().map(r => r.id);
    setSelectedRecords(prev =>
      prev.length === currentPageIds.length ? [] : currentPageIds
    );
  }, [getCurrentPageRecords]);

  const openEditDialog = useCallback((record: UserRecord) => {
    if (!userIsChiefAdmin) return;
    setEditingRecord(record);
    
    const existingProgs = record.allowedProgrammes || {};
    const mergedProgs = AVAILABLE_PROGRAMMES.reduce((acc, prog) => ({
      ...acc,
      [prog]: !!existingProgs[prog]
    }), {});

    setEditForm({
      name: record.name || "",
      email: record.email || "",
      role: record.role || "",
      status: record.status || "active",
      allowedProgrammes: mergedProgs
    });
    setIsEditDialogOpen(true);
  }, [userIsChiefAdmin]);

  const openViewDialog = useCallback((record: UserRecord) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  }, []);

  const openAddDialog = useCallback(() => {
    if (!userIsChiefAdmin) return;
    setAddForm({
      name: "",
      email: "",
      role: "user",
      password: "",
      confirmPassword: "",
      allowedProgrammes: initialProgrammes
    });
    setIsAddDialogOpen(true);
  }, [initialProgrammes, userIsChiefAdmin]);

  const openDeleteDialog = useCallback((record: UserRecord) => {
    if (!userIsChiefAdmin) return;
    setRecordToDelete(record);
    setIsDeleteDialogOpen(true);
  }, [userIsChiefAdmin]);

  const openBulkDeleteDialog = useCallback(() => {
    if (!userIsChiefAdmin) return;
    if (selectedRecords.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  }, [selectedRecords, userIsChiefAdmin]);

  const handleEditSubmit = useCallback(async () => {
    if (!requireChiefAdmin()) return;
    if (!editingRecord) return;

    try {
      await update(ref(db, `users/${editingRecord.id}`), {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        status: editForm.status,
        allowedProgrammes: editForm.allowedProgrammes,
        updatedAt: serverTimestamp()
      });

      toast({
        title: "Success",
        description: "User updated successfully",
      });

      removeCachedValue(USER_MANAGEMENT_CACHE_KEY);
      setIsEditDialogOpen(false);
      setEditingRecord(null);
      fetchAllData();
    } catch (error) {
      console.error("Error updating user:", error);
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive",
      });
    }
  }, [editingRecord, editForm, fetchAllData, toast, requireChiefAdmin]);

  const handleAddUser = useCallback(async () => {
    if (!requireChiefAdmin()) return;
    if (!addForm.name || !addForm.email || !addForm.password) {
      toast({ title: "Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    if (addForm.password !== addForm.confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }

    try {
      setAddLoading(true);

      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        addForm.email,
        addForm.password
      );

      const newUser = userCredential.user;

      await set(ref(db, `users/${newUser.uid}`), {
        uid: newUser.uid, 
        name: addForm.name,
        email: addForm.email,
        role: addForm.role,
        status: "active",
        allowedProgrammes: addForm.allowedProgrammes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast({ title: "Success", description: "User created successfully!" });

      setIsAddDialogOpen(false);
      setAddForm({
        name: "",
        email: "",
        role: "user",
        password: "",
        confirmPassword: "",
        allowedProgrammes: initialProgrammes
      });

      removeCachedValue(USER_MANAGEMENT_CACHE_KEY);
      fetchAllData();

    } catch (error: any) {
      console.error("CREATE USER ERROR:", error);
      let msg = "Failed to create user";

      if (error.code === "auth/email-already-in-use") msg = "Email already in use";
      if (error.code === "auth/invalid-email") msg = "Invalid email";
      if (error.code === "auth/weak-password") msg = "Weak password";

      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setAddLoading(false);
    }
  }, [addForm, toast, fetchAllData, initialProgrammes, requireChiefAdmin]);

  const handleDeleteSingle = useCallback(async () => {
    if (!requireChiefAdmin()) return;
    if (!recordToDelete) return;

    try {
      setDeleteLoading(true);

      if (recordToDelete.uid) {
        try {
          console.warn("User has Auth account. Consider implementing backend deletion for Auth users.");
        } catch (authError) {
          console.error("Error deleting user from Auth:", authError);
        }
      }

      await remove(ref(db, `users/${recordToDelete.id}`));

      toast({
        title: "Success",
        description: "User deleted successfully",
      });

      removeCachedValue(USER_MANAGEMENT_CACHE_KEY);
      setIsDeleteDialogOpen(false);
      setRecordToDelete(null);
      setSelectedRecords(prev => prev.filter(id => id !== recordToDelete.id));
      fetchAllData();
    } catch (error) {
      console.error("Error deleting user:", error);
      toast({
        title: "Error",
        description: "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  }, [recordToDelete, fetchAllData, toast, requireChiefAdmin]);

  const handleDeleteSelected = useCallback(async () => {
    if (!requireChiefAdmin()) return;
    if (selectedRecords.length === 0) return;

    try {
      setDeleteLoading(true);
      
      await Promise.all(selectedRecords.map(recordId => 
        remove(ref(db, `users/${recordId}`))
      ));

      toast({
        title: "Success",
        description: `Deleted ${selectedRecords.length} users successfully`,
      });

      removeCachedValue(USER_MANAGEMENT_CACHE_KEY);
      setIsBulkDeleteDialogOpen(false);
      setSelectedRecords([]);
      fetchAllData();
    } catch (error) {
      console.error("Error deleting users:", error);
      toast({
        title: "Error",
        description: "Failed to delete users",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  }, [selectedRecords, fetchAllData, toast, requireChiefAdmin]);

  const uniqueRoles = useMemo(() =>
    ["chief-admin", "admin", "user", "mobile", "hr"], // Added "hr" to lowercase
    []
  );

  const uniqueStatuses = useMemo(() => 
    ["active", "inactive"],
    []
  );

  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const clearAllFilters = useCallback(() => {
    setSearchValue("");
    setFilters({
      role: "all",
      status: "all",
      programme: "all",
      startDate: "",
      endDate: "",
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const resetToCurrentMonth = useCallback(() => {
    setFilters(prev => ({ ...prev, ...currentMonth }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [currentMonth]);

  const toggleProgramme = (prog: string, isEdit: boolean) => {
    const setter = isEdit ? setEditForm : setAddForm;
    setter(prev => ({
      ...prev,
      allowedProgrammes: {
        ...prev.allowedProgrammes,
        [prog]: !prev.allowedProgrammes[prog]
      }
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div>
          <h2 className="text-md font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            User Management
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
          <Button variant="outline" size="sm" onClick={clearAllFilters} className="text-xs border-gray-300 hover:bg-gray-50">
            Clear All Filters
          </Button>
          <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="text-xs border-gray-300 hover:bg-gray-50">
            This Month
          </Button>
          {userRole === "chief-admin" && ( 
            <>
              <Button onClick={openAddDialog} className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white shadow-md text-xs">
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </Button>
              {selectedRecords.length > 0 && (
                <Button onClick={openBulkDeleteDialog} variant="destructive" className="text-xs">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected ({selectedRecords.length})
                </Button>
              )}
            </>
           )} 
          <Button onClick={handleExport} disabled={exportLoading || filteredRecords.length === 0} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs">
            <Download className="h-4 w-4 mr-2" />
            {exportLoading ? "Exporting..." : `Export (${filteredRecords.length})`}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatsCard title="Total Users" value={stats.totalUsers} icon={Users}>
          <div className="flex gap-4 justify-between text-xs text-slate-600 mt-2">
            <span>Active: {stats.activeUsers}</span>
            <span>Inactive: {stats.totalUsers - stats.activeUsers}</span>
          </div>
        </StatsCard>

        <StatsCard title="Admin Users" value={stats.adminUsers} icon={Shield} description="Administrative users" />
        <StatsCard title="HR Users" value={stats.hrUsers} icon={Briefcase} description="Human Resources" /> {/* Added HR Stats Card */}
        <StatsCard title="Chief Admins" value={stats.chiefAdminUsers} icon={User} description="Chief administrators" />
        <StatsCard title="Mobile Users" value={stats.mobileUsers} icon={Phone} description="Mobile app users" />
      </div>

      {/* Filters */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          <FilterSection 
            searchValue={searchValue}
            filters={filters}
            uniqueRoles={uniqueRoles}
            uniqueStatuses={uniqueStatuses}
            onSearch={handleSearch}
            onFilterChange={handleFilterChange}
          />
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading users...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {allRecords.length === 0 ? "No users found" : "No users found matching your criteria"}
            </div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead className="rounded">
                    <tr className="bg-blue-100 p-1 px-3">
                      <th className="py-2 px-4 ml-2">
                        <Checkbox
                          checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Name</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Email</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Role</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Status</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Created</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <TableRow 
                        key={record.id} 
                        record={record}
                        selectedRecords={selectedRecords}
                        onSelectRecord={handleSelectRecord}
                        onView={openViewDialog}
                        onEdit={openEditDialog}
                        onDeleteClick={openDeleteDialog}
                        userRole={userRole}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-sm text-muted-foreground">
                  {filteredRecords.length} total users • {currentPageRecords.length} on this page
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)} className="border-gray-300 hover:bg-gray-100">
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)} className="border-gray-300 hover:bg-gray-100">
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View User Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Eye className="h-5 w-5 text-green-600" />
              User Details
            </DialogTitle>
            <DialogDescription>Complete information for this user</DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" /> Personal Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Name</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.name || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Email</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.email || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Role</Label>
                    <Badge variant="secondary" className={
                      viewingRecord.role === 'chief-admin' ? 'bg-purple-100 text-purple-800' :
                      viewingRecord.role === 'admin' ? 'bg-blue-100 text-blue-800' :
                      viewingRecord.role === 'hr' ? 'bg-orange-100 text-orange-800' : // Added HR View Color
                      viewingRecord.role === 'mobile' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }>
                      {viewingRecord.role ? viewingRecord.role.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'N/A'}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Status</Label>
                    <Badge variant={viewingRecord.status === 'active' ? 'default' : 'secondary'} className={viewingRecord.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                      {viewingRecord.status ? viewingRecord.status.charAt(0).toUpperCase() + viewingRecord.status.slice(1) : 'N/A'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Allowed Programmes
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(viewingRecord.allowedProgrammes || {}).length > 0 ? (
                    Object.entries(viewingRecord.allowedProgrammes || {})
                      .filter(([_, allowed]) => allowed)
                      .map(([prog, _]) => (
                        <Badge key={prog} variant="outline" className="bg-white border-blue-200 text-blue-700">
                          {prog}
                        </Badge>
                      ))
                  ) : (
                    <span className="text-sm text-slate-500 italic">No specific programmes assigned</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Account Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Created At</Label>
                    <p className="text-slate-900 font-medium">{formatDateTime(viewingRecord.createdAt)}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Last Login</Label>
                    <p className="text-slate-900 font-medium">{formatDateTime(viewingRecord.lastLogin)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsViewDialogOpen(false)} className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      {userRole === "chief-admin" &&  
      (
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="sm:max-w-2xl bg-white rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-900">
                <Plus className="h-5 w-5 text-green-600" />
                Add New User
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-name" className="text-sm font-medium text-slate-700">Name *</Label>
                  <Input id="add-name" value={addForm.name} onChange={(e) => setAddForm(prev => ({ ...prev, name: e.target.value }))} className="bg-white border-slate-300" placeholder="Enter full name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-email" className="text-sm font-medium text-slate-700">Email *</Label>
                  <Input id="add-email" type="email" value={addForm.email} onChange={(e) => setAddForm(prev => ({ ...prev, email: e.target.value }))} className="bg-white border-slate-300" placeholder="Enter email address" />
                </div>
              </div>              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-role" className="text-sm font-medium text-slate-700">Role *</Label>
                  <Select value={addForm.role} onValueChange={(value) => setAddForm(prev => ({ ...prev, role: value }))}>
                    <SelectTrigger className="bg-white border-slate-300"><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="hr">HR</SelectItem> {/* Added HR Role to Add Dialog */}
                      <SelectItem value="chief-admin">Chief Admin</SelectItem>
                      <SelectItem value="mobile">Mobile User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="add-password" className="text-sm font-medium text-slate-700">Password *</Label>
                  <Input id="add-password" type="password" value={addForm.password} onChange={(e) => setAddForm(prev => ({ ...prev, password: e.target.value }))} className="bg-white border-slate-300" placeholder="Enter password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-confirm-password" className="text-sm font-medium text-slate-700">Confirm Password *</Label>
                  <Input id="add-confirm-password" type="password" value={addForm.confirmPassword} onChange={(e) => setAddForm(prev => ({ ...prev, confirmPassword: e.target.value }))} className="bg-white border-slate-300" placeholder="Confirm password" />
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <Label className="text-sm font-bold text-slate-700">Allowed Programmes (Data Access)</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {AVAILABLE_PROGRAMMES.map((prog) => (
                    <div key={prog} className="flex items-center space-x-2 border p-2 rounded-md hover:bg-slate-50">
                      <Checkbox
                        id={`add-prog-${prog}`}
                        checked={!!addForm.allowedProgrammes[prog]}
                        onCheckedChange={() => toggleProgramme(prog, false)}
                      />
                      <label
                        htmlFor={`add-prog-${prog}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {prog}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="border-slate-300">Cancel</Button>
              <Button onClick={handleAddUser} disabled={addLoading} className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white">
                {addLoading ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
       )} 

      {/* Edit Dialog */}
      {userRole === "chief-admin" && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-2xl bg-white rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-slate-900">
                <Edit className="h-5 w-5 text-blue-600" />
                Edit User
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name" className="text-sm font-medium text-slate-700">Name</Label>
                  <Input id="edit-name" value={editForm.name} onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))} className="bg-white border-slate-300" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email" className="text-sm font-medium text-slate-700">Email</Label>
                  <Input id="edit-email" value={editForm.email} onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))} className="bg-white border-slate-300" />
                </div>
              </div>              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-role" className="text-sm font-medium text-slate-700">Role</Label>
                  <Select value={editForm.role} onValueChange={(value) => setEditForm(prev => ({ ...prev, role: value }))}>
                    <SelectTrigger className="bg-white border-slate-300"><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="hr">HR</SelectItem> {/* Added HR Role to Edit Dialog */}
                      <SelectItem value="chief-admin">Chief Admin</SelectItem>
                      <SelectItem value="mobile">Mobile User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-status" className="text-sm font-medium text-slate-700">Status</Label>
                  <Select value={editForm.status} onValueChange={(value) => setEditForm(prev => ({ ...prev, status: value }))}>
                    <SelectTrigger className="bg-white border-slate-300"><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <Label className="text-sm font-bold text-slate-700">Allowed Programmes (Data Access)</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {AVAILABLE_PROGRAMMES.map((prog) => (
                    <div key={prog} className="flex items-center space-x-2 border p-2 rounded-md hover:bg-slate-50">
                      <Checkbox
                        id={`edit-prog-${prog}`}
                        checked={!!editForm.allowedProgrammes[prog]}
                        onCheckedChange={() => toggleProgramme(prog, true)}
                      />
                      <label
                        htmlFor={`edit-prog-${prog}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {prog}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="border-slate-300">Cancel</Button>
              <Button onClick={handleEditSubmit} className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white">
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Single Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete User
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete user <strong>"{recordToDelete?.name}"</strong>? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSingle} disabled={deleteLoading} className="bg-red-600 hover:bg-red-700 text-white">
              {deleteLoading ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete Multiple Users
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedRecords.length} users</strong>? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected} disabled={deleteLoading} className="bg-red-600 hover:bg-red-700 text-white">
              {deleteLoading ? "Deleting..." : `Delete ${selectedRecords.length} Users`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UserManagementPage;

