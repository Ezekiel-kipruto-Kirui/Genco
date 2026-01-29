import { useState, useEffect, useMemo } from "react";
// REALTIME DATABASE IMPORTS
import { ref, get, push, remove, update, DatabaseReference } from "firebase/database";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { isChiefAdmin } from "@/contexts/authhelper";
import { 
  Users, 
  MapPin, 
  Plus, 
  Calendar, 
  Eye,
  Edit,
  Trash2,
  X,
  Search,
  MoreVertical,
  Syringe,
  Activity,
  TrendingUp,
  TrendingDown,
  Download,
  CheckSquare,
  Square,
  Save
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface FieldOfficer {
  name: string;
  role: string;
}

interface Vaccine {
  type: string;
  doses: number;
}

interface AnimalHealthActivity {
  id: string;
  date: string;
  county: string;
  subcounty: string;
  location: string;
  comment: string;
  vaccines?: Vaccine[];
  vaccinetype?: string;
  number_doses?: number;
  fieldofficers?: FieldOfficer[];
  createdAt: any;
  createdBy: string;
  status: 'completed';
}

// Vaccine options from the image
const VACCINE_OPTIONS = [
  "PPR",
  "CCPP", 
  "Sheep and Goat Pox",
  "Enterotoxemia",
  "Anthrax",
  "Rift Valley Fever",
  "Brucellosis",
  "Foot and Mouth Disease"
];

const AnimalHealthPage = () => {
  const [activities, setActivities] = useState<AnimalHealthActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isFieldOfficersDialogOpen, setIsFieldOfficersDialogOpen] = useState(false);
  const [selectedActivityFieldOfficers, setSelectedActivityFieldOfficers] = useState<FieldOfficer[]>([]);
  const [viewingActivity, setViewingActivity] = useState<AnimalHealthActivity | null>(null);
  const [editingActivity, setEditingActivity] = useState<AnimalHealthActivity | null>(null);
  const [fieldOfficerForm, setFieldOfficerForm] = useState({ name: "", role: "" });
  const [fieldOfficers, setFieldOfficers] = useState<FieldOfficer[]>([]);
  const [selectedVaccines, setSelectedVaccines] = useState<string[]>([]);
  const [totalDoses, setTotalDoses] = useState<string>("");
  const [activityForm, setActivityForm] = useState({
    date: "",
    county: "",
    subcounty: "",
    location: "",
    comment: "",
  });
  const { userRole } = useAuth();
  const userIsChiefAdmin = useMemo(() => {
    return isChiefAdmin(userRole);
  }, [userRole]);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    fetchActivities();
  }, []);

  // --- REALTIME DATABASE FETCH ---
  const fetchActivities = async () => {
    try {
      setLoading(true);
      const activitiesRef = ref(db, "AnimalHealthActivities");
      const snapshot = await get(activitiesRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        
        // Transform object from RTDB to array
        const activitiesData = Object.keys(data).map((key) => {
          const item = data[key];
          // Handle backward compatibility - convert old structure to new
          let vaccines: Vaccine[] = [];
          
          if (item.vaccines && Array.isArray(item.vaccines)) {
            // New structure with vaccines array
            vaccines = item.vaccines.map((v: any) => ({
              type: v.type || 'Unknown',
              doses: Number(v.doses) || 0
            })).filter((v: Vaccine) => v.type && v.doses > 0);
          } else if (item.vaccinetype) {
            // Old structure with vaccinetype and number_doses
            vaccines = [{
              type: item.vaccinetype,
              doses: Number(item.number_doses) || 0
            }];
          }
          
          // Ensure fieldofficers is always an array
          const fieldofficers = (item.fieldofficers && Array.isArray(item.fieldofficers)) 
            ? item.fieldofficers 
            : [];

          return {
            id: key,
            date: item.date || '',
            county: item.county || '',
            subcounty: item.subcounty || '',
            location: item.location || '',
            comment: item.comment || '',
            vaccines,
            fieldofficers,
            createdAt: item.createdAt,
            createdBy: item.createdBy || 'unknown',
            status: item.status || 'completed'
          } as AnimalHealthActivity;
        });
        
        // Sort by date descending (client-side sort for RTDB)
        activitiesData.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        });

        setActivities(activitiesData);
      } else {
        setActivities([]);
      }
    } catch (error) {
      console.error("Error fetching animal health activities:", error);
      toast({
        title: "Error",
        description: "Failed to load animal health activities",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper function to safely get vaccines from activity
  const getActivityVaccines = (activity: AnimalHealthActivity): Vaccine[] => {
    return activity.vaccines || [];
  };

  // Helper function to safely calculate total doses for an activity
  const getActivityTotalDoses = (activity: AnimalHealthActivity): number => {
    try {
      const vaccines = getActivityVaccines(activity);
      return vaccines.reduce((sum, vaccine) => {
        const doses = Number(vaccine.doses) || 0;
        return sum + doses;
      }, 0);
    } catch (error) {
      console.error("Error calculating doses for activity:", activity.id, error);
      return 0;
    }
  };

  const handleAddFieldOfficer = () => {
    if (fieldOfficerForm.name.trim() && fieldOfficerForm.role.trim()) {
      setFieldOfficers([...fieldOfficers, { 
        name: fieldOfficerForm.name.trim(), 
        role: fieldOfficerForm.role.trim() 
      }]);
      setFieldOfficerForm({ name: "", role: "" });
    }
  };

  const removeFieldOfficer = (index: number) => {
    const updatedFieldOfficers = fieldOfficers.filter((_, i) => i !== index);
    setFieldOfficers(updatedFieldOfficers);
  };

  // Handle vaccine selection
  const handleVaccineSelection = (vaccineType: string) => {
    setSelectedVaccines(prev => {
      if (prev.includes(vaccineType)) {
        return prev.filter(v => v !== vaccineType);
      } else {
        return [...prev, vaccineType];
      }
    });
  };

  // Convert selected vaccines to vaccine array with total doses
  const getVaccinesFromSelection = (): Vaccine[] => {
    if (selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0) {
      return [];
    }
    
    const dosesPerVaccine = Math.floor(parseInt(totalDoses) / selectedVaccines.length);
    const remainder = parseInt(totalDoses) % selectedVaccines.length;
    
    return selectedVaccines.map((vaccineType, index) => ({
      type: vaccineType,
      doses: index === 0 ? dosesPerVaccine + remainder : dosesPerVaccine
    }));
  };

  // --- REALTIME DATABASE ADD FUNCTION ---
  const handleAddActivity = async () => {
    // Validation checks
    if (fieldOfficers.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one field officer",
        variant: "destructive",
      });
      return;
    }

    if (selectedVaccines.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one vaccine",
        variant: "destructive",
      });
      return;
    }

    if (!totalDoses || parseInt(totalDoses) <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid total number of doses",
        variant: "destructive",
      });
      return;
    }

    if (!activityForm.date || !activityForm.county) {
      toast({
        title: "Error",
        description: "Please fill all required fields (Date and County)",
        variant: "destructive",
      });
      return;
    }

    try {
      const vaccines = getVaccinesFromSelection();
      const activityData = {
        date: activityForm.date,
        county: activityForm.county.trim(),
        subcounty: activityForm.subcounty.trim(),
        location: activityForm.location.trim(),
        comment: activityForm.comment.trim(),
        vaccines: vaccines,
        fieldofficers: fieldOfficers,
        status: 'completed' as const,
        createdBy: user?.email || 'unknown',
        createdAt: new Date().toISOString(),
      };

      console.log("Saving activity data:", activityData);

      // Add to Realtime Database
      await push(ref(db, "AnimalHealthActivities"), activityData);
      
      console.log("Activity saved successfully");

      toast({
        title: "Success",
        description: "Vaccination activity recorded successfully.",
        className: "bg-green-50 text-green-800 border border-green-200"
      });

      // Reset form
      setActivityForm({
        date: "",
        county: "",
        subcounty: "",
        location: "",
        comment: "",
      });
      setFieldOfficers([]);
      setFieldOfficerForm({ name: "", role: "" });
      setSelectedVaccines([]);
      setTotalDoses("");
      setIsAddDialogOpen(false);
      
      // Refresh data
      fetchActivities();
    } catch (error) {
      console.error("Error adding animal health activity:", error);
      toast({
        title: "Error",
        description: "Failed to record activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  // --- REALTIME DATABASE UPDATE FUNCTION ---
  const handleEditActivity = async () => {
    if (!editingActivity) return;

    try {
      const vaccines = getVaccinesFromSelection();
      const activityData = {
        date: activityForm.date,
        county: activityForm.county.trim(),
        subcounty: activityForm.subcounty.trim(),
        location: activityForm.location.trim(),
        comment: activityForm.comment.trim(),
        vaccines: vaccines,
        fieldofficers: fieldOfficers,
      };

      console.log("Updating activity:", editingActivity.id, activityData);

      // Update in Realtime Database
      await update(ref(db, "AnimalHealthActivities/" + editingActivity.id), activityData);
      
      toast({
        title: "Success",
        description: "Vaccination activity updated successfully.",
        className: "bg-green-50 text-green-800 border border-green-200"
      });
      
      setEditingActivity(null);
      setIsEditDialogOpen(false);
      setActivityForm({
        date: "",
        county: "",
        subcounty: "",
        location: "",
        comment: "",
      });
      setFieldOfficers([]);
      setFieldOfficerForm({ name: "", role: "" });
      setSelectedVaccines([]);
      setTotalDoses("");
      fetchActivities();
    } catch (error) {
      console.error("Error updating animal health activity:", error);
      toast({
        title: "Error",
        description: "Failed to update activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  // --- REALTIME DATABASE DELETE FUNCTION ---
  const handleDeleteActivity = async (activityId: string) => {
    try {
      await remove(ref(db, "AnimalHealthActivities/" + activityId));
      toast({
        title: "Success",
        description: "Vaccination activity deleted successfully.",
        className: "bg-green-50 text-green-800 border border-green-200"
      });
      fetchActivities();
    } catch (error) {
      console.error("Error deleting animal health activity:", error);
      toast({
        title: "Error",
        description: "Failed to delete activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteMultipleActivities = async () => {
    if (selectedActivities.length === 0) return;

    try {
      const deletePromises = selectedActivities.map(activityId => 
        remove(ref(db, "AnimalHealthActivities/" + activityId))
      );
      
      await Promise.all(deletePromises);
      
      toast({
        title: "Success",
        description: `${selectedActivities.length} vaccination activities deleted successfully.`,
        className: "bg-green-50 text-green-800 border border-green-200"
      });
      
      setSelectedActivities([]);
      setIsSelecting(false);
      fetchActivities();
    } catch (error) {
      console.error("Error deleting activities:", error);
      toast({
        title: "Error",
        description: "Failed to delete activities. Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleActivitySelection = (activityId: string) => {
    setSelectedActivities(prev =>
      prev.includes(activityId)
        ? prev.filter(id => id !== activityId)
        : [...prev, activityId]
    );
  };

  const selectAllActivities = () => {
    if (selectedActivities.length === filteredActivities.length) {
      setSelectedActivities([]);
    } else {
      setSelectedActivities(filteredActivities.map(activity => activity.id));
    }
  };

  const openViewDialog = (activity: AnimalHealthActivity) => {
    setViewingActivity(activity);
    setIsViewDialogOpen(true);
  };

  const openFieldOfficersDialog = (fieldOfficers: FieldOfficer[] = []) => {
    setSelectedActivityFieldOfficers(fieldOfficers);
    setIsFieldOfficersDialogOpen(true);
  };

  // Calculate vaccination rate - compare current record with previous record
  const calculateVaccinationRate = () => {
    if (activities.length < 2) return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };

    try {
      // Sort activities by date (newest first)
      const sortedActivities = [...activities].sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });

      const currentActivity = sortedActivities[0];
      const previousActivity = sortedActivities[1];

      if (!currentActivity || !previousActivity) {
        return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };
      }

      const currentDoses = getActivityTotalDoses(currentActivity);
      const previousDoses = getActivityTotalDoses(previousActivity);

      if (previousDoses === 0) {
        return currentDoses > 0 
          ? { rate: 100, trend: 'up' as const, currentDoses, previousDoses }
          : { rate: 0, trend: 'neutral' as const, currentDoses, previousDoses };
      }

      const rate = ((currentDoses - previousDoses) / previousDoses) * 100;
      return {
        rate: Math.round(rate),
        trend: rate > 0 ? 'up' as const : rate < 0 ? 'down' as const : 'neutral' as const,
        currentDoses,
        previousDoses
      };
    } catch (error) {
      console.error("Error calculating vaccination rate:", error);
      return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };
    }
  };

  // Safely calculate total doses across all activities
  const totalDosesAdministered = useMemo(() => {
    try {
      return activities.reduce((sum, activity) => {
        return sum + getActivityTotalDoses(activity);
      }, 0);
    } catch (error) {
      console.error("Error calculating total doses:", error);
      return 0;
    }
  }, [activities]);

  const vaccinationRate = calculateVaccinationRate();

  // Update the filteredActivities to search in vaccines
  const filteredActivities = useMemo(() => {
    try {
      return activities.filter(activity => {
        const activityVaccines = getActivityVaccines(activity);
        const matchesSearch = 
          (activity.comment?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (activity.location?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (activity.county?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          activityVaccines.some(vaccine => 
            (vaccine.type?.toLowerCase() || '').includes(searchTerm.toLowerCase())
          );
        
        try {
          const activityDate = activity.date ? new Date(activity.date) : new Date(0);
          const matchesStartDate = !startDate || activityDate >= new Date(startDate);
          const matchesEndDate = !endDate || activityDate <= new Date(endDate + 'T23:59:59');
          
          return matchesSearch && matchesStartDate && matchesEndDate;
        } catch (dateError) {
          console.error("Error processing date for activity:", activity.id, dateError);
          return matchesSearch;
        }
      });
    } catch (error) {
      console.error("Error filtering activities:", error);
      return [];
    }
  }, [activities, searchTerm, startDate, endDate]);

  // Update the openEditDialog function
  const openEditDialog = (activity: AnimalHealthActivity) => {
    setEditingActivity(activity);
    setActivityForm({
      date: activity.date || '',
      county: activity.county || '',
      subcounty: activity.subcounty || '',
      location: activity.location || '',
      comment: activity.comment || '',
    });
    setFieldOfficers(activity.fieldofficers || []);
    
    // Set selected vaccines and total doses for editing
    const activityVaccines = getActivityVaccines(activity);
    setSelectedVaccines(activityVaccines.map(v => v.type));
    setTotalDoses(getActivityTotalDoses(activity).toString());
    
    setIsEditDialogOpen(true);
  };

  // Update CSV export to handle multiple vaccines
  const exportToCSV = () => {
    try {
      const headers = ['Date', 'County', 'Subcounty', 'Location', 'Vaccines', 'Total Doses', 'Field Officers', 'Comment'];
      const csvData = filteredActivities.map(activity => {
        const activityVaccines = getActivityVaccines(activity);
        const vaccineText = activityVaccines.map(v => `${v.type} (${v.doses} doses)`).join('; ');
        const totalDoses = getActivityTotalDoses(activity);
        
        return [
          formatDate(activity.date),
          activity.county || '',
          activity.subcounty || '',
          activity.location || '',
          vaccineText,
          totalDoses.toString(),
          (activity.fieldofficers || []).map(officer => `${officer.name} (${officer.role})`).join('; ') || '',
          activity.comment || ''
        ];
      });

      const csvContent = [
        headers.join(','),
        ...csvData.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vaccination-activities-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Data exported successfully",
        className: "bg-green-50 text-green-800 border border-green-200"
      });
    } catch (error) {
      console.error("Error exporting CSV:", error);
      toast({
        title: "Error",
        description: "Failed to export data",
        variant: "destructive",
      });
    }
  };

  // Update the table to show multiple vaccines
  const renderVaccinesInTable = (activity: AnimalHealthActivity) => {
    const activityVaccines = getActivityVaccines(activity);
    if (activityVaccines.length === 0) return "No vaccines";
    if (activityVaccines.length === 1) return `${activityVaccines[0].type} (${activityVaccines[0].doses})`;
    return `${activityVaccines.length} vaccines`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'No date';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      console.error("Error formatting date:", dateString, error);
      return 'Invalid date';
    }
  };

  // Debug button state
  const isSaveDisabled = fieldOfficers.length === 0 || selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0 || !activityForm.date || !activityForm.county;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-md font-bold text-slate-900">Animal Health Management</h1>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              {userIsChiefAdmin && (
                <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white">
                  <Plus className="h-4 w-4 mr-2" />
                  Record Vaccination
                </Button>
              )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-md font-semibold text-slate-900">
                  Record New Vaccination Activity
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date" className="text-sm font-medium text-slate-700">
                      Date <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="date"
                      type="date"
                      value={activityForm.date}
                      onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="county" className="text-sm font-medium text-slate-700">
                      County <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="county"
                      value={activityForm.county}
                      onChange={(e) => setActivityForm({...activityForm, county: e.target.value})}
                      placeholder="Enter county"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                      required
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                    <Input
                      id="subcounty"
                      value={activityForm.subcounty}
                      onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})}
                      placeholder="Enter subcounty"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                      Location <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="location"
                      value={activityForm.location}
                      onChange={(e) => setActivityForm({...activityForm, location: e.target.value})}
                      placeholder="Enter specific location"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                      required
                    />
                  </div>
                </div>

                {/* Vaccines Section - Updated for multiple selection */}
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">
                      Vaccines ({selectedVaccines.length}) <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-xs text-slate-500">Select vaccines administered</span>
                  </div>
                  
                  {/* Vaccine Selection Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {VACCINE_OPTIONS.map((vaccine) => (
                      <div key={vaccine} className="flex items-center space-x-2">
                        <Checkbox
                          id={`vaccine-${vaccine}`}
                          checked={selectedVaccines.includes(vaccine)}
                          onCheckedChange={() => handleVaccineSelection(vaccine)}
                        />
                        <Label
                          htmlFor={`vaccine-${vaccine}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {vaccine}
                        </Label>
                      </div>
                    ))}
                  </div>

                  {/* Total Doses Input */}
                  <div className="space-y-2">
                    <Label htmlFor="total-doses" className="text-sm font-medium text-slate-700">
                      Total Doses Administered <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="total-doses"
                      type="number"
                      min="1"
                      placeholder="Enter total number of doses"
                      value={totalDoses}
                      onChange={(e) => setTotalDoses(e.target.value)}
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                    />
                    {selectedVaccines.length > 0 && totalDoses && parseInt(totalDoses) > 0 && (
                      <p className="text-xs text-slate-500">
                        Doses will be distributed equally among {selectedVaccines.length} selected vaccine(s)
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="comment" className="text-sm font-medium text-slate-700">Comment</Label>
                  <Textarea
                    id="comment"
                    value={activityForm.comment}
                    onChange={(e) => setActivityForm({...activityForm, comment: e.target.value})}
                    placeholder="Add any comments or observations about this activity..."
                    className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white min-h-[100px]"
                  />
                </div>

                {/* Field Officers Section */}
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">
                      Vaccination Team ({fieldOfficers.length}) <span className="text-red-500">*</span>
                    </Label>
                   
                  </div>
                  
                  {/* Add Field Officer Form */}
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder="Name"
                      value={fieldOfficerForm.name}
                      onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, name: e.target.value})}
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFieldOfficer();
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <Input
                        placeholder="Role"
                        value={fieldOfficerForm.role}
                        onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, role: e.target.value})}
                        className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddFieldOfficer();
                          }
                        }}
                      />
                      <Button 
                        type="button" 
                        onClick={handleAddFieldOfficer}
                        className="bg-green-500 hover:bg-green-600 text-white rounded-xl"
                        disabled={!fieldOfficerForm.name.trim() || !fieldOfficerForm.role.trim()}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Field Officers List */}
                  {fieldOfficers.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {fieldOfficers.map((officer, index) => (
                        <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                          <div className="flex-1">
                            <p className="font-medium text-slate-900">{officer.name}</p>
                            <p className="text-sm text-slate-600">{officer.role}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFieldOfficer(index)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setIsAddDialogOpen(false);
                    setFieldOfficers([]);
                    setFieldOfficerForm({ name: "", role: "" });
                    setSelectedVaccines([]);
                    setTotalDoses("");
                  }}
                  className="rounded-xl border-slate-300 hover:border-slate-400 transition-all text-slate-700"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddActivity}
                  disabled={isSaveDisabled}
                  className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  <Syringe className="h-4 w-4 mr-2" />
                  Save Vaccination
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Overview - Updated Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vaccination Rate Card */}
          <Card className="bg-white/95 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Vaccination Rate</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {vaccinationRate.rate > 0 ? '+' : ''}{vaccinationRate.rate}%
                  </p>
                  <p className="text-xs text-slate-500 mt-2">
                    {vaccinationRate.trend === 'up' ? 
                     `Increase from previous record (${vaccinationRate.previousDoses} → ${vaccinationRate.currentDoses} doses)` : 
                     vaccinationRate.trend === 'down' ? 
                     `Decrease from previous record (${vaccinationRate.previousDoses} → ${vaccinationRate.currentDoses} doses)` : 
                     activities.length >= 2 ? `No change from previous record (${vaccinationRate.currentDoses} doses)` :
                     'Not enough data for comparison'}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  vaccinationRate.trend === 'up' ? 'bg-green-100' : 
                  vaccinationRate.trend === 'down' ? 'bg-red-100' : 
                  'bg-blue-100'
                }`}>
                  {vaccinationRate.trend === 'up' ? (
                    <TrendingUp className="h-6 w-6 text-green-600" />
                  ) : vaccinationRate.trend === 'down' ? (
                    <TrendingDown className="h-6 w-6 text-red-600" />
                  ) : (
                    <Activity className="h-6 w-6 text-blue-600" />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Total Doses Card */}
          <Card className="bg-white/95 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Total Doses Administered</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{totalDosesAdministered.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-2">Across all vaccination activities</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <Syringe className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
              <Input
                placeholder="Search by comment, location, county, or vaccine type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white rounded-xl"
              />
            </div>
          </div>
          <div>
            <Input
              type="date"
              placeholder="Start Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-white rounded-xl"
            />
          </div>
          <div>
            <Input
              type="date"
              placeholder="End Date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-white rounded-xl"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            {userIsChiefAdmin && (
              <>
                <Button
                  variant={isSelecting ? "default" : "outline"}
                  onClick={() => setIsSelecting(!isSelecting)}
                  className="rounded-xl"
                >
                  {isSelecting ? (
                    <X className="h-4 w-4 mr-2" />
                  ) : (
                    <CheckSquare className="h-4 w-4 mr-2" />
                  )}
                  {isSelecting ? "Cancel Selection" : "Select Multiple"}
                </Button>
                
                {isSelecting && selectedActivities.length > 0 && (
                  <Button
                    variant="destructive"
                    onClick={handleDeleteMultipleActivities}
                    className="rounded-xl"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Selected ({selectedActivities.length})
                  </Button>
                )}
              </>
            )}
          </div>
          
          <Button
            variant="outline"
            onClick={exportToCSV}
            className="rounded-xl"
            disabled={filteredActivities.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Activities Table - Updated for multiple vaccines */}
        <Card className="bg-white/95 backdrop-blur-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 p-6">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredActivities.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200">
                      {isSelecting && (
                        <th className="p-4 text-left">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={selectAllActivities}
                            className="h-8 w-8 p-0"
                          >
                            {selectedActivities.length === filteredActivities.length ? (
                              <CheckSquare className="h-4 w-4 text-green-600" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400" />
                            )}
                          </Button>
                        </th>
                      )}
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Date</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">County</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Location</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Vaccines</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Total Doses</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Vaccination team</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActivities.map((activity) => (
                      <tr 
                        key={activity.id} 
                        className="hover:bg-slate-50/50 transition-colors duration-200 group"
                      >
                        {isSelecting && (
                          <td className="p-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleActivitySelection(activity.id)}
                              className="h-8 w-8 p-0"
                            >
                              {selectedActivities.includes(activity.id) ? (
                                <CheckSquare className="h-4 w-4 text-green-600" />
                              ) : (
                                <Square className="h-4 w-4 text-slate-400" />
                              )}
                            </Button>
                          </td>
                        )}
                        <td className="p-4">
                          <Badge className="bg-blue-100 text-blue-700 border-0 shadow-sm">
                            {formatDate(activity.date)}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <span className="text-slate-700">{activity.county}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-slate-500" />
                            <span className="text-slate-700">{activity.location}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Syringe className="h-4 w-4 text-slate-500" />
                            <span className="text-slate-700">{renderVaccinesInTable(activity)}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-slate-900">
                            {getActivityTotalDoses(activity).toLocaleString()}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-slate-500" />
                            <span className="font-semibold text-slate-900 mr-2">{activity.fieldofficers?.length || 0}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openFieldOfficersDialog(activity.fieldofficers || [])}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg text-xs"
                            >
                              View
                            </Button>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => openViewDialog(activity)}
                              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg transition-all shadow-sm"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {userIsChiefAdmin && !isSelecting && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => openEditDialog(activity)}
                                  className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg transition-all shadow-sm"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem 
                                      onClick={() => handleDeleteActivity(activity.id)}
                                      className="text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center p-8 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50/50 m-6">
                <div className="w-16 h-16 bg-gradient-to-r from-slate-400 to-slate-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <Search className="h-8 w-8 text-white" />
                </div>
                <h4 className="text-xl font-bold text-slate-800 mb-2">
                  No vaccination activities found
                </h4>
                <p className="text-slate-600 mb-4">
                  {searchTerm || startDate || endDate
                    ? "Try adjusting your search criteria"
                    : "Get started by recording your first vaccination activity"
                  }
                </p>
                {searchTerm || startDate || endDate ? (
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setSearchTerm("");
                      setStartDate("");
                      setEndDate("");
                    }}
                  >
                    Clear Filters
                  </Button>
                ) : userIsChiefAdmin && (
                  <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Record First Vaccination
                      </Button>
                    </DialogTrigger>
                  </Dialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View Activity Dialog - Updated for multiple vaccines */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[600px] bg-white rounded-2xl border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900 flex items-center justify-between">
              <span>Vaccination Details</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsViewDialogOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          {viewingActivity && (
            <div className="space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600">Date</Label>
                  <p className="text-slate-900 font-medium">{formatDate(viewingActivity.date)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600">Total Doses</Label>
                  <p className="text-slate-900 font-medium">
                    {getActivityTotalDoses(viewingActivity).toLocaleString()}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600">County</Label>
                  <p className="text-slate-900 font-medium">{viewingActivity.county}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600">Subcounty</Label>
                  <p className="text-slate-900 font-medium">{viewingActivity.subcounty}</p>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium text-slate-600">Location</Label>
                <p className="text-slate-900 font-medium">{viewingActivity.location}</p>
              </div>

              <div>
                <Label className="text-sm font-medium text-slate-600 mb-2">Vaccines ({getActivityVaccines(viewingActivity).length})</Label>
                <div className="space-y-2">
                  {getActivityVaccines(viewingActivity).map((vaccine, index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{vaccine.type}</p>
                        <p className="text-sm text-slate-600">{vaccine.doses} doses</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {viewingActivity.comment && (
                <div>
                  <Label className="text-sm font-medium text-slate-600">Comment</Label>
                  <p className="text-slate-900 bg-slate-50 rounded-lg p-3 mt-1">{viewingActivity.comment}</p>
                </div>
              )}

              <div>
                <Label className="text-sm font-medium text-slate-600 mb-2">Field Officers ({viewingActivity.fieldofficers?.length || 0})</Label>
                <div className="space-y-2">
                  {viewingActivity.fieldofficers?.map((officer, index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{officer.name}</p>
                        <p className="text-sm text-slate-600">{officer.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Activity Dialog - Updated for multiple vaccine selection */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Edit Vaccination Activity
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date" className="text-sm font-medium text-slate-700">Date *</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={activityForm.date}
                  onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-county" className="text-sm font-medium text-slate-700">County *</Label>
                <Input
                  id="edit-county"
                  value={activityForm.county}
                  onChange={(e) => setActivityForm({...activityForm, county: e.target.value})}
                  placeholder="Enter county"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                  required
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                <Input
                  id="edit-subcounty"
                  value={activityForm.subcounty}
                  onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})}
                  placeholder="Enter subcounty"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location" className="text-sm font-medium text-slate-700">Location *</Label>
                <Input
                  id="edit-location"
                  value={activityForm.location}
                  onChange={(e) => setActivityForm({...activityForm, location: e.target.value})}
                  placeholder="Enter specific location"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                  required
                />
              </div>
            </div>

            {/* Vaccines Section - Updated for multiple selection */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">
                  Vaccines ({selectedVaccines.length}) <span className="text-red-500">*</span>
                </Label>
                <span className="text-xs text-slate-500">Select vaccines administered</span>
              </div>
              
              {/* Vaccine Selection Grid */}
              <div className="grid grid-cols-2 gap-2">
                {VACCINE_OPTIONS.map((vaccine) => (
                  <div key={vaccine} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-vaccine-${vaccine}`}
                      checked={selectedVaccines.includes(vaccine)}
                      onCheckedChange={() => handleVaccineSelection(vaccine)}
                    />
                    <Label
                      htmlFor={`edit-vaccine-${vaccine}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {vaccine}
                    </Label>
                  </div>
                ))}
              </div>

              {/* Total Doses Input */}
              <div className="space-y-2">
                <Label htmlFor="edit-total-doses" className="text-sm font-medium text-slate-700">
                  Total Doses Administered <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-total-doses"
                  type="number"
                  min="1"
                  placeholder="Enter total number of doses"
                  value={totalDoses}
                  onChange={(e) => setTotalDoses(e.target.value)}
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                />
                {selectedVaccines.length > 0 && totalDoses && parseInt(totalDoses) > 0 && (
                  <p className="text-xs text-slate-500">
                    Doses will be distributed equally among {selectedVaccines.length} selected vaccine(s)
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-comment" className="text-sm font-medium text-slate-700">Comment</Label>
              <Textarea
                id="edit-comment"
                value={activityForm.comment}
                onChange={(e) => setActivityForm({...activityForm, comment: e.target.value})}
                placeholder="Add any comments or observations about this activity..."
                className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white min-h-[100px]"
              />
            </div>

            {/* Field Officers Section */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Field Officers ({fieldOfficers.length}) *</Label>
                <span className="text-xs text-slate-500">Add field officers with their roles</span>
              </div>
              
              {/* Add Field Officer Form */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Officer Name"
                  value={fieldOfficerForm.name}
                  onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, name: e.target.value})}
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Role/Designation"
                    value={fieldOfficerForm.role}
                    onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, role: e.target.value})}
                    className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                  />
                  <Button 
                    type="button" 
                    onClick={handleAddFieldOfficer}
                    className="bg-green-500 hover:bg-green-600 text-white rounded-xl"
                    disabled={!fieldOfficerForm.name.trim() || !fieldOfficerForm.role.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Field Officers List */}
              {fieldOfficers.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {fieldOfficers.map((officer, index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{officer.name}</p>
                        <p className="text-sm text-slate-600">{officer.role}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFieldOfficer(index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsEditDialogOpen(false);
                setFieldOfficers([]);
                setFieldOfficerForm({ name: "", role: "" });
                setSelectedVaccines([]);
                setTotalDoses("");
              }}
              className="rounded-xl border-slate-300 hover:border-slate-400 transition-all text-slate-700"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleEditActivity}
              disabled={fieldOfficers.length === 0 || selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0 || !activityForm.date || !activityForm.county}
              className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
            >
              <Edit className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Field Officers Dialog */}
      <Dialog open={isFieldOfficersDialogOpen} onOpenChange={setIsFieldOfficersDialogOpen}>
        <DialogContent className="sm:max-w-[500px] bg-white rounded-2xl border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900 flex items-center justify-between">
              <span>Field Officers</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFieldOfficersDialogOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {selectedActivityFieldOfficers.map((officer, index) => (
              <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-4">
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">{officer.name}</p>
                  <p className="text-sm text-slate-600 mt-1">{officer.role}</p>
                </div>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              </div>
            ))}
            {selectedActivityFieldOfficers.length === 0 && (
              <div className="text-center p-6 text-slate-500">
                No field officers found
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnimalHealthPage;