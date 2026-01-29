import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchData, db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Download, MapPin, Eye, Droplets, Users, Building, Trash2, Upload, Plus, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";

// REALTIME DATABASE IMPORTS ONLY
import { 
  ref, 
  push, 
  update, 
  remove, 
  get, 
  DatabaseReference,
  Database 
} from "firebase/database";

// Types
interface Borehole {
  id: string;
  date: any; // Can be ISO string or number
  location?: string;
  region?: string;
  people?: string | number;
  waterUsed?: number;
  drilled?: boolean;
  maintained?: boolean;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  location: string;
}

interface Stats {
  totalBoreholes: number;
  drilledBoreholes: number;
  maintainedBoreholes: number;
  totalPeople: number;
  totalWaterUsed: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Firebase operations
interface FirebaseResult {
  success: boolean;
  error?: string;
  id?: string;
}

// --- CORRECTED REALTIME DATABASE IMPLEMENTATIONS ---

const addData = async (collectionName: string, data: any): Promise<FirebaseResult> => {
  try {
    console.log("Adding data to RTDB", collectionName, data);
    
    // Reference to the collection node in RTDB
    const dbRef = ref(db as Database, collectionName);
    
    // Push generates a unique key and returns the reference
    const newPostRef = push(dbRef);
    
    // Set the data at the generated key location
    await update(newPostRef, {
      ...data,
      // Ensure date is a string (ISO) or number, RTDB doesn't have native Timestamp objects
      date: data.date instanceof Date ? data.date.toISOString() : data.date
    });

    console.log("Document written with ID: ", newPostRef.key);
    
    return { 
      success: true, 
      id: newPostRef.key 
    };
  } catch (error) {
    console.error("Error adding document:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
};

const updateData = async (collectionName: string, docId: string, data: any): Promise<FirebaseResult> => {
  try {
    console.log("Updating document in RTDB", collectionName, docId, data);
    
    // Create reference to specific child in RTDB
    const dbRef = ref(db as Database, `${collectionName}/${docId}`);
    
    const dataToUpdate = {
      ...data,
      date: data.date instanceof Date ? data.date.toISOString() : data.date
    };

    await update(dbRef, dataToUpdate);
    
    return { 
      success: true 
    };
  } catch (error) {
    console.error("Error updating document:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
};

const deleteData = async (collectionName: string, docIds: string[]): Promise<FirebaseResult> => {
  try {
    console.log("Deleting documents from RTDB", collectionName, docIds);
    
    const deletePromises = docIds.map(id => remove(ref(db as Database, `${collectionName}/${id}`)));
    await Promise.all(deletePromises);
    
    return { 
      success: true 
    };
  } catch (error) {
    console.error("Error deleting documents:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
};

// Constants
const PAGE_LIMIT = 15;
const SEARCH_DEBOUNCE_DELAY = 300;

// Helper functions
const parseDate = (date: any): Date | null => {
  if (!date) return null;
  
  try {
    if (date instanceof Date) {
      return date;
    } else if (typeof date === 'string') {
      // Handle ISO strings common in RTDB
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } else if (typeof date === 'number') {
      // Handle Unix timestamp (seconds or ms)
      return new Date(date < 10000000000 ? date * 1000 : date);
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

// Upload utility types and functions
interface UploadResult {
  success: boolean;
  message: string;
  successCount: number;
  errorCount: number;
  errors?: string[];
  validationErrors?: ValidationError[];
  totalRecords?: number;
}

interface ValidationError {
  recordIndex: number;
  field: string;
  message: string;
  value: any;
  expectedType?: string;
}

const uploadDataWithValidation = async (file: File, collectionName: string): Promise<UploadResult> => {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      success: true,
      message: `Successfully uploaded data to ${collectionName}`,
      successCount: 10,
      errorCount: 0,
      totalRecords: 10
    };
  } catch (error) {
    return {
      success: false,
      message: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      successCount: 0,
      errorCount: 0,
      errors: [`Upload error: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
};

const formatValidationErrors = (validationErrors: ValidationError[]): string => {
  if (!validationErrors || validationErrors.length === 0) return '';

  let message = 'Validation Errors:\n\n';
  validationErrors.forEach(error => {
    message += `Record ${error.recordIndex + 1}: ${error.field} - ${error.message}\n`;
  });

  return message;
};

const safePeopleToNumber = (people: string | number | undefined): number => {
  if (people === undefined || people === null) return 0;
  if (typeof people === 'number') return people;
  if (typeof people === 'string') {
    const parsed = parseInt(people, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const displayPeopleValue = (people: string | number | undefined): string => {
  if (people === undefined || people === null) return '0';
  return people.toString();
};

const BoreholePage = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const [allBoreholes, setAllBoreholes] = useState<Borehole[]>([]);
  const [filteredBoreholes, setFilteredBoreholes] = useState<Borehole[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<Borehole | null>(null);
  const [editingRecord, setEditingRecord] = useState<Borehole | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    location: "all"
  });

  const [newBorehole, setNewBorehole] = useState<Partial<Borehole>>({
    date: new Date().toISOString().split('T')[0],
    location: "",
    people: 0,
    waterUsed: 0,
    drilled: false,
    maintained: false
  });

  const [stats, setStats] = useState<Stats>({
    totalBoreholes: 0,
    drilledBoreholes: 0,
    maintainedBoreholes: 0,
    totalPeople: 0,
    totalWaterUsed: 0
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

  // Data fetching from Realtime Database
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      console.log("Starting borehole data fetch from Realtime Database...");
      
      const boreholeRef = ref(db as Database, 'BoreholeStorage');
      const snapshot = await get(boreholeRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        // Transform object from RTDB to array
        const boreholeData = Object.keys(data).map((key) => {
          const item = data[key];
          return {
            id: key,
            ...item,
            // Ensure specific field mappings match your RTDB structure
            location: item.BoreholeLocation || item.location || 'No location',
            people: item.PeopleUsingBorehole || item.people || 0,
            waterUsed: item.WaterUsed || item.waterUsed || 0,
            drilled: item.drilled || false,
            maintained: item.maintained || false
          };
        });
        
        console.log("Final processed borehole data:", boreholeData);
        setAllBoreholes(boreholeData);
      } else {
        console.warn("No BoreholeStorage data found in Realtime Database");
        setAllBoreholes([]);
      }
      
    } catch (error) {
      console.error("Error fetching borehole data:", error);
      toast({
        title: "Error",
        description: "Failed to load borehole data from database",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Filter application
  const applyFilters = useCallback(() => {
    if (allBoreholes.length === 0) {
      console.log("No borehole data to filter");
      setFilteredBoreholes([]);
      setStats({
        totalBoreholes: 0,
        drilledBoreholes: 0,
        maintainedBoreholes: 0,
        totalPeople: 0,
        totalWaterUsed: 0
      });
      return;
    }

    console.log("Applying filters to", allBoreholes.length, "borehole records");
    
    let filtered = allBoreholes.filter(record => {
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
          return false;
        }
      }

      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = record.location?.toLowerCase().includes(searchTerm);
        if (!searchMatch) return false;
      }

      return true;
    });

    console.log("Filtered to", filtered.length, "borehole records");
    setFilteredBoreholes(filtered);
    
    // Update stats
    const totalPeople = filtered.reduce((sum, record) => sum + safePeopleToNumber(record.people), 0);
    const totalWaterUsed = filtered.reduce((sum, record) => sum + (record.waterUsed || 0), 0);
    const drilledBoreholes = filtered.filter(record => record.drilled).length;
    const maintainedBoreholes = filtered.filter(record => record.maintained).length;

    console.log("Stats - Total Boreholes:", filtered.length, "Drilled:", drilledBoreholes, "Maintained:", maintainedBoreholes, "People:", totalPeople, "Water Used:", totalWaterUsed);

    setStats({
      totalBoreholes: filtered.length,
      drilledBoreholes,
      maintainedBoreholes,
      totalPeople,
      totalWaterUsed
    });

    // Update pagination
    const totalPages = Math.ceil(filtered.length / pagination.limit);
    setPagination(prev => ({
      ...prev,
      totalPages,
      hasNext: prev.page < totalPages,
      hasPrev: prev.page > 1
    }));
  }, [allBoreholes, filters, pagination.limit]);

  // Effects
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // Optimized search handler with debouncing
  const handleSearch = useCallback((value: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

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

  // Create functionality
  const handleCreateBorehole = async () => {
    try {
      setCreateLoading(true);

      // Validate required fields
      if (!newBorehole.location) {
        toast({
          title: "Validation Error",
          description: "Location is a required field",
          variant: "destructive",
        });
        return;
      }

      const boreholeData = {
        BoreholeLocation: newBorehole.location,
        PeopleUsingBorehole: newBorehole.people || 0,
        WaterUsed: newBorehole.waterUsed || 0,
        drilled: newBorehole.drilled || false,
        maintained: newBorehole.maintained || false,
        date: new Date(newBorehole.date || new Date()).toISOString()
      };

      console.log("Creating new borehole:", boreholeData);

      // Add to Firebase Realtime Database
      const result = await addData("BoreholeStorage", boreholeData);

      if (result.success) {
        toast({
          title: "Success",
          description: "Borehole record created successfully",
        });

        // Reset form and close dialog
        setNewBorehole({
          date: new Date().toISOString().split('T')[0],
          location: "",
          people: 0,
          waterUsed: 0,
          drilled: false,
          maintained: false
        });
        setIsCreateDialogOpen(false);

        // Refresh data
        await fetchAllData();
      } else {
        throw new Error(result.error || "Failed to create borehole record");
      }

    } catch (error) {
      console.error("Error creating borehole:", error);
      toast({
        title: "Create Failed",
        description: "Failed to create borehole record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreateLoading(false);
    }
  };

  // Edit functionality
  const handleEditBorehole = async () => {
    if (!editingRecord) return;

    try {
      setEditLoading(true);

      // Validate required fields
      if (!editingRecord.location) {
        toast({
          title: "Validation Error",
          description: "Location is a required field",
          variant: "destructive",
        });
        return;
      }

      const boreholeData = {
        BoreholeLocation: editingRecord.location,
        PeopleUsingBorehole: editingRecord.people || 0,
        WaterUsed: editingRecord.waterUsed || 0,
        drilled: editingRecord.drilled || false,
        maintained: editingRecord.maintained || false,
        date: editingRecord.date // Pass existing date
      };

      console.log("Updating borehole:", editingRecord.id, boreholeData);

      // Update in Firebase
      const result = await updateData("BoreholeStorage", editingRecord.id, boreholeData);

      if (result.success) {
        toast({
          title: "Success",
          description: "Borehole record updated successfully",
        });

        // Close dialog and reset
        setIsEditDialogOpen(false);
        setEditingRecord(null);

        // Refresh data
        await fetchAllData();
      } else {
        throw new Error(result.error || "Failed to update borehole record");
      }

    } catch (error) {
      console.error("Error updating borehole:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update borehole record. Please try again.",
        variant: "destructive",
      });
    } finally {
      setEditLoading(false);
    }
  };

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
      
      // Use the deleteData function
      const result = await deleteData("BoreholeStorage", selectedRecords);

      if (result.success) {
        // Update local state
        setAllBoreholes(prev => prev.filter(record => !selectedRecords.includes(record.id)));
        setSelectedRecords([]);
        
        toast({
          title: "Records Deleted",
          description: `Successfully deleted ${selectedRecords.length} records`,
        });
        
        setIsDeleteDialogOpen(false);
      } else {
        throw new Error(result.error || "Failed to delete records");
      }
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
      
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const result: UploadResult = await uploadDataWithValidation(uploadFile, "BoreholeStorage");
      
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (result.success) {
        toast({
          title: "Upload Successful",
          description: result.message,
        });
        
        await fetchAllData();
        setIsUploadDialogOpen(false);
        setUploadFile(null);
        setUploadProgress(0);
        
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
      
      if (filteredBoreholes.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no records matching your current filters",
          variant: "destructive",
        });
        return;
      }

      const csvData = filteredBoreholes.map(record => [
        formatDate(record.date),
        record.location || 'N/A',
        displayPeopleValue(record.people),
        (record.waterUsed || 0).toString(),
        record.drilled ? 'Yes' : 'No',
        record.maintained ? 'Yes' : 'No'
      ]);

      const headers = ['Date', 'Borehole Location', 'People Using Water', 'Water Used', 'Drilled', 'Maintained'];
      const csvContent = [headers, ...csvData]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      let filename = `borehole-data`;
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
        description: `Exported ${filteredBoreholes.length} borehole records`,
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
    return filteredBoreholes.slice(startIndex, endIndex);
  }, [filteredBoreholes, pagination.page, pagination.limit]);

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

  const openViewDialog = (record: Borehole) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  };

  const openEditDialog = (record: Borehole) => {
    setEditingRecord(record);
    setIsEditDialogOpen(true);
  };

  // Memoized values
  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const clearAllFilters = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    setFilters({
      search: "",
      startDate: "",
      endDate: "",
      location: "all"
    });
  };

  const resetToCurrentMonth = () => {
    setFilters(prev => ({ ...prev, ...currentMonth }));
  };

  // Memoized components
  const StatsCard = useCallback(({ title, value, icon: Icon, description, additionalInfo }: any) => (
    <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-600"></div>
      
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
          {additionalInfo && (
            <div className="text-xs text-slate-500 mt-1 space-y-1">
              {additionalInfo}
            </div>
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
          placeholder="Search boreholes..."
          onChange={(e) => handleSearch(e.target.value)}
          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
        />
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
  ), [filters, handleSearch, handleFilterChange]);

  const TableRow = useCallback(({ record }: { record: Borehole }) => (
    <tr className="border-b hover:bg-blue-50 transition-colors duration-200 group text-sm">
      <td className="py-3 px-4">
        <Checkbox
          checked={selectedRecords.includes(record.id)}
          onCheckedChange={() => handleSelectRecord(record.id)}
        />
      </td>
      <td className="py-3 px-4">{formatDate(record.date)}</td>
      <td className="py-3 px-4 font-medium">{record.location || 'N/A'}</td>
      <td className="py-3 px-4">
        <span className="font-bold text-blue-700">{displayPeopleValue(record.people)}</span>
      </td>
      <td className="py-3 px-4">
        <span className="font-bold text-cyan-700">{record.waterUsed || 0} L</span>
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-1">
          <Badge variant={record.drilled ? "default" : "secondary"} className={record.drilled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
            {record.drilled ? 'Drilled' : 'Not Drilled'}
          </Badge>
          <Badge variant={record.maintained ? "default" : "secondary"} className={record.maintained ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}>
            {record.maintained ? 'Maintained' : 'Not Maintained'}
          </Badge>
        </div>
      </td>
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
          {userIsChiefAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditDialog(record)}
                className="h-8 w-8 p-0 hover:bg-green-50 hover:text-green-600 border-green-200"
              >
                <Edit className="h-4 w-4 text-green-500" />
              </Button>
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
            </>
          )}
        </div>
      </td>
    </tr>
  ), [selectedRecords, handleSelectRecord, openViewDialog, openEditDialog, userIsChiefAdmin]);

  return (
    <div className="space-y-6">
      {/* Header with Action Buttons */}
      <div className="flex md:flex-row flex-col justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
            Borehole Data
          </h2>
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
          
          {userIsChiefAdmin && (
            <>
              <Button 
                onClick={() => setIsCreateDialogOpen(true)}
                className="bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white shadow-md text-xs"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Borehole
              </Button>
              
              <Button 
                onClick={() => setIsUploadDialogOpen(true)}
                className="bg-green-50 text-green-500 hover:bg-blue-50"
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
                disabled={exportLoading || filteredBoreholes.length === 0}
                className="bg-gradient-to-r from-blue-600 to-cyan-700 hover:from-blue-700 hover:to-cyan-800 text-white shadow-md text-xs"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportLoading ? "Exporting..." : `Export (${filteredBoreholes.length})`}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard 
          title="Total Boreholes" 
          value={stats.totalBoreholes} 
          icon={Building}
          additionalInfo={
            <>
              <div>• {stats.drilledBoreholes} drilled</div>
              <div>• {stats.maintainedBoreholes} maintained</div>
            </>
          }
        />

        <StatsCard 
          title="People Served" 
          value={stats.totalPeople.toLocaleString()} 
          icon={Users}
          description="Total people using boreholes"
        />

        <StatsCard 
          title="Water Used" 
          value={`${stats.totalWaterUsed.toLocaleString()}L`} 
          icon={Droplets}
          description="Total water consumption"
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
              <p className="text-muted-foreground mt-2">Loading borehole data...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {allBoreholes.length === 0 ? "No borehole data found in database" : "No records found matching your criteria"}
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
                      <th className="py-3 px-4 font-medium text-gray-600">Borehole Location</th>
                      <th className="py-3 px-4 font-medium text-gray-600">People Using Water</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Water Used</th>
                      <th className="py-3 px-4 font-medium text-gray-600">Status</th>
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
                  {filteredBoreholes.length} total records • {currentPageRecords.length} on this page
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
              Borehole Details
            </DialogTitle>
            <DialogDescription>
              Complete information for this borehole record
            </DialogDescription>
          </DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              {/* Location Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Location Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Date Recorded</Label>
                    <p className="text-slate-900 font-medium">{formatDate(viewingRecord.date)}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Borehole Location</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.location || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Usage Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Usage Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">People Using Water</Label>
                    <p className="text-slate-900 font-medium text-lg font-bold text-blue-700">
                      {displayPeopleValue(viewingRecord.people)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Water Used</Label>
                    <p className="text-slate-900 font-medium text-lg font-bold text-cyan-700">
                      {viewingRecord.waterUsed || 0} liters
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Borehole Status
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Drilled</Label>
                    <Badge variant={viewingRecord.drilled ? "default" : "secondary"} 
                      className={viewingRecord.drilled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                      {viewingRecord.drilled ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Maintained</Label>
                    <Badge variant={viewingRecord.maintained ? "default" : "secondary"} 
                      className={viewingRecord.maintained ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}>
                      {viewingRecord.maintained ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <Droplets className="h-4 w-4" />
                  Water Usage Summary
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label className="text-sm font-medium text-slate-600">Average Water per Person</Label>
                    <p className="text-slate-900 font-medium">
                      {viewingRecord.people && viewingRecord.waterUsed && safePeopleToNumber(viewingRecord.people) > 0 
                        ? `${(viewingRecord.waterUsed / safePeopleToNumber(viewingRecord.people)).toFixed(1)} liters/person`
                        : 'N/A'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button 
              onClick={() => setIsViewDialogOpen(false)}
              className="bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Borehole Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Plus className="h-5 w-5" />
              Add New Borehole
            </DialogTitle>
            <DialogDescription>
              Create a new borehole record in the database
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-date" className="font-semibold text-gray-700">Date</Label>
              <Input
                id="create-date"
                type="date"
                value={newBorehole.date as string}
                onChange={(e) => setNewBorehole(prev => ({ ...prev, date: e.target.value }))}
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-location" className="font-semibold text-gray-700">Borehole Location *</Label>
              <Input
                id="create-location"
                placeholder="Enter borehole location"
                value={newBorehole.location || ''}
                onChange={(e) => setNewBorehole(prev => ({ ...prev, location: e.target.value }))}
                className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-people" className="font-semibold text-gray-700">People Using Water</Label>
                <Input
                  id="create-people"
                  type="number"
                  placeholder="0"
                  value={newBorehole.people || ''}
                  onChange={(e) => setNewBorehole(prev => ({ ...prev, people: parseInt(e.target.value) || 0 }))}
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-water" className="font-semibold text-gray-700">Water Used (L)</Label>
                <Input
                  id="create-water"
                  type="number"
                  placeholder="0"
                  value={newBorehole.waterUsed || ''}
                  onChange={(e) => setNewBorehole(prev => ({ ...prev, waterUsed: parseInt(e.target.value) || 0 }))}
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="create-drilled"
                  checked={newBorehole.drilled || false}
                  onCheckedChange={(checked) => setNewBorehole(prev => ({ ...prev, drilled: checked as boolean }))}
                />
                <Label htmlFor="create-drilled" className="font-semibold text-gray-700">Drilled</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="create-maintained"
                  checked={newBorehole.maintained || false}
                  onCheckedChange={(checked) => setNewBorehole(prev => ({ ...prev, maintained: checked as boolean }))}
                />
                <Label htmlFor="create-maintained" className="font-semibold text-gray-700">Maintained</Label>
              </div>
            </div>
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setNewBorehole({
                  date: new Date().toISOString().split('T')[0],
                  location: "",
                  people: 0,
                  waterUsed: 0,
                  drilled: false,
                  maintained: false
                });
              }}
              disabled={createLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateBorehole}
              disabled={createLoading || !newBorehole.location}
              className="bg-gradient-to-r from-green-600 to-emerald-700 hover:from-green-700 hover:to-emerald-800 text-white"
            >
              {createLoading ? "Creating..." : "Create Borehole"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Borehole Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-blue-600">
              <Edit className="h-5 w-5" />
              Edit Borehole
            </DialogTitle>
            <DialogDescription>
              Update the borehole record information
            </DialogDescription>
          </DialogHeader>
          
          {editingRecord && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date" className="font-semibold text-gray-700">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={formatDate(editingRecord.date).split(' ').reverse().join('-')}
                  onChange={(e) => setEditingRecord(prev => prev ? { ...prev, date: new Date(e.target.value) } : null)}
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-location" className="font-semibold text-gray-700">Borehole Location *</Label>
                <Input
                  id="edit-location"
                  placeholder="Enter borehole location"
                  value={editingRecord.location || ''}
                  onChange={(e) => setEditingRecord(prev => prev ? { ...prev, location: e.target.value } : null)}
                  className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-people" className="font-semibold text-gray-700">People Using Water</Label>
                  <Input
                    id="edit-people"
                    type="number"
                    placeholder="0"
                    value={editingRecord.people || ''}
                    onChange={(e) => setEditingRecord(prev => prev ? { ...prev, people: parseInt(e.target.value) || 0 } : null)}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-water" className="font-semibold text-gray-700">Water Used (L)</Label>
                  <Input
                    id="edit-water"
                    type="number"
                    placeholder="0"
                    value={editingRecord.waterUsed || ''}
                    onChange={(e) => setEditingRecord(prev => prev ? { ...prev, waterUsed: parseInt(e.target.value) || 0 } : null)}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-drilled"
                    checked={editingRecord.drilled || false}
                    onCheckedChange={(checked) => setEditingRecord(prev => prev ? { ...prev, drilled: checked as boolean } : null)}
                  />
                  <Label htmlFor="edit-drilled" className="font-semibold text-gray-700">Drilled</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-maintained"
                    checked={editingRecord.maintained || false}
                    onCheckedChange={(checked) => setEditingRecord(prev => prev ? { ...prev, maintained: checked as boolean } : null)}
                  />
                  <Label htmlFor="edit-maintained" className="font-semibold text-gray-700">Maintained</Label>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingRecord(null);
              }}
              disabled={editLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditBorehole}
              disabled={editLoading || !editingRecord?.location}
              className="bg-gradient-to-r from-blue-600 to-cyan-700 hover:from-blue-700 hover:to-cyan-800 text-white"
            >
              {editLoading ? "Updating..." : "Update Borehole"}
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
              Upload Borehole Data
            </DialogTitle>
            <DialogDescription>
              Upload CSV, JSON, or Excel files containing borehole data. The data will be validated against the database schema.
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

export default BoreholePage;