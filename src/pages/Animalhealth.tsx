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
  Save,
  AlertCircle
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

// --- INTERFACE FOR ISSUES ---
interface Issue {
  id: string; 
  name: string;
  raisedBy: string;
  county: string;
  subcounty: string;
  location: string;
  programme: string; // Inherited from parent activity
  description: string;
  status: 'responded' | 'not responded';
}

interface AnimalHealthActivity {
  id: string;
  date: string;
  county: string;
  subcounty: string;
  location: string;
  comment: string;
  malebeneficiaries?: number;
  femalebeneficiaries?: number;
  vaccines?: Vaccine[];
  vaccinetype?: string;
  number_doses?: number;
  fieldofficers?: FieldOfficer[];
  issues?: Issue[]; // Optional issues array
  programme: string; // Required: KPMD or RANGE
  createdAt: any;
  createdBy: string;
  status: 'completed';
}

// Vaccine options
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

const PROGRAMME_OPTIONS = ["KPMD", "RANGE"];

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
  
  // --- STATE FOR ISSUES ---
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueForm, setIssueForm] = useState<Partial<Issue>>({
    name: "",
    raisedBy: "",
    description: "",
    status: "not responded"
  });
  
  // State to toggle visibility of the Issue Input Form
  const [showIssueForm, setShowIssueForm] = useState(false);

  const [activityForm, setActivityForm] = useState({
    date: "",
    county: "",
    subcounty: "",
    location: "",
    malebeneficiaries: "",
    femalebeneficiaries: "",
    comment: "",
    programme: "RANGE", // Default Programme
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
        
        const activitiesData = Object.keys(data).map((key) => {
          const item = data[key];
          let vaccines: Vaccine[] = [];
          
          if (item.vaccines && Array.isArray(item.vaccines)) {
            vaccines = item.vaccines.map((v: any) => ({
              type: v.type || 'Unknown',
              doses: Number(v.doses) || 0
            })).filter((v: Vaccine) => v.type && v.doses > 0);
          } else if (item.vaccinetype) {
            vaccines = [{
              type: item.vaccinetype,
              doses: Number(item.number_doses) || 0
            }];
          }
          
          const fieldofficers = (item.fieldofficers && Array.isArray(item.fieldofficers)) 
            ? item.fieldofficers 
            : [];

          const issues = (item.issues && Array.isArray(item.issues))
            ? item.issues
            : [];

          return {
            id: key,
            date: item.date || '',
            county: item.county || '',
            subcounty: item.subcounty || '',
            location: item.location || '',
            comment: item.comment || '',
            malebeneficiaries: Number(item.malebeneficiaries ?? item.maleneneficiaries) || 0,
            femalebeneficiaries: Number(item.femalebeneficiaries) || 0,
            vaccines,
            fieldofficers,
            issues, 
            programme: item.programme, // Ensure programme is present
            createdAt: item.createdAt,
            createdBy: item.createdBy || 'unknown',
            status: item.status || 'completed'
          } as AnimalHealthActivity;
        });
        
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

  const getActivityVaccines = (activity: AnimalHealthActivity): Vaccine[] => {
    return activity.vaccines || [];
  };

  const getActivityTotalDoses = (activity: AnimalHealthActivity): number => {
    try {
      const vaccines = getActivityVaccines(activity);
      return vaccines.reduce((sum, vaccine) => {
        const doses = Number(vaccine.doses) || 0;
        return sum + doses;
      }, 0);
    } catch (error) {
      return 0;
    }
  };

  // --- ISSUE HANDLERS ---
  
  const handleAddIssue = () => {
    // Basic Validation for Issue fields
    if (!issueForm.name || !issueForm.raisedBy || !issueForm.description) {
      toast({ title: "Missing Info", description: "Please fill Name, Raised By, and Description for the issue.", variant: "destructive" });
      return;
    }

    // Programme is inherited from the main Activity Form
    const parentProgramme = activityForm.programme ;

    const newIssue: Issue = {
      id: Date.now().toString(),
      name: issueForm.name,
      raisedBy: issueForm.raisedBy,
      county: activityForm.county,
      subcounty: activityForm.subcounty,
      location: activityForm.location,
      programme: parentProgramme, // Inherit programme
      description: issueForm.description,
      status: issueForm.status || "not responded"
    };

    setIssues([...issues, newIssue]);
    // Reset form inputs slightly for next entry, but keep the form open
    setIssueForm({
      ...issueForm,
      name: "",
      description: "",
      status: "not responded"
    });
  };

  const handleRemoveIssue = (issueId: string) => {
    setIssues(issues.filter(i => i.id !== issueId));
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

  const handleVaccineSelection = (vaccineType: string) => {
    setSelectedVaccines(prev => {
      if (prev.includes(vaccineType)) {
        return prev.filter(v => v !== vaccineType);
      } else {
        return [...prev, vaccineType];
      }
    });
  };

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
    // Validation
    if (fieldOfficers.length === 0) {
      toast({ title: "Error", description: "Please add at least one field officer", variant: "destructive" });
      return;
    }
    if (selectedVaccines.length === 0) {
      toast({ title: "Error", description: "Please select at least one vaccine", variant: "destructive" });
      return;
    }
    if (!totalDoses || parseInt(totalDoses) <= 0) {
      toast({ title: "Error", description: "Please enter a valid total number of doses", variant: "destructive" });
      return;
    }
    if (!activityForm.date || !activityForm.county || !activityForm.programme) {
      toast({ title: "Error", description: "Please fill Date, County, and Programme", variant: "destructive" });
      return;
    }

    try {
      const vaccines = getVaccinesFromSelection();
      const activityData = {
        date: activityForm.date,
        county: activityForm.county.trim(),
        subcounty: activityForm.subcounty.trim(),
        location: activityForm.location.trim(),
        malebeneficiaries: Number(activityForm.malebeneficiaries) || 0,
        femalebeneficiaries: Number(activityForm.femalebeneficiaries) || 0,
        comment: activityForm.comment.trim(),
        programme: activityForm.programme, // Save Programme
        vaccines: vaccines,
        fieldofficers: fieldOfficers,
        issues: issues, // Issues are optional array
        status: 'completed' as const,
        createdBy: user?.email || 'unknown',
        createdAt: new Date().toISOString(),
      };

      await push(ref(db, "AnimalHealthActivities"), activityData);
      
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
        malebeneficiaries: "",
        femalebeneficiaries: "",
        comment: "",
        programme: "KPMD",
      });
      setFieldOfficers([]);
      setFieldOfficerForm({ name: "", role: "" });
      setSelectedVaccines([]);
      setTotalDoses("");
      setIssues([]); 
      setIssueForm({ name: "", raisedBy: "", description: "", status: "not responded" });
      setShowIssueForm(false); // Close issue form
      setIsAddDialogOpen(false);
      
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
        malebeneficiaries: Number(activityForm.malebeneficiaries) || 0,
        femalebeneficiaries: Number(activityForm.femalebeneficiaries) || 0,
        comment: activityForm.comment.trim(),
        programme: activityForm.programme, // Update Programme
        vaccines: vaccines,
        fieldofficers: fieldOfficers,
        issues: issues,
      };

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
        malebeneficiaries: "",
        femalebeneficiaries: "",
        comment: "",
        programme: "KPMD",
      });
      setFieldOfficers([]);
      setFieldOfficerForm({ name: "", role: "" });
      setSelectedVaccines([]);
      setTotalDoses("");
      setIssues([]); 
      setShowIssueForm(false); // Close issue form
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

  const handleDeleteActivity = async (activityId: string) => {
    try {
      await remove(ref(db, "AnimalHealthActivities/" + activityId));
      toast({ title: "Success", description: "Activity deleted." });
      fetchActivities();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
  };

  const handleDeleteMultipleActivities = async () => {
    if (selectedActivities.length === 0) return;

    try {
      const deletePromises = selectedActivities.map(activityId => 
        remove(ref(db, "AnimalHealthActivities/" + activityId))
      );
      await Promise.all(deletePromises);
      toast({ title: "Success", description: `${selectedActivities.length} activities deleted.` });
      setSelectedActivities([]);
      setIsSelecting(false);
      fetchActivities();
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
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

  const calculateVaccinationRate = () => {
    if (activities.length < 2) return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };

    try {
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
      return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };
    }
  };

  const totalDosesAdministered = useMemo(() => {
    try {
      return activities.reduce((sum, activity) => {
        return sum + getActivityTotalDoses(activity);
      }, 0);
    } catch (error) {
      return 0;
    }
  }, [activities]);

  const vaccinationRate = calculateVaccinationRate();

  const filteredActivities = useMemo(() => {
    try {
      return activities.filter(activity => {
        const activityVaccines = getActivityVaccines(activity);
        const matchesSearch = 
          (activity.comment?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (activity.location?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (activity.county?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          (activity.programme?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
          activityVaccines.some(vaccine => 
            (vaccine.type?.toLowerCase() || '').includes(searchTerm.toLowerCase())
          );
        
        const matchesIssueSearch = (activity.issues || []).some((issue: Issue) => 
          issue.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          issue.raisedBy?.toLowerCase().includes(searchTerm.toLowerCase())
        );

        try {
          const activityDate = activity.date ? new Date(activity.date) : new Date(0);
          const matchesStartDate = !startDate || activityDate >= new Date(startDate);
          const matchesEndDate = !endDate || activityDate <= new Date(endDate + 'T23:59:59');
          
          return (matchesSearch || matchesIssueSearch) && matchesStartDate && matchesEndDate;
        } catch (dateError) {
          return matchesSearch || matchesIssueSearch;
        }
      });
    } catch (error) {
      return [];
    }
  }, [activities, searchTerm, startDate, endDate]);

  const openEditDialog = (activity: AnimalHealthActivity) => {
    setEditingActivity(activity);
    setActivityForm({
      date: activity.date || '',
      county: activity.county || '',
      subcounty: activity.subcounty || '',
      location: activity.location || '',
      malebeneficiaries: (activity.malebeneficiaries || 0).toString(),
      femalebeneficiaries: (activity.femalebeneficiaries || 0).toString(),
      comment: activity.comment || '',
      programme: activity.programme || 'KPMD', // Load Programme
    });
    setFieldOfficers(activity.fieldofficers || []);
    
    const activityVaccines = getActivityVaccines(activity);
    setSelectedVaccines(activityVaccines.map(v => v.type));
    setTotalDoses(getActivityTotalDoses(activity).toString());

    setIssues(activity.issues || []);
    setShowIssueForm(false); // Ensure form is closed on edit load
    
    setIsEditDialogOpen(true);
  };

  const exportToCSV = () => {
    try {
      const headers = ['Date', 'Programme', 'County', 'Subcounty', 'Location', 'Male Beneficiaries', 'Female Beneficiaries', 'Vaccines', 'Total Doses', 'Field Officers', 'Issues Summary', 'Comment'];
      const csvData = filteredActivities.map(activity => {
        const activityVaccines = getActivityVaccines(activity);
        const vaccineText = activityVaccines.map(v => `${v.type} (${v.doses} doses)`).join('; ');
        const totalDoses = getActivityTotalDoses(activity);
        
        const issuesSummary = (activity.issues || [])
          .map(i => `${i.name} (${i.status})`)
          .join('; ');

        return [
          formatDate(activity.date),
          activity.programme,
          activity.county || '',
          activity.subcounty || '',
          activity.location || '',
          String(activity.malebeneficiaries || 0),
          String(activity.femalebeneficiaries || 0),
          vaccineText,
          totalDoses.toString(),
          (activity.fieldofficers || []).map(officer => `${officer.name} (${officer.role})`).join('; ') || '',
          issuesSummary || '',
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
      toast({ title: "Success", description: "Data exported successfully" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to export data", variant: "destructive" });
    }
  };

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
      return 'Invalid date';
    }
  };

  // Updated validation to include Programme
  const isSaveDisabled = fieldOfficers.length === 0 || selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0 || !activityForm.date || !activityForm.county || !activityForm.programme;

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
            <DialogContent className="sm:max-w-[900px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
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
                    <Label htmlFor="programme" className="text-sm font-medium text-slate-700">
                      Programme <span className="text-red-500">*</span>
                    </Label>
                    <Select 
                      value={activityForm.programme} 
                      onValueChange={(v) => setActivityForm({...activityForm, programme: v})}
                    >
                      <SelectTrigger className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white">
                        <SelectValue placeholder="Select Programme" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROGRAMME_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="county" className="text-sm font-medium text-slate-700">
                      County <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="county"
                      value={activityForm.county}
                      onChange={(e) => {
                        setActivityForm({...activityForm, county: e.target.value});
                      }}
                      placeholder="Enter county"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                    <Input
                      id="subcounty"
                      value={activityForm.subcounty}
                      onChange={(e) => {
                        setActivityForm({...activityForm, subcounty: e.target.value});
                      }}
                      placeholder="Enter subcounty"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="location" className="text-sm font-medium text-slate-700">
                    Location <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="location"
                    value={activityForm.location}
                    onChange={(e) => {
                      setActivityForm({...activityForm, location: e.target.value});
                    }}
                    placeholder="Enter specific location"
                    className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="male-beneficiaries" className="text-sm font-medium text-slate-700">Male Beneficiaries</Label>
                    <Input
                      id="male-beneficiaries"
                      type="number"
                      min="0"
                      value={activityForm.malebeneficiaries}
                      onChange={(e) => setActivityForm({ ...activityForm, malebeneficiaries: e.target.value })}
                      placeholder="Enter male beneficiaries"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="female-beneficiaries" className="text-sm font-medium text-slate-700">Female Beneficiaries</Label>
                    <Input
                      id="female-beneficiaries"
                      type="number"
                      min="0"
                      value={activityForm.femalebeneficiaries}
                      onChange={(e) => setActivityForm({ ...activityForm, femalebeneficiaries: e.target.value })}
                      placeholder="Enter female beneficiaries"
                      className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                    />
                  </div>
                </div>

                {/* Vaccines Section */}
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">
                      Vaccines ({selectedVaccines.length}) <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-xs text-slate-500">Select vaccines administered</span>
                  </div>
                  
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

                {/* --- OPTIONAL ISSUES SECTION --- */}
                <div className="space-y-4 border-t pt-4 bg-slate-50/50 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                      Issues Raised (Optional) ({issues.length})
                    </Label>
                  </div>

                  {issues.length > 0 && (
                    <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                      {issues.map((issue) => (
                        <div key={issue.id} className="bg-white border border-slate-200 p-3 rounded-lg relative">
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-semibold text-slate-800">{issue.name}</div>
                            <Button variant="ghost" size="sm" onClick={() => handleRemoveIssue(issue.id)} className="h-6 w-6 p-0 text-red-500 hover:bg-red-50">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="text-xs text-slate-600 mb-1">Raised By: <b>{issue.raisedBy}</b> • <Badge variant="outline" className="text-[10px] px-1 h-4">{issue.programme}</Badge></div>
                          <div className="mt-2 text-sm text-slate-700 bg-slate-50 p-2 rounded">
                            {issue.description}
                          </div>
                          <div className="mt-2">
                            <Badge variant={issue.status === 'responded' ? 'default' : 'secondary'} className={issue.status === 'responded' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                              {issue.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Toggle Button to Show Issue Form */}
                  {!showIssueForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-dashed border-slate-300 hover:border-orange-400 hover:text-orange-600 text-slate-500"
                      onClick={() => setShowIssueForm(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" /> Record an Issue
                    </Button>
                  ) : (
                    /* Add New Issue Form */
                    <div className="bg-white p-4 rounded-lg border border-slate-200">
                      <p className="text-xs text-slate-500 mb-3 italic">
                        This issue will be saved under the programme: <b>{activityForm.programme}</b>
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Issue Name</Label>
                          <Input placeholder="e.g. Equipment Failure" value={issueForm.name} onChange={e => setIssueForm({...issueForm, name: e.target.value})} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Raised By</Label>
                          <Input placeholder="Officer Name" value={issueForm.raisedBy} onChange={e => setIssueForm({...issueForm, raisedBy: e.target.value})} className="h-8 text-sm" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs">Status</Label>
                          <Select value={issueForm.status} onValueChange={(v) => setIssueForm({...issueForm, status: v as 'responded' | 'not responded'})}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="responded">Responded</SelectItem>
                              <SelectItem value="not responded">Not Responded</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1 mb-3">
                        <Label className="text-xs">Description</Label>
                        <Textarea placeholder="Describe issue..." value={issueForm.description} onChange={e => setIssueForm({...issueForm, description: e.target.value})} className="min-h-[60px] text-sm" />
                      </div>
                      <div className="flex justify-between">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowIssueForm(false)} className="text-slate-500 hover:text-slate-700">
                          Cancel
                        </Button>
                        <Button type="button" onClick={handleAddIssue} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white h-8 px-4 text-xs font-semibold">
                          Add Issue
                        </Button>
                      </div>
                    </div>
                  )}
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
                    // Reset all states
                    setActivityForm({ date: "", county: "", subcounty: "", location: "", malebeneficiaries: "", femalebeneficiaries: "", comment: "", programme: "KPMD" });
                    setFieldOfficers([]);
                    setFieldOfficerForm({ name: "", role: "" });
                    setSelectedVaccines([]);
                    setTotalDoses("");
                    setIssues([]);
                    setIssueForm({ name: "", raisedBy: "", description: "", status: "not responded" });
                    setShowIssueForm(false);
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

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                     `Increase from previous record` : 
                     vaccinationRate.trend === 'down' ? 
                     `Decrease from previous record` : 
                     activities.length >= 2 ? `No change from previous record` :
                     'Not enough data'}
                  </p>
                </div>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  vaccinationRate.trend === 'up' ? 'bg-green-100' : 
                  vaccinationRate.trend === 'down' ? 'bg-red-100' : 
                  'bg-blue-100'
                }`}>
                  {vaccinationRate.trend === 'up' ? <TrendingUp className="h-6 w-6 text-green-600" /> : 
                   vaccinationRate.trend === 'down' ? <TrendingDown className="h-6 w-6 text-red-600" /> : 
                   <Activity className="h-6 w-6 text-blue-600" />}
                </div>
              </div>
            </CardContent>
          </Card>

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
                  {isSelecting ? <X className="h-4 w-4 mr-2" /> : <CheckSquare className="h-4 w-4 mr-2" />}
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

        {/* Activities Table */}
        <Card className="bg-white/95 backdrop-blur-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-4 p-6">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : filteredActivities.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200">
                      {isSelecting && (
                        <th className="p-4 text-left">
                          <Button variant="ghost" size="sm" onClick={selectAllActivities} className="h-8 w-8 p-0">
                            {selectedActivities.length === filteredActivities.length ? <CheckSquare className="h-4 w-4 text-green-600" /> : <Square className="h-4 w-4 text-slate-400" />}
                          </Button>
                        </th>
                      )}
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Date</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Programme</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">County</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Location</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Male Ben.</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Female Ben.</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Vaccines</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Total Doses</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Issues</th> 
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActivities.map((activity) => (
                      <tr key={activity.id} className="hover:bg-slate-50/50 transition-colors duration-200 group">
                        {isSelecting && (
                          <td className="p-4">
                            <Button variant="ghost" size="sm" onClick={() => toggleActivitySelection(activity.id)} className="h-8 w-8 p-0">
                              {selectedActivities.includes(activity.id) ? <CheckSquare className="h-4 w-4 text-green-600" /> : <Square className="h-4 w-4 text-slate-400" />}
                            </Button>
                          </td>
                        )}
                        <td className="p-4">
                          <Badge className="bg-blue-100 text-blue-700 border-0 shadow-sm">
                            {formatDate(activity.date)}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                            {activity.programme}
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
                          <span className="font-semibold text-slate-900">
                            {(activity.malebeneficiaries || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-slate-900">
                            {(activity.femalebeneficiaries || 0).toLocaleString()}
                          </span>
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
                          {(activity.issues && activity.issues.length > 0) ? (
                            <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-200 cursor-pointer" onClick={() => openViewDialog(activity)}>
                              {activity.issues.length} Issue(s)
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => openViewDialog(activity)} className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-lg transition-all shadow-sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                            {userIsChiefAdmin && !isSelecting && (
                              <>
                                <Button size="sm" onClick={() => openEditDialog(activity)} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg transition-all shadow-sm">
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleDeleteActivity(activity.id)} className="text-red-600">
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete
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
                <h4 className="text-xl font-bold text-slate-800 mb-2">No vaccination activities found</h4>
                <p className="text-slate-600 mb-4">{searchTerm || startDate || endDate ? "Try adjusting your search criteria" : "Get started by recording your first vaccination activity"}</p>
                {searchTerm || startDate || endDate ? (
                  <Button variant="outline" onClick={() => { setSearchTerm(""); setStartDate(""); setEndDate(""); }}>Clear Filters</Button>
                ) : userIsChiefAdmin && (
                  <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white">
                        <Plus className="h-4 w-4 mr-2" /> Record First Vaccination
                      </Button>
                    </DialogTrigger>
                  </Dialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View Activity Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900 flex items-center justify-between">
              <span>Vaccination Details</span>
              <Button variant="ghost" size="icon" onClick={() => setIsViewDialogOpen(false)} className="h-8 w-8 rounded-lg hover:bg-slate-100 transition-colors text-slate-600">
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          {viewingActivity && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600">Date</Label>
                  <p className="text-slate-900 font-medium">{formatDate(viewingActivity.date)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600">Programme</Label>
                  <p className="text-slate-900 font-medium">{viewingActivity.programme}</p>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600">Male Beneficiaries</Label>
                  <p className="text-slate-900 font-medium">{(viewingActivity.malebeneficiaries || 0).toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600">Female Beneficiaries</Label>
                  <p className="text-slate-900 font-medium">{(viewingActivity.femalebeneficiaries || 0).toLocaleString()}</p>
                </div>
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

              {(viewingActivity.issues && viewingActivity.issues.length > 0) && (
                <div className="border-t pt-4">
                  <Label className="text-sm font-bold text-orange-700 mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Issues Raised ({viewingActivity.issues.length})
                  </Label>
                  <div className="space-y-3">
                    {viewingActivity.issues.map((issue, index) => (
                      <div key={index} className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-bold text-slate-900 text-lg">{issue.name}</div>
                          <Badge variant={issue.status === 'responded' ? 'default' : 'secondary'} className={issue.status === 'responded' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {issue.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-slate-600 mb-2">Raised By: <b className="text-slate-800">{issue.raisedBy}</b> • Programme: <Badge variant="outline" className="ml-1">{issue.programme}</Badge></div>
                        <div className="text-sm text-slate-700 mb-2">{issue.county}, {issue.subcounty}, {issue.location}</div>
                        <div className="text-slate-900 bg-white p-2 rounded">{issue.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

      {/* Edit Activity Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[900px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900">Edit Vaccination Activity</DialogTitle>
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
                <Label htmlFor="edit-programme" className="text-sm font-medium text-slate-700">Programme *</Label>
                <Select 
                  value={activityForm.programme} 
                  onValueChange={(v) => setActivityForm({...activityForm, programme: v})}
                >
                  <SelectTrigger className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white">
                    <SelectValue placeholder="Select Programme" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROGRAMME_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-county" className="text-sm font-medium text-slate-700">County *</Label>
                <Input
                  id="edit-county"
                  value={activityForm.county}
                  onChange={(e) => {
                    setActivityForm({...activityForm, county: e.target.value});
                  }}
                  placeholder="Enter county"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                <Input
                  id="edit-subcounty"
                  value={activityForm.subcounty}
                  onChange={(e) => {
                    setActivityForm({...activityForm, subcounty: e.target.value});
                  }}
                  placeholder="Enter subcounty"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-location" className="text-sm font-medium text-slate-700">Location *</Label>
              <Input
                id="edit-location"
                value={activityForm.location}
                onChange={(e) => {
                  setActivityForm({...activityForm, location: e.target.value});
                }}
                placeholder="Enter specific location"
                className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-male-beneficiaries" className="text-sm font-medium text-slate-700">Male Beneficiaries</Label>
                <Input
                  id="edit-male-beneficiaries"
                  type="number"
                  min="0"
                  value={activityForm.malebeneficiaries}
                  onChange={(e) => setActivityForm({ ...activityForm, malebeneficiaries: e.target.value })}
                  placeholder="Enter male beneficiaries"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-female-beneficiaries" className="text-sm font-medium text-slate-700">Female Beneficiaries</Label>
                <Input
                  id="edit-female-beneficiaries"
                  type="number"
                  min="0"
                  value={activityForm.femalebeneficiaries}
                  onChange={(e) => setActivityForm({ ...activityForm, femalebeneficiaries: e.target.value })}
                  placeholder="Enter female beneficiaries"
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white"
                />
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Vaccines ({selectedVaccines.length}) <span className="text-red-500">*</span></Label>
                <span className="text-xs text-slate-500">Select vaccines administered</span>
              </div>              
              <div className="grid grid-cols-2 gap-2">
                {VACCINE_OPTIONS.map((vaccine) => (
                  <div key={vaccine} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-vaccine-${vaccine}`}
                      checked={selectedVaccines.includes(vaccine)}
                      onCheckedChange={() => handleVaccineSelection(vaccine)}
                    />
                    <Label htmlFor={`edit-vaccine-${vaccine}`} className="text-sm font-normal cursor-pointer">
                      {vaccine}
                    </Label>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-total-doses" className="text-sm font-medium text-slate-700">Total Doses Administered <span className="text-red-500">*</span></Label>
                <Input
                  id="edit-total-doses"
                  type="number"
                  min="1"
                  placeholder="Enter total number of doses"
                  value={totalDoses}
                  onChange={(e) => setTotalDoses(e.target.value)}
                  className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500"
                />
              </div>
            </div>

            {/* EDIT ISSUES SECTION */}
            <div className="space-y-4 border-t pt-4 bg-slate-50/50 p-4 rounded-xl">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  Issues Raised (Optional) ({issues.length})
                </Label>
              </div>

              {issues.length > 0 && (
                <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                  {issues.map((issue) => (
                    <div key={issue.id} className="bg-white border border-slate-200 p-3 rounded-lg relative">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-semibold text-slate-800">{issue.name}</div>
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveIssue(issue.id)} className="h-6 w-6 p-0 text-red-500 hover:bg-red-50">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="text-xs text-slate-600 mb-1">Raised By: <b>{issue.raisedBy}</b> • <Badge variant="outline" className="text-[10px] px-1 h-4">{issue.programme}</Badge></div>
                      <div className="mt-2 text-sm text-slate-700 bg-slate-50 p-2 rounded">{issue.description}</div>
                      <div className="mt-2">
                        <Badge variant={issue.status === 'responded' ? 'default' : 'secondary'} className={issue.status === 'responded' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {issue.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!showIssueForm ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed border-slate-300 hover:border-orange-400 hover:text-orange-600 text-slate-500"
                  onClick={() => setShowIssueForm(true)}
                >
                  <Plus className="h-4 w-4 mr-2" /> Record an Issue
                </Button>
              ) : (
                <div className="bg-white p-4 rounded-lg border border-slate-200">
                  <p className="text-xs text-slate-500 mb-3 italic">
                    This issue will be saved under the programme: <b>{activityForm.programme}</b>
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Issue Name</Label>
                      <Input placeholder="e.g. Equipment Failure" value={issueForm.name} onChange={e => setIssueForm({...issueForm, name: e.target.value})} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Raised By</Label>
                      <Input placeholder="Officer Name" value={issueForm.raisedBy} onChange={e => setIssueForm({...issueForm, raisedBy: e.target.value})} className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Status</Label>
                      <Select value={issueForm.status} onValueChange={(v) => setIssueForm({...issueForm, status: v as 'responded' | 'not responded'})}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="responded">Responded</SelectItem>
                          <SelectItem value="not responded">Not Responded</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1 mb-3">
                    <Label className="text-xs">Description</Label>
                    <Textarea placeholder="Describe issue..." value={issueForm.description} onChange={e => setIssueForm({...issueForm, description: e.target.value})} className="min-h-[60px] text-sm" />
                  </div>
                  <div className="flex justify-between">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowIssueForm(false)} className="text-slate-500 hover:text-slate-700">
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleAddIssue} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white h-8 px-4 text-xs font-semibold">
                      Add Issue
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-comment" className="text-sm font-medium text-slate-700">Comment</Label>
              <Textarea
                id="edit-comment"
                value={activityForm.comment}
                onChange={(e) => setActivityForm({...activityForm, comment: e.target.value})}
                placeholder="Add any comments or observations..."
                className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500 transition-all bg-white min-h-[100px]"
              />
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Field Officers ({fieldOfficers.length}) *</Label>
                <span className="text-xs text-slate-500">Add field officers with their roles</span>
              </div>              
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Officer Name" value={fieldOfficerForm.name} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, name: e.target.value})} className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500" />
                <div className="flex gap-2">
                  <Input placeholder="Role/Designation" value={fieldOfficerForm.role} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, role: e.target.value})} className="rounded-xl border-slate-300 focus:border-green-500 focus:ring-green-500" />
                  <Button type="button" onClick={handleAddFieldOfficer} className="bg-green-500 hover:bg-green-600 text-white rounded-xl" disabled={!fieldOfficerForm.name.trim() || !fieldOfficerForm.role.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {fieldOfficers.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {fieldOfficers.map((officer, index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{officer.name}</p>
                        <p className="text-sm text-slate-600">{officer.role}</p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeFieldOfficer(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg">
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
                setIssues([]);
                setIssueForm({ name: "", raisedBy: "", description: "", status: "not responded" });
                setShowIssueForm(false);
                setActivityForm({ date: "", county: "", subcounty: "", location: "", malebeneficiaries: "", femalebeneficiaries: "", comment: "", programme: "KPMD" });
              }}
              className="rounded-xl border-slate-300 hover:border-slate-400 transition-all text-slate-700"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleEditActivity}
              disabled={fieldOfficers.length === 0 || selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0 || !activityForm.date || !activityForm.county || !activityForm.programme}
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
              <Button variant="ghost" size="icon" onClick={() => setIsFieldOfficersDialogOpen(false)} className="h-8 w-8 rounded-lg hover:bg-slate-100 transition-colors text-slate-600">
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
              <div className="text-center p-6 text-slate-500">No field officers found</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnimalHealthPage;
