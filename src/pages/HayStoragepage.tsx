import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
// REALTIME DATABASE IMPORTS
import {
  ref,
  push,
  update,
  remove,
  get,
  Database,
  DatabaseReference
} from "firebase/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Download, Warehouse, Eye, Calendar, Building, DollarSign, Package, Archive, Edit, Save, X, Upload, Trash2, Plus, LandPlot, Scale } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";
import { uploadDataWithValidation, formatValidationErrors, UploadResult } from "@/lib/uploads-util";
import { db } from "@/lib/firebase";

// --- Types ---

interface PastureStage {
  stage: string;
  date: string;
}

interface HayStorage {
  id: string;
  date_planted: any; // ISO String or Date object
  location: string;
  county: string;
  subcounty: string;
  land_under_pasture: number;
  land_ownership: string; // NEW FIELD: 'Community Owned' | 'Leased'
  pasture_stages: PastureStage[];
  storage_facility?: string;
  bales_harvested_stored?: number;
  bales_sold?: number;
  date_sold?: any;
  revenue_generated?: number;
  created_at: any;
  created_by: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  county: string;
  subcounty: string;
}

interface Stats {
  totalLandUnderPasture: number;
  totalRevenue: number;
  totalBalesHarvested: number;
  totalFacilities: number;
  totalBalesBalance: number; // NEW STAT
}

// Props for extracted components
interface StatsCardProps {
  title: string;
  value: string | number;
  icon: any;
  description?: string;
}

interface FilterSectionProps {
  filters: Filters;
  uniqueCounties: string[];
  onSearch: (value: string) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
}

interface TableRowProps {
  record: HayStorage;
  isSelected: boolean;
  onSelectRecord: (id: string) => void;
  onView: (record: HayStorage) => void;
  onEdit: (record: HayStorage) => void;
  onDeleteSelect: (id: string) => void;
  userIsChiefAdmin: boolean;
}

// --- Constants ---
const PAGE_LIMIT = 15;
const SEARCH_DEBOUNCE_DELAY = 300;
const PASTURE_STAGES = [
  "land preparation",
  "planting",
  "early growth",
  "vegetative growth",
  "preflowering stage",
  "harvesting",
  "baling"
];

// --- Helper Functions ---

const parseDate = (date: any): Date | null => {
  if (!date) return null;
  try {
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof date === 'number') return new Date(date);
    if (date?.seconds) return new Date(date.seconds * 1000);
    if (date?._seconds) return new Date(date._seconds * 1000);
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

const formatDateForInput = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? parsedDate.toISOString().split('T')[0] : '';
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amount || 0);
};

const formatArea = (area: number): string => {
  return new Intl.NumberFormat('en-KE').format(area || 0) + ' acres';
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

// --- Extracted Sub-Components (Optimization) ---

const StatsCard = ({ title, value, icon: Icon, description }: StatsCardProps) => (
  <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-600"></div>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
      <CardTitle className="text-sm font-medium text-slate-700">{title}</CardTitle>
    </CardHeader>
    <CardContent className="pl-6 pb-4 flex flex-row">
      <div className="mr-2 rounded-full p-2 bg-blue-50 text-blue-600">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 mb-2">{value}</div>
        {description && <p className="text-xs text-slate-600 mt-2 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>}
      </div>
    </CardContent>
  </Card>
);

const FilterSection = ({ filters, uniqueCounties, onSearch, onFilterChange }: FilterSectionProps) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <div className="space-y-2">
      <Label htmlFor="search" className="font-semibold text-gray-700">Search</Label>
      <Input
        id="search"
        placeholder="Search hay storage..."
        onChange={(e) => onSearch(e.target.value)}
        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="county" className="font-semibold text-gray-700">County</Label>
      <Select value={filters.county} onValueChange={(value) => onFilterChange("county", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white">
          <SelectValue placeholder="Select county" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Counties</SelectItem>
          {uniqueCounties.slice(0, 20).map(county => (
            <SelectItem key={county} value={county}>{county}</SelectItem>
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

const TableRow = ({ record, isSelected, onSelectRecord, onView, onEdit, onDeleteSelect, userIsChiefAdmin }: TableRowProps) => {
  // Calculate Balance
  const balance = (record.bales_harvested_stored || 0) - (record.bales_sold || 0);
  const balanceColor = balance >= 0 ? "text-green-600" : "text-red-600";

  return (
  <tr className="border-b hover:bg-blue-50 transition-colors duration-200 group text-sm">
    <td className="py-3 px-4">
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onSelectRecord(record.id)}
      />
    </td>
    <td className="py-3 px-4">{formatDate(record.date_planted)}</td>
    <td className="py-3 px-4">{record.location || 'N/A'}</td>
    <td className="py-3 px-4">{record.land_under_pasture || 0} acres</td>
    <td className="py-3 px-4 capitalize"><Badge variant="outline">{record.land_ownership || 'N/A'}</Badge></td>
    <td className="py-3 px-4">
      {record.pasture_stages.length > 0 ? (
        <Badge variant="outline" className="bg-blue-50 text-blue-700">
          {record.pasture_stages.length} stages
        </Badge>
      ) : (
        'No stages'
      )}
    </td>
    <td className="py-3 px-4">
      {record.storage_facility ? (
        <span className="font-medium text-slate-700">{record.storage_facility}</span>
      ) : (
        <span className="text-gray-400">No facility</span>
      )}
    </td>
    <td className="py-3 px-4">{record.bales_harvested_stored || 0}</td>
    <td className="py-3 px-4">{record.bales_sold || 0}</td>
    <td className="py-3 px-4 font-bold {balanceColor}">{balance}</td>
    <td className="py-3 px-4">{formatCurrency(record.revenue_generated || 0)}</td>
    <td className="py-3 px-4">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onView(record)}
          className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600 border-blue-200"
          aria-label="View record"
        >
          <Eye className="h-4 w-4 text-blue-500" />
        </Button>
        {userIsChiefAdmin && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(record)}
              className="h-8 w-8 p-0 hover:bg-green-50 hover:text-green-600 border-green-200"
              aria-label="Edit record"
            >
              <Edit className="h-4 w-4 text-green-500" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeleteSelect(record.id)}
              className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 border-red-200"
              aria-label="Delete record"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </>
        )}
      </div>
    </td>
  </tr>
)};

// --- Main Component ---

const HayStoragePage = () => {
  const { userRole, user } = useAuth();
  const { toast } = useToast();

  // Ensure 'db' is treated as Realtime Database instance
  const rtdb = db as Database;

  // State
  const [allHayStorage, setAllHayStorage] = useState<HayStorage[]>([]);
  const [filteredHayStorage, setFilteredHayStorage] = useState<HayStorage[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);

  // Dialog States
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // Data States
  const [viewingRecord, setViewingRecord] = useState<HayStorage | null>(null);
  const [editingRecord, setEditingRecord] = useState<HayStorage | null>(null);
  const [addingRecord, setAddingRecord] = useState<Partial<HayStorage>>({
    date_planted: '',
    location: '',
    county: '',
    subcounty: '',
    land_under_pasture: 0,
    land_ownership: '', // NEW FIELD
    pasture_stages: [
      { stage: '', date: '' },
      { stage: '', date: '' },
      { stage: '', date: '' }
    ],
    storage_facility: '',
    bales_harvested_stored: 0,
    bales_sold: 0,
    date_sold: '',
    revenue_generated: 0
  });

  // Upload State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    county: "all",
    subcounty: "all",
  });

  const [stats, setStats] = useState<Stats>({
    totalLandUnderPasture: 0,
    totalRevenue: 0,
    totalBalesHarvested: 0,
    totalFacilities: 0,
    totalBalesBalance: 0,
  });

  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  // Derived Data
  const uniqueCounties = useMemo(() => {
    const counties = [...new Set(allHayStorage.map(f => f.county).filter(Boolean))] as string[];
    return counties;
  }, [allHayStorage]);

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);

  // Handlers
  const handleSearch = useCallback((value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value }));
      setPagination(prev => ({ ...prev, page: 1 }));
    }, SEARCH_DEBOUNCE_DELAY);
  }, []);

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords(prev =>
      prev.includes(recordId)
        ? prev.filter(id => id !== recordId)
        : [...prev, recordId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageRecords = getCurrentPageRecords();
    const currentPageIds = currentPageRecords.map(f => f.id);
    setSelectedRecords(prev =>
      prev.length === currentPageIds.length && currentPageIds.length > 0 ? [] : currentPageIds
    );
  }, [filteredHayStorage, pagination.page, pagination.limit]);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  }, []);

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredHayStorage.slice(startIndex, endIndex);
  }, [filteredHayStorage, pagination.page, pagination.limit]);

  const openViewDialog = useCallback((record: HayStorage) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((record: HayStorage) => {
    setEditingRecord({
      ...record,
      pasture_stages: [...record.pasture_stages]
    });
    setIsEditDialogOpen(true);
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditingRecord(null);
    setIsEditDialogOpen(false);
  }, []);

  const closeAddDialog = useCallback(() => {
    setIsAddDialogOpen(false);
  }, []);

  // --- REALTIME DATABASE FETCH ---
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      const hayStorageRef = ref(rtdb, "HayStorage");
      const snapshot = await get(hayStorageRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const hayStorageData = Object.keys(data).map((key) => {
          const item = data[key];
          return {
            id: key,
            date_planted: item.date_planted,
            location: item.location || '',
            county: item.county || '',
            subcounty: item.subcounty || '',
            land_under_pasture: Number(item.land_under_pasture || 0),
            land_ownership: item.land_ownership || 'N/A', // NEW FIELD
            pasture_stages: item.pasture_stages || [],
            storage_facility: item.storage_facility || '',
            bales_harvested_stored: Number(item.bales_harvested_stored || 0),
            bales_sold: Number(item.bales_sold || 0),
            date_sold: item.date_sold,
            revenue_generated: Number(item.revenue_generated || 0),
            created_at: item.created_at,
            created_by: item.created_by || 'unknown'
          };
        });
        setAllHayStorage(hayStorageData);
      } else {
        setAllHayStorage([]);
      }

    } catch (error) {
      console.error("Error fetching hay storage data:", error);
      toast({
        title: "Error",
        description: "Failed to load hay storage data from database",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, rtdb]);

  const applyFilters = useCallback(() => {
    if (allHayStorage.length === 0) {
      setFilteredHayStorage([]);
      setStats({
        totalLandUnderPasture: 0,
        totalRevenue: 0,
        totalBalesHarvested: 0,
        totalFacilities: 0,
        totalBalesBalance: 0
      });
      return;
    }

    let filtered = allHayStorage.filter(record => {
      if (filters.county !== "all" && record.county?.toLowerCase() !== filters.county.toLowerCase()) return false;
      if (filters.subcounty !== "all" && record.subcounty?.toLowerCase() !== filters.subcounty.toLowerCase()) return false;

      if (filters.startDate || filters.endDate) {
        const recordDate = parseDate(record.date_planted);
        if (recordDate) {
          const recordDateOnly = new Date(recordDate);
          recordDateOnly.setHours(0, 0, 0, 0);
          const startDate = filters.startDate ? new Date(filters.startDate) : null;
          const endDate = filters.endDate ? new Date(filters.endDate) : null;
          if (startDate) startDate.setHours(0, 0, 0, 0);
          if (endDate) endDate.setHours(23, 59, 59, 999);

          if (startDate && recordDateOnly < startDate) return false;
          if (endDate && recordDateOnly > endDate) return false;
        } else if (filters.startDate || filters.endDate) {
          return false;
        }
      }

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = [
          record.location, record.county, record.subcounty, record.storage_facility, record.land_ownership
        ].some(field => field?.toLowerCase().includes(searchTerm));
        if (!searchMatch) return false;
      }
      return true;
    });

    setFilteredHayStorage(filtered);

    const totalRevenue = filtered.reduce((sum, record) => sum + (record.revenue_generated || 0), 0);
    const totalBalesHarvested = filtered.reduce((sum, record) => sum + (record.bales_harvested_stored || 0), 0);
    const totalBalesSold = filtered.reduce((sum, record) => sum + (record.bales_sold || 0), 0);
    const totalLandUnderPasture = filtered.reduce((sum, record) => sum + (record.land_under_pasture || 0), 0);
    const uniqueFacilities = new Set(filtered.map(record => record.storage_facility).filter(facility => facility && facility.trim() !== ''));

    setStats({
      totalLandUnderPasture,
      totalRevenue,
      totalBalesHarvested,
      totalFacilities: uniqueFacilities.size,
      totalBalesBalance: totalBalesHarvested - totalBalesSold // NEW STAT CALCULATION
    });

    const totalPages = Math.ceil(filtered.length / pagination.limit);
    setPagination(prev => ({
      ...prev,
      totalPages,
      hasNext: prev.page < totalPages,
      hasPrev: prev.page > 1
    }));
  }, [allHayStorage, filters, pagination.limit]);

  // --- REALTIME DATABASE ADD FUNCTION (WITH TOP UP LOGIC) ---
  const handleAddRecord = async () => {
    // Validation
    if (!addingRecord.date_planted || !addingRecord.location || !addingRecord.county || !addingRecord.subcounty || !addingRecord.land_ownership) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields (Date, Location, County, Subcounty, Ownership).",
        variant: "destructive"
      });
      return;
    }

    try {
      setAdding(true);

      const validStages = (addingRecord.pasture_stages || [])
        .filter(stage => stage.stage.trim() !== '' && stage.date.trim() !== '');

      // Check for existing record (Top Up Logic)
      // We match by Location AND County to ensure we update the correct farm
      const existingRecord = allHayStorage.find(r => 
        r.location.toLowerCase() === addingRecord.location.toLowerCase() && 
        r.county.toLowerCase() === addingRecord.county.toLowerCase()
      );

      if (existingRecord) {
        // --- TOP UP LOGIC ---
        // Update existing record by summing values
        const updatedPayload = {
          bales_harvested_stored: (existingRecord.bales_harvested_stored || 0) + (Number(addingRecord.bales_harvested_stored) || 0),
          bales_sold: (existingRecord.bales_sold || 0) + (Number(addingRecord.bales_sold) || 0),
          revenue_generated: (existingRecord.revenue_generated || 0) + (Number(addingRecord.revenue_generated) || 0),
          // Note: We generally do NOT update date_planted for a top-up to preserve original planting date,
          // unless specific business logic dictates otherwise. We keep the original land details.
          pasture_stages: [...(existingRecord.pasture_stages || []), ...validStages], // Append new stages
          // Update storage facility if the new one is provided
          storage_facility: addingRecord.storage_facility || existingRecord.storage_facility
        };

        await update(ref(rtdb, "HayStorage/" + existingRecord.id), updatedPayload);
        toast({
          title: "Success",
          description: "Existing record topped up successfully.",
        });
      } else {
        // --- CREATE NEW RECORD ---
        const payload = {
          date_planted: new Date(addingRecord.date_planted).toISOString(),
          location: addingRecord.location,
          county: addingRecord.county,
          subcounty: addingRecord.subcounty,
          land_under_pasture: Number(addingRecord.land_under_pasture) || 0,
          land_ownership: addingRecord.land_ownership, // NEW FIELD
          pasture_stages: validStages,
          storage_facility: addingRecord.storage_facility || '',
          bales_harvested_stored: Number(addingRecord.bales_harvested_stored) || 0,
          bales_sold: Number(addingRecord.bales_sold) || 0,
          date_sold: addingRecord.date_sold ? new Date(addingRecord.date_sold).toISOString() : null,
          revenue_generated: Number(addingRecord.revenue_generated) || 0,
          created_at: new Date().toISOString(),
          created_by: user?.email || 'unknown'
        };

        const listRef = ref(rtdb, "HayStorage");
        const newRef: DatabaseReference = push(listRef);
        await update(newRef, payload);

        toast({
          title: "Success",
          description: "Hay storage record created successfully."
        });
      }

      // Reset Form
      setIsAddDialogOpen(false);
      setAddingRecord({
        date_planted: '',
        location: '',
        county: '',
        subcounty: '',
        land_under_pasture: 0,
        land_ownership: '',
        pasture_stages: [
            { stage: '', date: '' },
            { stage: '', date: '' },
            { stage: '', date: '' }
        ],
        storage_facility: '',
        bales_harvested_stored: 0,
        bales_sold: 0,
        date_sold: '',
        revenue_generated: 0
      });

      await fetchAllData();

    } catch (error) {
      console.error("Error adding record:", error);
      toast({
        title: "Error",
        description: "Failed to save record. Please try again.",
        variant: "destructive"
      });
    } finally {
      setAdding(false);
    }
  };

  const addPastureStage = () => setAddingRecord(prev => ({ ...prev, pasture_stages: [...(prev.pasture_stages || []), { stage: '', date: '' }] }));

  const updatePastureStage = (index: number, field: keyof PastureStage, value: string) => {
    setAddingRecord(prev => {
      const updatedStages = [...(prev.pasture_stages || [])];
      if (updatedStages[index]) updatedStages[index] = { ...updatedStages[index], [field]: value };
      return { ...prev, pasture_stages: updatedStages };
    });
  };

  const removePastureStage = (index: number) => setAddingRecord(prev => ({ ...prev, pasture_stages: (prev.pasture_stages || []).filter((_, i) => i !== index) }));

  // Edit Functions
  const addEditPastureStage = () => {
    if (editingRecord) setEditingRecord(prev => prev ? { ...prev, pasture_stages: [...prev.pasture_stages, { stage: '', date: '' }] } : null);
  };

  const updateEditPastureStage = (index: number, field: keyof PastureStage, value: string) => {
    if (editingRecord) {
      setEditingRecord(prev => {
        if (!prev) return null;
        const updatedStages = [...prev.pasture_stages];
        if (updatedStages[index]) updatedStages[index] = { ...updatedStages[index], [field]: value };
        return { ...prev, pasture_stages: updatedStages };
      });
    }
  };

  const removeEditPastureStage = (index: number) => {
    if (editingRecord) setEditingRecord(prev => prev ? { ...prev, pasture_stages: prev.pasture_stages.filter((_, i) => i !== index) } : null);
  };

  const handleEditChange = (field: keyof HayStorage, value: any) => {
    if (editingRecord) setEditingRecord(prev => prev ? { ...prev, [field]: value } : null);
  };

  // --- REALTIME DATABASE UPDATE FUNCTION ---
  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    try {
      setSaving(true);
      const filteredStages = editingRecord.pasture_stages.filter(stage => stage.stage.trim() !== '' && stage.date.trim() !== '');
      const { id, ...updateData } = {
          ...editingRecord,
          pasture_stages: filteredStages,
          date_planted: editingRecord.date_planted ? new Date(editingRecord.date_planted).toISOString() : null,
          date_sold: editingRecord.date_sold ? new Date(editingRecord.date_sold).toISOString() : null
      };

      await update(ref(rtdb, "HayStorage/" + editingRecord.id), updateData);

      await fetchAllData();

      toast({ title: "Success", description: "Record updated successfully" });
      closeEditDialog();
    } catch (error) {
      console.error("Error updating record:", error);
      toast({ title: "Error", description: "Failed to update record", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // --- REALTIME DATABASE DELETE FUNCTION ---
  const handleDeleteSelected = async () => {
    if (selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);

      const deletePromises = selectedRecords.map(id => remove(ref(rtdb, "HayStorage/" + id)));
      await Promise.all(deletePromises);

      setAllHayStorage(prev => prev.filter(record => !selectedRecords.includes(record.id)));
      setSelectedRecords([]);
      toast({ title: "Records Deleted", description: `Successfully deleted ${selectedRecords.length} records` });
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting records:", error);
      toast({ title: "Delete Failed", description: "Failed to delete records", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  // Upload Functions
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (fileExtension && ['csv', 'json', 'xlsx', 'xls'].includes(fileExtension)) {
        setUploadFile(file);
      } else {
        toast({ title: "Invalid File Format", description: "Please select a CSV, JSON, or Excel file", variant: "destructive" });
      }
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    try {
      setUploadLoading(true);
      setUploadProgress(0);
      const progressInterval = setInterval(() => setUploadProgress(prev => prev >= 90 ? 90 : prev + 10), 200);

      const result: UploadResult = await uploadDataWithValidation(uploadFile, "hay_storage");

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (result.success) {
        toast({ title: "Upload Successful", description: result.message });
        await fetchAllData();
        setIsUploadDialogOpen(false);
        setUploadFile(null);
        setUploadProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        toast({ title: "Upload Failed", description: result.message + (result.validationErrors ? `\n\n${formatValidationErrors(result.validationErrors)}` : ""), variant: "destructive" });
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({ title: "Upload Failed", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setUploadLoading(false);
      setUploadProgress(0);
    }
  };

  // Export Function
  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredHayStorage.length === 0) {
        toast({ title: "No Data to Export", description: "There are no records", variant: "destructive" });
        return;
      }

      const csvData = filteredHayStorage.map(record => {
        const balance = (record.bales_harvested_stored || 0) - (record.bales_sold || 0);
        return [
          formatDate(record.date_planted),
          record.location || 'N/A',
          record.county || 'N/A',
          record.subcounty || 'N/A',
          record.land_ownership || 'N/A', // NEW COLUMN
          record.land_under_pasture || 0,
          record.pasture_stages.map(stage => `${stage.stage}: ${formatDate(stage.date)}`).join('; '),
          record.storage_facility || 'N/A',
          record.bales_harvested_stored || 0,
          record.bales_sold || 0,
          balance, // NEW COLUMN
          formatDate(record.date_sold),
          formatCurrency(record.revenue_generated || 0)
        ];
      });

      const headers = ['Date Planted', 'Location', 'County', 'Subcounty', 'Land Ownership', 'Land Under Pasture (acres)', 'Pasture Stages', 'Storage Facility', 'Bales Harvested & Stored', 'Bales Sold', 'Bales Balance', 'Date Sold', 'Revenue Generated'];
      const csvContent = [headers, ...csvData].map(row => row.map(field => `"${field}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hay-storage-data_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Successful", description: `Exported ${filteredHayStorage.length} records` });
    } catch (error) {
      console.error("Error exporting data:", error);
      toast({ title: "Export Failed", description: "Failed to export data", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const clearAllFilters = () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setFilters({ search: "", startDate: "", endDate: "", county: "all", subcounty: "all" });
  };

  const resetToCurrentMonth = () => setFilters(prev => ({ ...prev, ...currentMonth }));

  // Effects
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex md:flex-row flex-col justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Hay Storage Management</h2>
          <p className="text-sm text-gray-600">Manage pasture growth stages and hay storage data</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={clearAllFilters} className="text-xs border-gray-300 hover:bg-gray-50">Clear All Filters</Button>
          <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="text-xs border-gray-300 hover:bg-gray-50">This Month</Button>
          <Button onClick={() => setIsAddDialogOpen(true)} className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-md text-xs">
            <Plus className="h-4 w-4 mr-2" /> Add Record
          </Button>
          {userIsChiefAdmin && (
            <>
              <Button onClick={() => setIsUploadDialogOpen(true)} className="bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-600 border border-green-200 shadow-md text-xs">
                <Upload className="h-4 w-4 mr-2" /> Upload Data
              </Button>
              {selectedRecords.length > 0 && (
                <Button onClick={() => setIsDeleteDialogOpen(true)} disabled={deleteLoading} className="bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white shadow-md text-xs">
                  <Trash2 className="h-4 w-4 mr-2" /> {deleteLoading ? "Deleting..." : `Delete (${selectedRecords.length})`}
                </Button>
              )}
              <Button onClick={handleExport} disabled={exportLoading || filteredHayStorage.length === 0} className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white shadow-md text-xs">
                <Download className="h-4 w-4 mr-2" /> {exportLoading ? "Exporting..." : `Export (${filteredHayStorage.length})`}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Land Size" value={formatArea(stats.totalLandUnderPasture)} icon={LandPlot} description="Total land area under pasture cultivation" />
        <StatsCard title="Total Revenue" value={formatCurrency(stats.totalRevenue)} icon={DollarSign} description="Revenue from hay sales" />
        <StatsCard title="Bales Harvested" value={stats.totalBalesHarvested} icon={Package} description="Total bales harvested & stored" />
        <StatsCard title="Current Stock Balance" value={stats.totalBalesBalance} icon={Scale} description="Total bales in stock (Harvested - Sold)" />
      </div>

      {/* Filters Section */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          <FilterSection
            filters={filters}
            uniqueCounties={uniqueCounties}
            onSearch={handleSearch}
            onFilterChange={handleFilterChange}
          />
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading hay storage data...</p>
            </div>
          ) : getCurrentPageRecords().length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {allHayStorage.length === 0 ? "No hay storage data found in database" : "No records found matching your criteria"}
            </div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left">
                  <thead className="rounded">
                    <tr className="bg-blue-100">
                      <th className="py-3 px-4">
                        <Checkbox
                          checked={selectedRecords.length === getCurrentPageRecords().length && getCurrentPageRecords().length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-4 font-medium text-gray-600">Date Planted</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Location</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Land (acres)</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Ownership</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Pasture Stages</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Storage Facility</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Bales Harvested</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Bales Sold</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Balance</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Revenue</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getCurrentPageRecords().map((record) => (
                      <TableRow
                        key={record.id}
                        record={record}
                        isSelected={selectedRecords.includes(record.id)}
                        onSelectRecord={handleSelectRecord}
                        onView={openViewDialog}
                        onEdit={openEditDialog}
                        onDeleteSelect={(id) => { setSelectedRecords([id]); setIsDeleteDialogOpen(true); }}
                        userIsChiefAdmin={userIsChiefAdmin}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-sm text-muted-foreground">{filteredHayStorage.length} total records • {getCurrentPageRecords().length} on this page</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)} className="border-gray-300 hover:bg-gray-100">Previous</Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)} className="border-gray-300 hover:bg-gray-100">Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Record Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-3xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900"><Plus className="h-5 w-5 text-green-600" /> Add New Hay Storage Record</DialogTitle>
            <DialogDescription>Enter details for new hay storage record. Fields marked with * are required. If the Location already exists, the data will be added (topped up) to it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-slate-50 rounded-xl p-4">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Building className="h-4 w-4" /> Basic Information *</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label htmlFor="add-date-planted" className="text-sm font-medium text-slate-600">Date Planted *</Label><Input id="add-date-planted" type="date" value={addingRecord.date_planted as string} onChange={(e) => setAddingRecord(prev => ({ ...prev, date_planted: e.target.value }))} className="border-gray-300 focus:border-blue-500" required /></div>
                <div className="space-y-2"><Label htmlFor="add-location" className="text-sm font-medium text-slate-600">Location *</Label><Input id="add-location" value={addingRecord.location || ''} onChange={(e) => setAddingRecord(prev => ({ ...prev, location: e.target.value }))} className="border-gray-300 focus:border-blue-500" placeholder="Enter location" required /></div>
                <div className="space-y-2"><Label htmlFor="add-county" className="text-sm font-medium text-slate-600">County *</Label><Input id="add-county" value={addingRecord.county || ''} onChange={(e) => setAddingRecord(prev => ({ ...prev, county: e.target.value }))} className="border-gray-300 focus:border-blue-500" placeholder="Enter county" required /></div>
                <div className="space-y-2"><Label htmlFor="add-subcounty" className="text-sm font-medium text-slate-600">Subcounty *</Label><Input id="add-subcounty" value={addingRecord.subcounty || ''} onChange={(e) => setAddingRecord(prev => ({ ...prev, subcounty: e.target.value }))} className="border-gray-300 focus:border-blue-500" placeholder="Enter subcounty" required /></div>
                <div className="space-y-2 col-span-2"><Label htmlFor="add-land-pasture" className="text-sm font-medium text-slate-600">Land Under Pasture (acres) *</Label><Input id="add-land-pasture" type="number" step="0.1" min="0" value={addingRecord.land_under_pasture || 0} onChange={(e) => setAddingRecord(prev => ({ ...prev, land_under_pasture: parseFloat(e.target.value) || 0 }))} className="border-gray-300 focus:border-blue-500" placeholder="Enter land area in acres" required /></div>
                
                {/* NEW FIELD: Land Ownership */}
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="add-ownership" className="text-sm font-medium text-slate-600">Land Ownership *</Label>
                  <Select value={addingRecord.land_ownership} onValueChange={(value) => setAddingRecord(prev => ({ ...prev, land_ownership: value }))}>
                    <SelectTrigger className="border-gray-300 focus:border-blue-500">
                      <SelectValue placeholder="Select ownership type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Community Owned">Community Owned</SelectItem>
                      <SelectItem value="Leased">Leased</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Package className="h-4 w-4" /> Pasture Stages</h3>
                <Button type="button" variant="outline" size="sm" onClick={addPastureStage} className="text-xs"><Plus className="h-3 w-3 mr-1" /> Add Stage</Button>
              </div>
              {(addingRecord.pasture_stages || []).map((stage, index) => (
                <div key={index} className="grid grid-cols-2 gap-4 mb-3 p-3 bg-white rounded-lg border">
                  <div className="space-y-2">
                    <Label htmlFor={`stage-${index}`} className="text-sm font-medium text-slate-600">Stage</Label>
                    <Select value={stage.stage} onValueChange={(value) => updatePastureStage(index, 'stage', value)}>
                      <SelectTrigger className="border-gray-300 focus:border-blue-500"><SelectValue placeholder="Select stage" /></SelectTrigger>
                      <SelectContent>{PASTURE_STAGES.map(stageOption => <SelectItem key={stageOption} value={stageOption}>{stageOption.charAt(0).toUpperCase() + stageOption.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`stage-date-${index}`} className="text-sm font-medium text-slate-600">Date</Label>
                    <div className="flex gap-2">
                      <Input id={`stage-date-${index}`} type="date" value={stage.date} onChange={(e) => updatePastureStage(index, 'date', e.target.value)} className="border-gray-300 focus:border-blue-500" />
                      <Button type="button" variant="outline" size="sm" onClick={() => removePastureStage(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Optional Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label htmlFor="add-storage-facility" className="text-sm font-medium text-slate-600">Storage Facility</Label><Input id="add-storage-facility" value={addingRecord.storage_facility || ''} onChange={(e) => setAddingRecord(prev => ({ ...prev, storage_facility: e.target.value }))} className="border-gray-300 focus:border-blue-500" placeholder="Enter storage facility" /></div>
                <div className="space-y-2"><Label htmlFor="add-bales-harvested" className="text-sm font-medium text-slate-600">Bales Harvested & Stored</Label><Input id="add-bales-harvested" type="number" value={addingRecord.bales_harvested_stored || 0} onChange={(e) => setAddingRecord(prev => ({ ...prev, bales_harvested_stored: parseInt(e.target.value) || 0 }))} className="border-gray-300 focus:border-blue-500" /></div>
                <div className="space-y-2"><Label htmlFor="add-bales-sold" className="text-sm font-medium text-slate-600">Bales Sold</Label><Input id="add-bales-sold" type="number" value={addingRecord.bales_sold || 0} onChange={(e) => setAddingRecord(prev => ({ ...prev, bales_sold: parseInt(e.target.value) || 0 }))} className="border-gray-300 focus:border-blue-500" /></div>
                <div className="space-y-2"><Label htmlFor="add-date-sold" className="text-sm font-medium text-slate-600">Date Sold</Label><Input id="add-date-sold" type="date" value={addingRecord.date_sold as string} onChange={(e) => setAddingRecord(prev => ({ ...prev, date_sold: e.target.value }))} className="border-gray-300 focus:border-blue-500" /></div>
                <div className="space-y-2 col-span-2"><Label htmlFor="add-revenue" className="text-sm font-medium text-slate-600">Revenue Generated (KES)</Label><Input id="add-revenue" type="number" value={addingRecord.revenue_generated || 0} onChange={(e) => setAddingRecord(prev => ({ ...prev, revenue_generated: parseFloat(e.target.value) || 0 }))} className="border-gray-300 focus:border-blue-500" /></div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={closeAddDialog} disabled={adding} className="border-gray-300 hover:bg-gray-50"><X className="h-4 w-4 mr-2" /> Cancel</Button>
            <Button onClick={handleAddRecord} disabled={adding} className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"><Plus className="h-4 w-4 mr-2" /> {adding ? "Adding..." : "Add Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Record Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900"><Eye className="h-5 w-5 text-blue-600" /> Hay Storage Details</DialogTitle>
            <DialogDescription>Complete information for this hay storage record</DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Building className="h-4 w-4" /> Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-sm font-medium text-slate-600">Date Planted</Label><p className="text-slate-900 font-medium">{formatDate(viewingRecord.date_planted)}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Location</Label><p className="text-slate-900 font-medium">{viewingRecord.location || 'N/A'}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">County</Label><p className="text-slate-900 font-medium">{viewingRecord.county || 'N/A'}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Subcounty</Label><p className="text-slate-900 font-medium">{viewingRecord.subcounty || 'N/A'}</p></div>
                  <div className="col-span-2"><Label className="text-sm font-medium text-slate-600">Land Under Pasture</Label><p className="text-slate-900 font-medium text-lg">{formatArea(viewingRecord.land_under_pasture || 0)}</p></div>
                  <div className="col-span-2"><Label className="text-sm font-medium text-slate-600">Land Ownership</Label><p className="text-slate-900 font-medium capitalize">{viewingRecord.land_ownership || 'N/A'}</p></div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Package className="h-4 w-4" /> Pasture Stages ({viewingRecord.pasture_stages.length})</h3>
                <div className="space-y-2">
                  {viewingRecord.pasture_stages.map((stage, index) => (
                    <div key={index} className="flex items-center justify-between bg-white rounded-lg p-3 border">
                      <span className="font-medium text-slate-900 capitalize">{stage.stage}</span>
                      <Badge variant="outline" className="bg-blue-50 text-blue-700">{formatDate(stage.date)}</Badge>
                    </div>
                  ))}
                  {viewingRecord.pasture_stages.length === 0 && <p className="text-sm text-gray-500 text-center py-2">No pasture stages recorded</p>}
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Storage & Sales Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-sm font-medium text-slate-600">Storage Facility</Label><p className="text-slate-900 font-medium">{viewingRecord.storage_facility || 'N/A'}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Bales Harvested & Stored</Label><p className="text-slate-900 font-medium">{viewingRecord.bales_harvested_stored || 0}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Bales Sold</Label><p className="text-slate-900 font-medium">{viewingRecord.bales_sold || 0}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Current Balance</Label><p className="text-slate-900 font-bold">{(viewingRecord.bales_harvested_stored || 0) - (viewingRecord.bales_sold || 0)}</p></div>
                  <div><Label className="text-sm font-medium text-slate-600">Date Sold</Label><p className="text-slate-900 font-medium">{formatDate(viewingRecord.date_sold)}</p></div>
                  <div className="col-span-2"><Label className="text-sm font-medium text-slate-600">Revenue Generated</Label><p className="text-slate-900 font-medium text-lg">{formatCurrency(viewingRecord.revenue_generated || 0)}</p></div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsViewDialogOpen(false)} className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Record Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900"><Edit className="h-5 w-5 text-green-600" /> Edit Hay Storage Record</DialogTitle>
            <DialogDescription>Update information for this hay storage record.</DialogDescription>
          </DialogHeader>
          {editingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Building className="h-4 w-4" /> Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label htmlFor="edit-date-planted" className="text-sm font-medium text-slate-600">Date Planted</Label><Input id="edit-date-planted" type="date" value={formatDateForInput(editingRecord.date_planted)} onChange={(e) => handleEditChange('date_planted', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-location" className="text-sm font-medium text-slate-600">Location</Label><Input id="edit-location" value={editingRecord.location || ''} onChange={(e) => handleEditChange('location', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-county" className="text-sm font-medium text-slate-600">County</Label><Input id="edit-county" value={editingRecord.county || ''} onChange={(e) => handleEditChange('county', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-subcounty" className="text-sm font-medium text-slate-600">Subcounty</Label><Input id="edit-subcounty" value={editingRecord.subcounty || ''} onChange={(e) => handleEditChange('subcounty', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2 col-span-2"><Label htmlFor="edit-land-pasture" className="text-sm font-medium text-slate-600">Land Under Pasture (acres)</Label><Input id="edit-land-pasture" type="number" step="0.1" min="0" value={editingRecord.land_under_pasture || 0} onChange={(e) => handleEditChange('land_under_pasture', parseFloat(e.target.value) || 0)} className="border-gray-300 focus:border-blue-500" /></div>
                  
                  {/* NEW FIELD: Land Ownership */}
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="edit-ownership" className="text-sm font-medium text-slate-600">Land Ownership</Label>
                    <Select value={editingRecord.land_ownership} onValueChange={(value) => handleEditChange('land_ownership', value)}>
                      <SelectTrigger className="border-gray-300 focus:border-blue-500">
                        <SelectValue placeholder="Select ownership type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Community Owned">Community Owned</SelectItem>
                        <SelectItem value="Leased">Leased</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Package className="h-4 w-4" /> Pasture Stages ({editingRecord.pasture_stages.length})</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addEditPastureStage} className="text-xs"><Plus className="h-3 w-3 mr-1" /> Add New Stage</Button>
                </div>
                {editingRecord.pasture_stages.map((stage, index) => (
                  <div key={index} className="grid grid-cols-2 gap-4 mb-3 p-3 bg-white rounded-lg border">
                    <div className="space-y-2">
                      <Label htmlFor={`edit-stage-${index}`} className="text-sm font-medium text-slate-600">Stage</Label>
                      <Select value={stage.stage} onValueChange={(value) => updateEditPastureStage(index, 'stage', value)}>
                        <SelectTrigger className="border-gray-300 focus:border-blue-500"><SelectValue placeholder="Select stage" /></SelectTrigger>
                        <SelectContent>{PASTURE_STAGES.map(stageOption => <SelectItem key={stageOption} value={stageOption}>{stageOption.charAt(0).toUpperCase() + stageOption.slice(1)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`edit-stage-date-${index}`} className="text-sm font-medium text-slate-600">Date</Label>
                      <div className="flex gap-2">
                        <Input id={`edit-stage-date-${index}`} type="date" value={stage.date} onChange={(e) => updateEditPastureStage(index, 'date', e.target.value)} className="border-gray-300 focus:border-blue-500" />
                        <Button type="button" variant="outline" size="sm" onClick={() => removeEditPastureStage(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Storage & Sales Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label htmlFor="edit-storage-facility" className="text-sm font-medium text-slate-600">Storage Facility</Label><Input id="edit-storage-facility" value={editingRecord.storage_facility || ''} onChange={(e) => handleEditChange('storage_facility', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-bales-harvested" className="text-sm font-medium text-slate-600">Bales Harvested & Stored</Label><Input id="edit-bales-harvested" type="number" value={editingRecord.bales_harvested_stored || 0} onChange={(e) => handleEditChange('bales_harvested_stored', parseInt(e.target.value) || 0)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-bales-sold" className="text-sm font-medium text-slate-600">Bales Sold</Label><Input id="edit-bales-sold" type="number" value={editingRecord.bales_sold || 0} onChange={(e) => handleEditChange('bales_sold', parseInt(e.target.value) || 0)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2"><Label htmlFor="edit-date-sold" className="text-sm font-medium text-slate-600">Date Sold</Label><Input id="edit-date-sold" type="date" value={formatDateForInput(editingRecord.date_sold)} onChange={(e) => handleEditChange('date_sold', e.target.value)} className="border-gray-300 focus:border-blue-500" /></div>
                  <div className="space-y-2 col-span-2"><Label htmlFor="edit-revenue" className="text-sm font-medium text-slate-600">Revenue Generated (KES)</Label><Input id="edit-revenue" type="number" value={editingRecord.revenue_generated || 0} onChange={(e) => handleEditChange('revenue_generated', parseFloat(e.target.value) || 0)} className="border-gray-300 focus:border-blue-500" /></div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={closeEditDialog} disabled={saving} className="border-gray-300 hover:bg-gray-50"><X className="h-4 w-4 mr-2" /> Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"><Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="h-5 w-5" /> Delete Records</DialogTitle>
            <DialogDescription>Are you sure you want to delete {selectedRecords.length} selected record{selectedRecords.length > 1 ? 's' : ''}? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={deleteLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSelected} disabled={deleteLoading}>{deleteLoading ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Data Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600"><Upload className="h-5 w-5" /> Upload</DialogTitle>
            <DialogDescription>Upload CSV, JSON, or Excel files containing hay storage data.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".csv,.json,.xlsx,.xls" className="hidden" />
              {!uploadFile ? (
                <div className="cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-500 mt-1">CSV, JSON, Excel files only</p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Checkbox checked className="bg-green-500 border-green-500" />
                    <span className="text-sm font-medium text-green-600">{uploadFile.name}</span>
                  </div>
                  <p className="text-xs text-gray-500">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                </div>
              )}
            </div>
            {uploadProgress > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span>Uploading...</span><span>{uploadProgress}%</span></div>
                <div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-green-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div></div>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setIsUploadDialogOpen(false); setUploadFile(null); setUploadProgress(0); if (fileInputRef.current) fileInputRef.current.value = ''; }} disabled={uploadLoading}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploadLoading} className="bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white">{uploadLoading ? "Uploading..." : "Upload Data"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HayStoragePage;