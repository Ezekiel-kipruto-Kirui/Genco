import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  collection, 
  getDocs, 
  query, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc, 
  writeBatch, 
  Firestore 
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Download, Users, Edit, Trash2, GraduationCap, Eye, MapPin, Upload, Plus, 
  Calendar, X, UserPlus, User, Phone, Map, FileText, MessageSquare, BookOpen, 
  Heart, Zap, Target, Leaf, Shield, CheckCircle, Clock, ChevronLeft, ChevronRight 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from 'xlsx';

// --- Constants ---
const COLLECTION_NAME = "Onboarding";
const CARDS_PER_PAGE = 3;

// --- Interfaces ---
interface FarmerData {
  id?: string;
  name: string;
  idNo: string;
  phoneNo: string;
  location: string;
  region: string;
  gender: string;
  county: string;
}

interface StaffData {
  name: string;
  role: string;
}

interface OnboardingData {
  id?: string;
  date: Date;
  topic: string;
  comment: string;
  staff: StaffData[];
  farmers: FarmerData[];
  createdAt?: Date;
  status: 'pending' | 'completed';
}

interface Filters {
  startDate: string;
  endDate: string;
}

interface Stats {
  totalFarmers: number;
  totalOnboarding: number;
  uniqueLocations: number;
  completedSessions: number;
  pendingSessions: number;
  maleFarmers: number;
  femaleFarmers: number;
  uniqueCounties: number;
}

// --- Utility Functions ---

export const isChiefAdmin = (userRole: string | null): boolean => {
  return userRole === 'chief-admin';
};

const getTopicIcon = (topic: string) => {
  const topicLower = topic.toLowerCase();
  
  if (topicLower.includes('health') || topicLower.includes('medical') || topicLower.includes('vaccin')) {
    return <Heart className="h-5 w-5 text-red-500" />;
  } else if (topicLower.includes('breed') || topicLower.includes('genetic') || topicLower.includes('reproduction')) {
    return <Leaf className="h-5 w-5 text-green-500" />;
  } else if (topicLower.includes('feed') || topicLower.includes('nutrition') || topicLower.includes('diet')) {
    return <Zap className="h-5 w-5 text-yellow-500" />;
  } else if (topicLower.includes('market') || topicLower.includes('business') || topicLower.includes('economic')) {
    return <Target className="h-5 w-5 text-blue-500" />;
  } else if (topicLower.includes('safety') || topicLower.includes('security') || topicLower.includes('protection')) {
    return <Shield className="h-5 w-5 text-purple-500" />;
  } else {
    return <BookOpen className="h-5 w-5 text-gray-500" />;
  }
};

const getStatusBadge = (status: 'pending' | 'completed') => {
  if (status === 'completed') {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        <CheckCircle className="h-3 w-3 mr-1" />
        Completed
      </Badge>
    );
  } else {
    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-300">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  }
};

// --- Components ---

interface StatsCardProps {
  title: string;
  value: number;
  icon: any;
  description?: string;
}

const StatsCard = ({ title, value, icon: Icon, description }: StatsCardProps) => (
  <Card className="bg-white text-slate-900 shadow-lg border border-gray-200 relative overflow-hidden">
    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-purple-600"></div>
    
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
      <CardTitle className="text-sm font-medium text-gray-400">{title}</CardTitle>
    </CardHeader>
    <CardContent className="pl-6 pb-4 flex flex-row">
      <div className="mr-2 rounded-full">
        <Icon className="h-8 w-8 text-blue-600" />
      </div>
      <div>
        <div className="text-2xl font-bold text-green-500 mb-2">{value}</div>
        {description && (
          <p className="text-xs mt-2 bg-orange-50 px-2 py-1 rounded-md border border-slate-100">
            {description}
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);

interface OnboardingCardProps {
  record: OnboardingData;
  isSelected: boolean;
  userIsChiefAdmin: boolean;
  onSelectRecord: (id: string) => void;
  onView: (record: OnboardingData) => void;
  onEdit: (record: OnboardingData) => void;
  onDeleteClick: (record: OnboardingData) => void;
}

const OnboardingCard = ({ 
  record, 
  isSelected, 
  userIsChiefAdmin, 
  onSelectRecord, 
  onView, 
  onEdit, 
  onDeleteClick 
}: OnboardingCardProps) => {
  const uniqueRegions = useMemo(() => {
    const regions = record.farmers.map(farmer => farmer.region).filter(Boolean);
    return [...new Set(regions)];
  }, [record.farmers]);

  const genderStats = useMemo(() => {
    const maleCount = record.farmers.filter(f => f.gender?.toLowerCase() === 'male').length;
    const femaleCount = record.farmers.filter(f => f.gender?.toLowerCase() === 'female').length;
    return { maleCount, femaleCount };
  }, [record.farmers]);

  return (
    <Card className={`bg-white shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ${
      isSelected ? 'ring-2 ring-blue-500 border-blue-500' : ''
    }`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {getTopicIcon(record.topic)}
              <CardTitle className="text-lg font-bold text-gray-800">{record.topic}</CardTitle>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span>{record.date.toLocaleDateString()}</span>
              </div>
              {getStatusBadge(record.status)}
            </div>
          </div>
          {userIsChiefAdmin && (
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => record.id && onSelectRecord(record.id)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {record.comment && (
          <div className="pt-2 border-t">
            <div className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border">
              <MessageSquare className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-gray-600">Comments:</span>
                <p className="mt-1 text-gray-800">{record.comment}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 pt-2 border-t">
          <div className="flex justify-between m-2 p-1">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
              <User className="h-4 w-4" />
              <span>Trainers</span>
            </div>
            <div className="text-md text-blue-800">{record.staff.length}</div>
          </div>
          <div className="flex justify-between m-2 p-1">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700">
              <Users className="h-4 w-4" />
              <span>Farmers</span>
            </div>
            <div className="text-md text-green-800">{record.farmers.length}</div>
          </div>
        </div>

        <div className="pt-2 border-t">
          <div className="flex justify-between m-2 p-1">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <MapPin className="h-3 w-3" />
              <span>Subcounty</span>
            </div>
            <div className="text-sm font-semibold text-green-600">
              {uniqueRegions.length > 0 ? (
                <div className="flex flex-wrap gap-1 justify-end">
                  {uniqueRegions.slice(0, 2).map((region, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{region}</Badge>
                  ))}
                  {uniqueRegions.length > 2 && (
                    <Badge variant="outline" className="text-xs">+{uniqueRegions.length - 2} more</Badge>
                  )}
                </div>
              ) : (
                <span className="text-gray-400">No regions</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-3 border-t">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs hover:bg-blue-50 hover:text-blue-600 border-blue-200"
            onClick={() => onView(record)}
          >
            <Eye className="h-3 w-3 mr-1" />
            View Details
          </Button>
          {userIsChiefAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-green-50 hover:text-green-600 border-green-200"
                onClick={() => onEdit(record)}
              >
                <Edit className="h-3 w-3 text-green-500" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 border-red-200"
                onClick={() => onDeleteClick(record)}
              >
                <Trash2 className="h-3 w-3 text-red-500" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// --- Main Page Component ---

const OnboardingPage = () => {
  const [onboarding, setOnboarding] = useState<OnboardingData[]>([]);
  const [filteredOnboarding, setFilteredOnboarding] = useState<OnboardingData[]>([]);
  const [displayedOnboarding, setDisplayedOnboarding] = useState<OnboardingData[]>([]);
  const [onboardingForm, setOnboardingForm] = useState({
    id: "",
    topic: "",
    comment: "",
    date: "",
    status: 'pending' as 'pending' | 'completed'
  });
  const [staff, setStaff] = useState<StaffData[]>([{ name: "", role: "" }]);
  const [farmers, setFarmers] = useState<FarmerData[]>([
    { name: "", idNo: "", phoneNo: "", location: "", region: "", gender: "", county: "" } 
  ]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  
  const [selectedRecord, setSelectedRecord] = useState<OnboardingData | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  
  const { toast } = useToast();
  const { user, userRole } = useAuth();

  // Fix for TypeScript errors: Ensure db is treated as Firestore
  const firestore = db as unknown as Firestore;

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);

  const [filters, setFilters] = useState<Filters>({
    startDate: "",
    endDate: "",
  });

  const [stats, setStats] = useState<Stats>({
    totalFarmers: 0,
    totalOnboarding: 0,
    uniqueLocations: 0,
    completedSessions: 0,
    pendingSessions: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    uniqueCounties: 0
  });

  const getCurrentMonthDates = () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: startOfMonth.toISOString().split('T')[0],
      endDate: endOfMonth.toISOString().split('T')[0]
    };
  };

  const currentMonth = useMemo(getCurrentMonthDates, []);

  const readExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const fetchOnboardingData = async () => {
    try {
      setLoading(true);
      // Using fixed firestore variable
      const q = query(collection(firestore, COLLECTION_NAME));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => {
        const docData = doc.data();
        return {
          id: doc.id,
          date: docData.date?.toDate() || new Date(),
          topic: docData.topic || "",
          comment: docData.comment || "",
          staff: docData.staff || [],
          farmers: docData.farmers || [],
          createdAt: docData.createdAt?.toDate() || new Date(),
          status: docData.status || 'pending'
        } as OnboardingData;
      });
      setOnboarding(data);
      setFilteredOnboarding(data);
      setSelectedRecords([]);
    } catch (error) {
      console.error("Error fetching onboarding data:", error);
      toast({
        title: "Error",
        description: "Failed to fetch onboarding data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnboardingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterAndProcessData = useCallback((data: OnboardingData[], filterParams: Filters) => {
    const filtered = data.filter(record => {
      if (filterParams.startDate || filterParams.endDate) {
        const recordDate = new Date(record.date);
        recordDate.setHours(0, 0, 0, 0);

        const startDate = filterParams.startDate ? new Date(filterParams.startDate) : null;
        const endDate = filterParams.endDate ? new Date(filterParams.endDate) : null;
        if (startDate) startDate.setHours(0, 0, 0, 0);
        if (endDate) endDate.setHours(23, 59, 59, 999);

        if (startDate && recordDate < startDate) return false;
        if (endDate && recordDate > endDate) return false;
      }
      return true;
    });

    const allFarmers = filtered.flatMap(record => record.farmers);
    const uniqueFarmers = new Set(allFarmers.map(f => f.idNo || f.name));
    const uniqueLocations = new Set(allFarmers.map(f => f.location).filter(Boolean));
    const uniqueCounties = new Set(allFarmers.map(f => f.county).filter(Boolean));
    const completedSessions = filtered.filter(r => r.status === 'completed').length;
    const pendingSessions = filtered.filter(r => r.status === 'pending').length;
    
    const maleFarmers = allFarmers.filter(f => f.gender?.toLowerCase() === 'male').length;
    const femaleFarmers = allFarmers.filter(f => f.gender?.toLowerCase() === 'female').length;

    return {
      filteredOnboarding: filtered,
      stats: {
        totalFarmers: uniqueFarmers.size,
        totalOnboarding: filtered.length,
        uniqueLocations: uniqueLocations.size,
        uniqueCounties: uniqueCounties.size,
        completedSessions,
        pendingSessions,
        maleFarmers,
        femaleFarmers
      }
    };
  }, []);

  useEffect(() => {
    if (onboarding.length === 0) return;
    const result = filterAndProcessData(onboarding, filters);
    setFilteredOnboarding(result.filteredOnboarding);
    setStats(result.stats);
    setCurrentPage(1);
  }, [onboarding, filters, filterAndProcessData]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
    const endIndex = startIndex + CARDS_PER_PAGE;
    setDisplayedOnboarding(filteredOnboarding.slice(startIndex, endIndex));
  }, [filteredOnboarding, currentPage]);

  const totalPages = Math.ceil(filteredOnboarding.length / CARDS_PER_PAGE);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  const handleSelectRecord = (recordId: string) => {
    setSelectedRecords(prev => 
      prev.includes(recordId) ? prev.filter(id => id !== recordId) : [...prev, recordId]
    );
  };

  const handleSelectAllOnPage = () => {
    const pageRecordIds = displayedOnboarding
      .filter(r => r.id)
      .map(r => r.id!) as string[];
    
    if (selectedRecords.length === pageRecordIds.length) {
      setSelectedRecords([]);
    } else {
      setSelectedRecords(pageRecordIds);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRecords.length === 0) return;
    try {
      setLoading(true);
      const batch = writeBatch(firestore); // Using fixed firestore variable
      selectedRecords.forEach(id => {
        const recordRef = doc(firestore, COLLECTION_NAME, id); // Using fixed firestore variable
        batch.delete(recordRef);
      });
      await batch.commit();
      toast({ title: "Success", description: `Successfully deleted ${selectedRecords.length} records` });
      setIsBulkDeleteDialogOpen(false);
      setSelectedRecords([]);
      fetchOnboardingData();
    } catch (error) {
      console.error("Error deleting records:", error);
      toast({ title: "Error", description: "Failed to delete records", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAddOnboarding = async () => {
    try {
      if (!onboardingForm.topic || !onboardingForm.date) {
        toast({ title: "Validation Error", description: "Please fill required fields", variant: "destructive" });
        return;
      }

      const validStaff = staff.filter(s => s.name.trim() !== "");
      const validFarmers = farmers.filter(f => f.name.trim() !== "");

      if (validStaff.length === 0 || validFarmers.length === 0) {
        toast({ title: "Validation Error", description: "Add at least one staff and one farmer", variant: "destructive" });
        return;
      }

      setLoading(true);
      const data = {
        ...onboardingForm,
        date: new Date(onboardingForm.date),
        staff: validStaff,
        farmers: validFarmers,
        createdAt: new Date()
      };

      if (onboardingForm.id) {
        await updateDoc(doc(firestore, COLLECTION_NAME, onboardingForm.id), { // Using fixed firestore variable
          ...data,
          updatedAt: new Date()
        });
        toast({ title: "Success", description: "Record updated successfully" });
      } else {
        await addDoc(collection(firestore, COLLECTION_NAME), data); // Using fixed firestore variable
        toast({ title: "Success", description: "Record added successfully" });
      }

      resetForm();
      setIsDialogOpen(false);
      fetchOnboardingData();
    } catch (error) {
      console.error("Error saving record:", error);
      toast({ title: "Error", description: "Failed to save record", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setOnboardingForm({ id: "", topic: "", comment: "", date: "", status: 'pending' });
    setStaff([{ name: "", role: "" }]);
    setFarmers([{ name: "", idNo: "", phoneNo: "", location: "", region: "", gender: "", county: "" }]);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedRecord?.id) return;
    try {
      setLoading(true);
      await deleteDoc(doc(firestore, COLLECTION_NAME, selectedRecord.id)); // Using fixed firestore variable
      toast({ title: "Success", description: "Record deleted successfully" });
      setIsDeleteDialogOpen(false);
      setSelectedRecord(null);
      fetchOnboardingData();
    } catch (error) {
      console.error("Error deleting:", error);
      toast({ title: "Error", description: "Failed to delete record", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const data = await readExcelFile(file);
      const validatedFarmers = validateExcelData(data);
      if (validatedFarmers.length === 0) {
        toast({ title: "No valid data", description: "Incorrect Excel format", variant: "destructive" });
        return;
      }
      setFarmers(prev => [...prev.filter(f => f.name.trim() !== ""), ...validatedFarmers]);
      toast({ title: "Success", description: `Loaded ${validatedFarmers.length} farmers` });
      setIsUploadDialogOpen(false);
      event.target.value = ""; // Reset input
    } catch (error) {
      console.error("Error uploading Excel:", error);
      toast({ title: "Upload Failed", description: "Failed to process file", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const validateExcelData = (data: any[]): FarmerData[] => {
    return data.filter(item => item.name).map(item => ({
      name: item.name || "",
      gender: item.gender || item.Gender || "",
      idNo: item.idNo || item.idNumber || item.farmeridNo || "",
      phoneNo: item.phoneNo || item.phoneNumber || item.farmerphoneNo || "",
      location: item.location || item.farmerlocation || "",
      region: item.region || item.farmerregion || "",
      county: item.county || item.County || ""
    }));
  };

  const downloadTemplate = () => {
    const templateData = [{
      name: "Farmer Name",
      gender: "Gender (Male/Female)",
      idNo: "ID Number",
      phoneNo: "Phone Number",
      location: "Location",
      region: "Region",
      county: "County"
    }];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Farmers Template");
    XLSX.writeFile(wb, "farmers_template.xlsx");
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      if (filteredOnboarding.length === 0) {
        toast({ title: "No Data", description: "No records to export", variant: "destructive" });
        return;
      }

      const exportData = filteredOnboarding.flatMap(record => 
        record.farmers.map(farmer => ({
          Date: record.date.toLocaleDateString(),
          Topic: record.topic,
          Comment: record.comment || 'N/A',
          Status: record.status,
          'Staff Members': record.staff.map(s => `${s.name} (${s.role})`).join(', '),
          'Farmer Name': farmer.name,
          'Farmer Gender': farmer.gender || 'N/A',
          'Farmer ID': farmer.idNo,
          'Phone Number': farmer.phoneNo,
          Location: farmer.location,
          Region: farmer.region,
          County: farmer.county || 'N/A',
          'Created Date': record.createdAt?.toLocaleDateString() || 'N/A'
        }))
      );

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Onboarding Data");
      XLSX.writeFile(wb, `onboarding_data_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast({ title: "Export Successful", description: `Exported ${exportData.length} records` });
    } catch (error) {
      console.error("Export error:", error);
      toast({ title: "Export Failed", description: "Failed to export data", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const clearAllFilters = () => setFilters({ startDate: "", endDate: "" });
  const resetToCurrentMonth = () => setFilters(prev => ({ ...prev, ...currentMonth }));

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Additional Training</h1>
        <div className="flex gap-2">
          {userIsChiefAdmin && selectedRecords.length > 0 && (
            <Button variant="destructive" onClick={() => setIsBulkDeleteDialogOpen(true)}>
              <Trash2 className="w-4 h-4 mr-2" /> Delete Selected ({selectedRecords.length})
            </Button>
          )}
          {userIsChiefAdmin && (
             <Button onClick={handleExport} disabled={exportLoading || filteredOnboarding.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              {exportLoading ? "Exporting..." : `Export (${filteredOnboarding.flatMap(r => r.farmers).length})`}
            </Button>
          )}
          {userIsChiefAdmin && (
            <Button onClick={() => { resetForm(); setIsDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Add Training
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard title="TOTAL FARMERS" value={stats.totalFarmers} icon={Users} description="Unique farmers trained" />
        <StatsCard title="TRAINING SESSIONS" value={stats.totalOnboarding} icon={GraduationCap} description={`${stats.completedSessions} completed, ${stats.pendingSessions} pending`} />
        <StatsCard title="LOCATIONS COVERED" value={stats.uniqueLocations} icon={MapPin} description="Unique locations reached" />
        <StatsCard title="COUNTIES COVERED" value={stats.uniqueCounties} icon={Map} description="Unique counties reached" />
      </div>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate" className="font-semibold text-gray-700">From Date</Label>
              <Input id="startDate" type="date" value={filters.startDate} onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))} className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate" className="font-semibold text-gray-700">To Date</Label>
              <Input id="endDate" type="date" value={filters.endDate} onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))} className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 bg-white" />
            </div>
            <div className="space-y-2 flex items-end">
              <div className="flex gap-2 w-full">
                <Button variant="outline" size="sm" onClick={clearAllFilters} className="flex-1"><X className="w-4 h-4 mr-1" /> Clear</Button>
                <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="flex-1"><Calendar className="w-4 h-4 mr-1" /> This Month</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg border-0 bg-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle>Additional Training Records</CardTitle>
            {userIsChiefAdmin && displayedOnboarding.length > 0 && (
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={selectedRecords.length === displayedOnboarding.filter(r => r.id).length} onChange={handleSelectAllOnPage} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                <Label className="text-sm text-gray-600">Select all on page</Label>
              </div>
            )}
          </div>
          {filteredOnboarding.length > CARDS_PER_PAGE && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p - 1)} disabled={!hasPrevPage} className="h-8 w-8 p-0"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => p + 1)} disabled={!hasNextPage} className="h-8 w-8 p-0"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div></div>
          ) : displayedOnboarding.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No records found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedOnboarding.map((record) => (
                <OnboardingCard 
                  key={record.id} 
                  record={record} 
                  isSelected={!!record.id && selectedRecords.includes(record.id)}
                  userIsChiefAdmin={userIsChiefAdmin}
                  onSelectRecord={handleSelectRecord}
                  onView={setSelectedRecord} // Reusing setRecord state to open view dialog
                  onEdit={() => { 
                      setOnboardingForm({
                        id: record.id || "",
                        topic: record.topic,
                        comment: record.comment || "",
                        date: record.date.toISOString().split('T')[0],
                        status: record.status
                      });
                      setStaff(record.staff.length > 0 ? record.staff : [{ name: "", role: "" }]);
                      setFarmers(record.farmers.length > 0 ? record.farmers : [{ name: "", idNo: "", phoneNo: "", location: "", region: "", gender: "", county: "" }]);
                      setIsDialogOpen(true);
                  }}
                  onDeleteClick={() => { setSelectedRecord(record); setIsDeleteDialogOpen(true); }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {userIsChiefAdmin && (
        <>
          {/* Add/Edit Dialog */}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="max-w-6xl max-h-[90vh]">
              <DialogHeader><DialogTitle>{onboardingForm.id ? "Edit" : "Add New"} Onboarding</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 gap-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2"><Label>Topic *</Label><Input value={onboardingForm.topic} onChange={e => setOnboardingForm(p => ({ ...p, topic: e.target.value }))} placeholder="Enter topic" /></div>
                  <div className="space-y-2"><Label>Comment/Notes</Label><textarea value={onboardingForm.comment} onChange={e => setOnboardingForm(p => ({ ...p, comment: e.target.value }))} rows={3} className="w-full px-3 py-2 border rounded-md" /></div>
                  <div className="space-y-2"><Label>Date *</Label><Input type="date" value={onboardingForm.date} onChange={e => setOnboardingForm(p => ({ ...p, date: e.target.value }))} /></div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <div className="flex gap-2">
                      <Button type="button" variant={onboardingForm.status === 'pending' ? 'default' : 'outline'} onClick={() => setOnboardingForm(p => ({ ...p, status: 'pending' }))} className="flex-1"><Clock className="h-4 w-4 mr-2" /> Pending</Button>
                      <Button type="button" variant={onboardingForm.status === 'completed' ? 'default' : 'outline'} onClick={() => setOnboardingForm(p => ({ ...p, status: 'completed' }))} className="flex-1"><CheckCircle className="h-4 w-4 mr-2" /> Completed</Button>
                    </div>
                  </div>
                </div>
                
                {/* Staff */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-lg font-semibold">Trainers ({staff.filter(s => s.name.trim() !== "").length})</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() => setStaff(p => [...p, { name: "", role: "" }])}><UserPlus className="w-4 h-4 mr-1" /> Add trainer</Button>
                  </div>
                  <div className="space-y-3 max-h-48 overflow-y-auto border rounded-lg p-4 bg-gray-50">
                    {staff.map((s, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end p-3 border rounded bg-white">
                        <Input placeholder="Trainer Name *" value={s.name} onChange={e => { const newStaff = [...staff]; newStaff[i].name = e.target.value; setStaff(newStaff); }} />
                        <Input placeholder="Role *" value={s.role} onChange={e => { const newStaff = [...staff]; newStaff[i].role = e.target.value; setStaff(newStaff); }} />
                        <div className="flex justify-end">{staff.length > 1 && <Button variant="outline" size="sm" className="h-10 w-10 p-0 text-red-500" onClick={() => setStaff(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Farmers */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-lg font-semibold">Farmers ({farmers.filter(f => f.name.trim() !== "").length})</Label>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)}><Upload className="w-4 h-4 mr-1" /> Upload Excel</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setFarmers(p => [...p, { name: "", idNo: "", phoneNo: "", location: "", region: "", gender: "", county: "" }])}><UserPlus className="w-4 h-4 mr-1" /> Add Farmer</Button>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-64 overflow-y-auto border rounded-lg p-4 bg-gray-50">
                    {farmers.map((f, i) => (
                      <div key={i} className="grid grid-cols-1 md:grid-cols-7 gap-2 items-end p-3 border rounded bg-white">
                        <Input placeholder="Name *" value={f.name} onChange={e => { const newF = [...farmers]; newF[i].name = e.target.value; setFarmers(newF); }} />
                        <select value={f.gender} onChange={e => { const newF = [...farmers]; newF[i].gender = e.target.value; setFarmers(newF); }} className="w-full px-3 py-2 border rounded-md bg-white"><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option></select>
                        <Input placeholder="ID Number" value={f.idNo} onChange={e => { const newF = [...farmers]; newF[i].idNo = e.target.value; setFarmers(newF); }} />
                        <Input placeholder="Phone" value={f.phoneNo} onChange={e => { const newF = [...farmers]; newF[i].phoneNo = e.target.value; setFarmers(newF); }} />
                        <Input placeholder="Location" value={f.location} onChange={e => { const newF = [...farmers]; newF[i].location = e.target.value; setFarmers(newF); }} />
                        <Input placeholder="Region" value={f.region} onChange={e => { const newF = [...farmers]; newF[i].region = e.target.value; setFarmers(newF); }} />
                        <div className="flex gap-2">
                           <Input placeholder="County" value={f.county} onChange={e => { const newF = [...farmers]; newF[i].county = e.target.value; setFarmers(newF); }} />
                           {farmers.length > 1 && <Button variant="outline" size="sm" className="h-10 w-10 p-0 text-red-500" onClick={() => setFarmers(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleAddOnboarding} disabled={loading}>{loading ? "Saving..." : (onboardingForm.id ? "Update" : "Add")} Onboarding</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle><DialogDescription>Are you sure you want to delete {selectedRecord?.topic}? This cannot be undone.</DialogDescription></DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDeleteConfirm} disabled={loading}>Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Confirm Bulk Deletion</DialogTitle><DialogDescription>Delete {selectedRecords.length} selected records? This cannot be undone.</DialogDescription></DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleBulkDelete} disabled={loading}>Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Upload Farmers Excel</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <Button onClick={downloadTemplate} variant="outline"><Download className="w-4 h-4 mr-2" /> Download Template</Button>
                <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} disabled={loading} />
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* View Dialog - Available for all users */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Additional Training Details</DialogTitle>
            <DialogDescription>
              {selectedRecord && (
                <div className="grid grid-cols-1 gap-2 mt-2 text-sm">
                  <div><strong>Date:</strong> {selectedRecord.date.toLocaleDateString()}</div>
                  <div><strong>Topic:</strong> {selectedRecord.topic}</div>
                  <div><strong>Status:</strong> {getStatusBadge(selectedRecord.status)}</div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-6 max-h-96 overflow-y-auto">
            <div>
              <h4 className="font-semibold mb-3">Trainers ({selectedRecord?.staff.length || 0})</h4>
              <div className="space-y-2">
                {selectedRecord?.staff.map((s, i) => (
                  <div key={i} className="flex justify-between items-center p-2 border rounded bg-gray-50"><span className="font-medium">{s.name}</span><Badge variant="secondary">{s.role}</Badge></div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Farmers ({selectedRecord?.farmers.length || 0})</h4>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full border-collapse border border-gray-300 text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      {['Name', 'Gender', 'ID Number', 'Phone', 'Location', 'Region', 'County'].map(h => (
                        <th key={h} className="text-left py-2 px-3 font-medium text-gray-600 border">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecord?.farmers.map((f, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-3 border text-gray-700">{f.name}</td>
                        <td className="py-2 px-3 border text-gray-700"><Badge variant={f.gender === 'Male' ? 'default' : 'secondary'} className={f.gender === 'Male' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}>{f.gender || 'N/A'}</Badge></td>
                        <td className="py-2 px-3 border text-gray-700"><code className="bg-gray-100 px-2 py-1 rounded text-sm">{f.idNo || 'N/A'}</code></td>
                        <td className="py-2 px-3 border text-gray-700">{f.phoneNo || 'N/A'}</td>
                        <td className="py-2 px-3 border text-gray-700">{f.location || 'N/A'}</td>
                        <td className="py-2 px-3 border text-gray-700"><Badge variant="secondary">{f.region || 'N/A'}</Badge></td>
                        <td className="py-2 px-3 border text-gray-700"><Badge variant="outline" className="bg-purple-50 text-purple-700">{f.county || 'N/A'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OnboardingPage;