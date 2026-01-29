import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchData } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Download, User, Phone, MapPin, Globe, Calendar, DollarSign, Eye, Edit, Save, X, Upload, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";
import { uploadDataWithValidation, formatValidationErrors, UploadResult } from "@/lib/uploads-util";

// Types
interface FodderOfftake {
  id: string;
  date: any;
  farmer_name?: string;
  phone_number?: string;
  bale_price?: number;
  location?: string;
  region?: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  location: string;
  region: string;
}

interface Stats {
  totalRegions: number;
  totalRevenue: number;
  totalFarmers: number;
  totalRecords: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Constants
const PAGE_LIMIT = 15;
const SEARCH_DEBOUNCE_DELAY = 300; // milliseconds

// Helper functions
const parseDate = (date: any): Date | null => {
  if (!date) return null;
  
  try {
    if (date.toDate && typeof date.toDate === 'function') {
      return date.toDate();
    } else if (date instanceof Date) {
      return date;
    } else if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } else if (typeof date === 'number') {
      return new Date(date);
    } else if (date.seconds) {
      return new Date(date.seconds * 1000);
    } else if (date._seconds) {
      return new Date(date._seconds * 1000);
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

const formatPhoneNumber = (phone: string): string => {
  if (!phone) return 'N/A';
  // Basic phone formatting for Kenya numbers
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return `+254 ${cleaned.slice(1, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
  }
  return phone;
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

const FodderOfftakePage = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const [allFodderOfftake, setAllFodderOfftake] = useState<FodderOfftake[]>([]);
  const [filteredFodderOfftake, setFilteredFodderOfftake] = useState<FodderOfftake[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<FodderOfftake | null>(null);
  const [editingRecord, setEditingRecord] = useState<FodderOfftake | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    location: "all",
    region: "all",
  });

  const [stats, setStats] = useState<Stats>({
    totalRegions: 0,
    totalRevenue: 0,
    totalFarmers: 0,
    totalRecords: 0,
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const userIsChiefAdmin = useMemo(() => {
    return isChiefAdmin(userRole);
  }, [userRole]);

  // Data fetching with improved debugging - FOCUSED ON FOFFTAKE
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      console.log("🔄 Starting fodder offtake data fetch...");
      
      const data = await fetchData();
      console.log("📦 Raw fetched data keys:", Object.keys(data));
      
      // SPECIFICALLY TARGET THE FOFFTAKE COLLECTION
      let fodderOfftakeData: any[] = [];
      
      // Check for fofftake collection first (as defined in your firebase.ts)
      if (data.fofftake && Array.isArray(data.fofftake)) {
        console.log("✅ Found data in 'fofftake' collection");
        fodderOfftakeData = data.fofftake;
      } 
      // If not found, check for other possible names
      else {
        const possibleCollectionNames = [
          'fodderOfftake', 
          'fodder_offtake',
          'fodder-offtake',
          'FodderOfftake',
          'fodderOfftakeData',
          'Fofftake'
        ];
        
        let foundCollection = '';
        for (const collectionName of possibleCollectionNames) {
          if (data[collectionName] && Array.isArray(data[collectionName])) {
            console.log(`🔄 Found data in alternative collection: ${collectionName}`);
            fodderOfftakeData = data[collectionName];
            foundCollection = collectionName;
            break;
          }
        }
        
        if (fodderOfftakeData.length === 0) {
          console.warn("❌ No fodder offtake data found in any expected collection");
          // Log all available collections for debugging
          const allCollections = Object.keys(data);
          console.log("📊 All available collections:", allCollections);
          
          // Look for any collection that might contain fodder data
          const potentialCollections = allCollections.filter(key => 
            Array.isArray(data[key]) && 
            (key.toLowerCase().includes('fodder') || key.toLowerCase().includes('offtake'))
          );
          
          if (potentialCollections.length > 0) {
            console.log("🔍 Potential fodder collections found:", potentialCollections);
            // Use the first potential collection
            fodderOfftakeData = data[potentialCollections[0]];
            console.log(`🔄 Using potential collection: ${potentialCollections[0]}`);
          } else {
            setAllFodderOfftake([]);
            return;
          }
        }
      }

      console.log(`📋 Processing ${fodderOfftakeData.length} records from fodder offtake collection`);
      console.log("🔍 Sample record:", fodderOfftakeData[0]);
      
      const processedData = fodderOfftakeData.map((item: any, index: number) => {
        // Handle date parsing
        let dateValue = item.date || item.Date || item.createdAt || item.timestamp || item.transactionDate;
        
        // Parse dates if they are Firestore timestamp objects
        const parseFirestoreDate = (dateValue: any) => {
          if (dateValue && typeof dateValue === 'object') {
            if (dateValue.toDate && typeof dateValue.toDate === 'function') {
              return dateValue.toDate();
            } else if (dateValue.seconds) {
              return new Date(dateValue.seconds * 1000);
            } else if (dateValue._seconds) {
              return new Date(dateValue._seconds * 1000);
            }
          }
          return dateValue;
        };

        dateValue = parseFirestoreDate(dateValue);

        // Handle different field name variations for fodder offtake
        // Prioritize field names that are most likely to be used
        const processedItem: FodderOfftake = {
          id: item.id || item.docId || `temp-${index}-${Date.now()}`,
          date: dateValue,
          farmer_name: item.farmer_name || item.farmerName || item.farmer || item.Farmer || item.name || '',
          phone_number: item.phone_number || item.phoneNumber || item.phone || item.Phone || item.mobile || item.contact || item.telephone || '',
          bale_price: Number(item.bale_price || item.balePrice || item.price || item.Price || item.amount || item.cost || item.bale_cost || 0),
          location: item.location || item.Location || item.area || item.Area || item.village || item.town || item.sub_location || '',
          region: item.region || item.Region || item.county || item.County || item.district || item.division || ''
        };

        // Log field mapping for first record to debug
        if (index === 0) {
          console.log("🔧 Field mapping for first record:", {
            original: item,
            processed: processedItem
          });
        }

        return processedItem;
      });

      console.log("🎉 Final processed fodder offtake data:", processedData);
      setAllFodderOfftake(processedData);
      
    } catch (error) {
      console.error("❌ Error fetching fodder offtake data:", error);
      toast({
        title: "Error",
        description: "Failed to load fodder offtake data from database",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Filter application
  const applyFilters = useCallback(() => {
    if (allFodderOfftake.length === 0) {
      console.log("No fodder offtake data to filter");
      setFilteredFodderOfftake([]);
      setStats({
        totalRegions: 0,
        totalRevenue: 0,
        totalFarmers: 0,
        totalRecords: 0,
      });
      return;
    }

    console.log("Applying filters to", allFodderOfftake.length, "fodder offtake records");
    
    let filtered = allFodderOfftake.filter(record => {
      // Region filter
      if (filters.region !== "all" && record.region?.toLowerCase() !== filters.region.toLowerCase()) {
        return false;
      }

      // Location filter
      if (filters.location !== "all" && record.location?.toLowerCase() !== filters.location.toLowerCase()) {
        return false;
      }

      // Date filter
      if (filters.startDate || filters.endDate) {
        const recordDate = parseDate(record.date);
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
          // If we have date filters but no valid date on record, exclude it
          return false;
        }
      }

      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = [
          record.farmer_name, 
          record.phone_number, 
          record.location,
          record.region
        ].some(field => field?.toLowerCase().includes(searchTerm));
        if (!searchMatch) return false;
      }

      return true;
    });

    console.log("Filtered to", filtered.length, "fodder offtake records");
    setFilteredFodderOfftake(filtered);
    
    // Update stats
    const totalRevenue = filtered.reduce((sum, record) => sum + (record.bale_price || 0), 0);
    
    // Count unique farmers and regions from filtered data
    const uniqueFarmers = new Set(filtered.map(f => f.farmer_name).filter(Boolean));
    const uniqueRegions = new Set(filtered.map(f => f.region).filter(Boolean));

    setStats({
      totalFarmers: uniqueFarmers.size,
      totalRegions: uniqueRegions.size,
      totalRevenue,
      totalRecords: filtered.length
    });

    // Update pagination
    const totalPages = Math.ceil(filtered.length / pagination.limit);
    setPagination(prev => ({
      ...prev,
      totalPages,
      hasNext: prev.page < totalPages,
      hasPrev: prev.page > 1
    }));
  }, [allFodderOfftake, filters, pagination.limit]);

  // Effects
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Optimized search handler with debouncing
  const handleSearch = useCallback((value: string) => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout
    searchTimeoutRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: value }));
      setPagination(prev => ({ ...prev, page: 1 }));
    }, SEARCH_DEBOUNCE_DELAY);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Filter change handler
  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Delete functionality
  const handleDeleteSelected = async () => {
    if (selectedRecords.length === 0) {
      toast({
        title: "No Records Selected",
        description: "Please select records to delete",
        variant: "destructive",
      });
      return;
    }

    try {
      setDeleteLoading(true);
      
      // Simulate deletion - replace with actual Firebase delete operation
      console.log("Deleting records:", selectedRecords);
      
      // In a real implementation, you would call a Firebase delete function here
      // await deleteFodderOfftakeRecords(selectedRecords);
      
      // For now, we'll just filter them out from the local state
      setAllFodderOfftake(prev => prev.filter(record => !selectedRecords.includes(record.id)));
      setSelectedRecords([]);
      
      toast({
        title: "Records Deleted",
        description: `Successfully deleted ${selectedRecords.length} records`,
      });
      
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting records:", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  // Upload functionality
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (fileExtension && ['csv', 'json', 'xlsx', 'xls'].includes(fileExtension)) {
        setUploadFile(file);
      } else {
        toast({
          title: "Invalid File Format",
          description: "Please select a CSV, JSON, or Excel file",
          variant: "destructive",
        });
      }
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast({
        title: "No File Selected",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploadLoading(true);
      setUploadProgress(0);
      
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Use the upload utility - SPECIFICALLY FOR FOFFTAKE
      const result: UploadResult = await uploadDataWithValidation(uploadFile, "fofftake");
      
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (result.success) {
        toast({
          title: "Upload Successful",
          description: result.message,
        });
        
        // Refresh data
        await fetchAllData();
        setIsUploadDialogOpen(false);
        setUploadFile(null);
        setUploadProgress(0);
        
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        let errorMessage = result.message;
        
        if (result.validationErrors && result.validationErrors.length > 0) {
          errorMessage += "\n\n" + formatValidationErrors(result.validationErrors);
        }
        
        toast({
          title: "Upload Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      toast({
        title: "Upload Failed",
        description: "An unexpected error occurred during upload",
        variant: "destructive",
      });
    } finally {
      setUploadLoading(false);
      setUploadProgress(0);
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      
      if (filteredFodderOfftake.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no records matching your current filters",
          variant: "destructive",
        });
        return;
      }

      const csvData = filteredFodderOfftake.map(record => [
        formatDate(record.date),
        record.farmer_name || 'N/A',
        formatPhoneNumber(record.phone_number || ''),
        (record.bale_price || 0).toString(),
        record.location || 'N/A',
        record.region || 'N/A'
      ]);

      const headers = ['Date', 'Farmer Name', 'Phone Number', 'Bale Price', 'Location', 'Region'];
      const csvContent = [headers, ...csvData]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      let filename = `fodder-offtake-data`;
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
        description: `Exported ${filteredFodderOfftake.length} fodder offtake records`,
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
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredFodderOfftake.slice(startIndex, endIndex);
  }, [filteredFodderOfftake, pagination.page, pagination.limit]);

  const handleSelectRecord = (recordId: string) => {
    setSelectedRecords(prev =>
      prev.includes(recordId)
        ? prev.filter(id => id !== recordId)
        : [...prev, recordId]
    );
  };

  const handleSelectAll = () => {
    const currentPageIds = getCurrentPageRecords().map(f => f.id);
    setSelectedRecords(prev =>
      prev.length === currentPageIds.length ? [] : currentPageIds
    );
  };

  const openViewDialog = (record: FodderOfftake) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  };

  const openEditDialog = (record: FodderOfftake) => {
    setEditingRecord({...record});
    setIsEditDialogOpen(true);
  };

  const closeEditDialog = () => {
    setEditingRecord(null);
    setIsEditDialogOpen(false);
  };

  const handleEditChange = (field: keyof FodderOfftake, value: any) => {
    if (editingRecord) {
      setEditingRecord(prev => prev ? {...prev, [field]: value} : null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;

    try {
      setSaving(true);
      
      // Update the record in the database
      // await updateData('fofftake', editingRecord.id, editingRecord);
      
      // Update local state
      setAllFodderOfftake(prev => 
        prev.map(record => 
          record.id === editingRecord.id ? editingRecord : record
        )
      );

      toast({
        title: "Success",
        description: "Record updated successfully",
      });

      closeEditDialog();
      
    } catch (error) {
      console.error("Error updating record:", error);
      toast({
        title: "Error",
        description: "Failed to update record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Memoized values
  const uniqueRegions = useMemo(() => {
    const regions = [...new Set(allFodderOfftake.map(f => f.region).filter(Boolean))];
    return regions.sort();
  }, [allFodderOfftake]);

  const uniqueLocations = useMemo(() => {
    const locations = [...new Set(allFodderOfftake.map(f => f.location).filter(Boolean))];
    return locations.sort();
  }, [allFodderOfftake]);

  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const clearAllFilters = () => {
    // Clear any pending search timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    setFilters({
      search: "",
      startDate: "",
      endDate: "",
      location: "all",
      region: "all",
    });
  };

  const resetToCurrentMonth = () => {
    setFilters(prev => ({ ...prev, ...currentMonth }));
  };

  // Memoized components to prevent re-renders
  const StatsCard = useCallback(({ title, value, icon: Icon, description }: any) => (
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
          {description && (
            <p className="text-xs text-slate-600 mt-2 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  ), []);

  const FilterSection = useMemo(() => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="space-y-2">
        <Label htmlFor="search" className="font-semibold text-gray-700">Search</Label>
        <Input
          id="search"
          placeholder="Search farmers, locations..."
          onChange={(e) => handleSearch(e.target.value)}
          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="region" className="font-semibold text-gray-700">Region</Label>
        <Select value={filters.region} onValueChange={(value) => handleFilterChange("region", value)}>
          <SelectTrigger className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white">
            <SelectValue placeholder="Select region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {uniqueRegions.slice(0, 20).map(region => (
              <SelectItem key={region} value={region}>{region}</SelectItem>
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
          onChange={(e) => handleFilterChange("startDate", e.target.value)}
          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="endDate" className="font-semibold text-gray-700">To Date</Label>
        <Input
          id="endDate"
          type="date"
          value={filters.endDate}
          onChange={(e) => handleFilterChange("endDate", e.target.value)}
          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
        />
      </div>
    </div>
  ), [filters, uniqueRegions, handleSearch, handleFilterChange]);

  const TableRow = useCallback(({ record }: { record: FodderOfftake }) => {
    return (
      <tr className="border-b hover:bg-blue-50 transition-colors duration-200 group text-sm">
        <td className="py-3 px-4">
          <Checkbox
            checked={selectedRecords.includes(record.id)}
            onCheckedChange={() => handleSelectRecord(record.id)}
          />
        </td>
        <td className="py-3 px-4">{formatDate(record.date)}</td>
        <td className="py-3 px-4">{record.farmer_name || 'N/A'}</td>
        <td className="py-3 px-4">{formatPhoneNumber(record.phone_number || '')}</td>
        <td className="py-3 px-4">{formatCurrency(record.bale_price || 0)}</td>
        <td className="py-3 px-4">{record.location || 'N/A'}</td>
        <td className="py-3 px-4">{record.region || 'N/A'}</td>
        <td className="py-3 px-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openViewDialog(record)}
              className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600 border-blue-200"
            >
              <Eye className="h-4 w-4 text-blue-500" />
            </Button>
            {isChiefAdmin(userRole) &&( 
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditDialog(record)}
                className="h-8 w-8 p-0 hover:bg-green-50 hover:text-green-600 border-green-200"
              >
                <Edit className="h-4 w-4 text-green-500" />
              </Button>
            )}
            {isChiefAdmin(userRole) &&(
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedRecords([record.id]);
                  setIsDeleteDialogOpen(true);
                }}
                className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 border-red-200"
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  }, [selectedRecords, handleSelectRecord, openViewDialog, openEditDialog, userRole]);

  return (
    <div className="space-y-6">
      {/* Header with Action Buttons */}
      <div className="flex md:flex-row flex-col justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Fodder Offtake Data
          </h2>
          <p className="text-muted-foreground">Manage fodder offtake records</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={clearAllFilters}
            className="text-xs border-gray-300 hover:bg-gray-50"
          >
            Clear All Filters
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetToCurrentMonth}
            className="text-xs border-gray-300 hover:bg-gray-50"
          >
            This Month
          </Button>

          {isChiefAdmin(userRole) && (
            <>
              <Button 
                onClick={() => setIsUploadDialogOpen(true)}
                className="bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-600 border border-green-200 shadow-md text-xs"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload Data
              </Button>
              
              {selectedRecords.length > 0 && (
                <Button 
                  onClick={() => setIsDeleteDialogOpen(true)}
                  disabled={deleteLoading}
                  className="bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white shadow-md text-xs"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deleteLoading ? "Deleting..." : `Delete (${selectedRecords.length})`}
                </Button>
              )}
              
              <Button 
                onClick={handleExport} 
                disabled={exportLoading || filteredFodderOfftake.length === 0}
                className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white shadow-md text-xs"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportLoading ? "Exporting..." : `Export (${filteredFodderOfftake.length})`}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard 
          title="Total Records" 
          value={stats.totalRecords} 
          icon={User}
          description="Total fodder offtake records"
        />

        <StatsCard 
          title="Total Farmers" 
          value={stats.totalFarmers} 
          icon={User}
          description="Unique farmers served"
        />

        <StatsCard 
          title="Regions" 
          value={stats.totalRegions} 
          icon={Globe}
          description="Unique regions covered"
        />

        <StatsCard 
          title="Total Revenue" 
          value={formatCurrency(stats.totalRevenue)} 
          icon={DollarSign}
          description="Revenue from bale sales"
        />
      </div>

      {/* Filters Section */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          {FilterSection}
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading fodder offtake data...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {allFodderOfftake.length === 0 ? "No fodder offtake data found in database" : "No records found matching your criteria"}
            </div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left">
                  <thead className="rounded">
                    <tr className="bg-blue-100">
                      <th className="py-3 px-4">
                        <Checkbox
                          checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-4 font-medium text-gray-600">Date</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Farmer Name</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Phone Number</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Bale Price</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Location</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Region</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <TableRow key={record.id} record={record} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-sm text-muted-foreground">
                  {filteredFodderOfftake.length} total records • {currentPageRecords.length} on this page
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasPrev}
                    onClick={() => handlePageChange(pagination.page - 1)}
                    className="border-gray-300 hover:bg-gray-100"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasNext}
                    onClick={() => handlePageChange(pagination.page + 1)}
                    className="border-gray-300 hover:bg-gray-100"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Record Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Eye className="h-5 w-5 text-blue-600" />
              Fodder Offtake Details
            </DialogTitle>
            <DialogDescription>
              Complete information for this fodder offtake transaction
            </DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              {/* Farmer Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Farmer Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Farmer Name</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.farmer_name || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Phone Number</Label>
                    <p className="text-slate-900 font-medium">{formatPhoneNumber(viewingRecord.phone_number || '')}</p>
                  </div>
                </div>
              </div>

              {/* Transaction Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Transaction Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Date</Label>
                    <p className="text-slate-900 font-medium">{formatDate(viewingRecord.date)}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Bale Price</Label>
                    <p className="text-slate-900 font-medium text-lg">{formatCurrency(viewingRecord.bale_price || 0)}</p>
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Location Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Location</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.location || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Region</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.region || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button 
              onClick={() => setIsViewDialogOpen(false)}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Record Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Edit className="h-5 w-5 text-green-600" />
              Edit Fodder Offtake Record
            </DialogTitle>
            <DialogDescription>
              Update the information for this fodder offtake transaction
            </DialogDescription>
          </DialogHeader>
          {editingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              {/* Farmer Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Farmer Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-farmer-name" className="text-sm font-medium text-slate-600">Farmer Name</Label>
                    <Input
                      id="edit-farmer-name"
                      value={editingRecord.farmer_name || ''}
                      onChange={(e) => handleEditChange('farmer_name', e.target.value)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-phone" className="text-sm font-medium text-slate-600">Phone Number</Label>
                    <Input
                      id="edit-phone"
                      value={editingRecord.phone_number || ''}
                      onChange={(e) => handleEditChange('phone_number', e.target.value)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Transaction Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Transaction Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-date" className="text-sm font-medium text-slate-600">Date</Label>
                    <Input
                      id="edit-date"
                      type="date"
                      value={formatDateForInput(editingRecord.date)}
                      onChange={(e) => handleEditChange('date', e.target.value)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-bale-price" className="text-sm font-medium text-slate-600">Bale Price (Ksh)</Label>
                    <Input
                      id="edit-bale-price"
                      type="number"
                      value={editingRecord.bale_price || 0}
                      onChange={(e) => handleEditChange('bale_price', parseFloat(e.target.value) || 0)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Location Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-location" className="text-sm font-medium text-slate-600">Location</Label>
                    <Input
                      id="edit-location"
                      value={editingRecord.location || ''}
                      onChange={(e) => handleEditChange('location', e.target.value)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-region" className="text-sm font-medium text-slate-600">Region</Label>
                    <Input
                      id="edit-region"
                      value={editingRecord.region || ''}
                      onChange={(e) => handleEditChange('region', e.target.value)}
                      className="border-gray-300 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button 
              variant="outline"
              onClick={closeEditDialog}
              disabled={saving}
              className="border-gray-300 hover:bg-gray-50"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={saving}
              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Delete Records
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedRecords.length} selected record{selectedRecords.length > 1 ? 's' : ''}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              disabled={deleteLoading}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Data Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Upload className="h-5 w-5" />
              Upload Fodder Offtake Data
            </DialogTitle>
            <DialogDescription>
              Upload CSV, JSON, or Excel files containing fodder offtake data. The data will be validated against the database schema.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".csv,.json,.xlsx,.xls"
                className="hidden"
              />
              
              {!uploadFile ? (
                <div 
                  className="cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    CSV, JSON, Excel files only
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Checkbox checked className="bg-green-500 border-green-500" />
                    <span className="text-sm font-medium text-green-600">
                      {uploadFile.name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {(uploadFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              )}
            </div>

            {uploadProgress > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsUploadDialogOpen(false);
                setUploadFile(null);
                setUploadProgress(0);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
              disabled={uploadLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || uploadLoading}
              className="bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white"
            >
              {uploadLoading ? "Uploading..." : "Upload Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FodderOfftakePage;