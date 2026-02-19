import { useState, useEffect, useMemo, useRef } from "react";
// REALTIME DATABASE IMPORTS
import { ref, get, push, remove, update } from "firebase/database";
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
  Syringe,
  Activity,
  TrendingUp,
  TrendingDown,
  Download,
  CheckSquare,
  Square,
  Save,
  User,
  Upload
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import * as XLSX from 'xlsx'; 
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

interface FieldOfficer {
  name: string;
  role: string;
}

interface Vaccine {
  type: string;
  doses: number;
}

interface Beneficiary {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  nationalId: string;
  goats: number;
  sheep: number;
}

interface Issue {
  id: string; 
  name: string;
  raisedBy: string;
  county: string;
  subcounty: string;
  location: string;
  programme: string;
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
  issues?: Issue[];
  beneficiaries?: Beneficiary[];
  programme: string;
  createdAt: any;
  createdBy: string;
  status: 'completed';
}

const ANIMAL_HEALTH_CACHE_KEY = cacheKey("admin-page", "animal-health", "activities");

const VACCINE_OPTIONS = [
  "PPR", "CCPP", "Sheep and Goat Pox", "Enterotoxemia", "Anthrax",
  "Rift Valley Fever", "Brucellosis", "Foot and Mouth Disease"
];

const PROGRAMME_OPTIONS = ["KPMD", "RANGE"];
const FARMERS_PER_PAGE = 20;

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
  const [viewFarmersPage, setViewFarmersPage] = useState(1);
  
  const [fieldOfficerForm, setFieldOfficerForm] = useState({ name: "", role: "" });
  const [fieldOfficers, setFieldOfficers] = useState<FieldOfficer[]>([]);
  
  const [selectedVaccines, setSelectedVaccines] = useState<string[]>([]);
  const [totalDoses, setTotalDoses] = useState<string>("");
  
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [beneficiaryForm, setBeneficiaryForm] = useState({
    name: "",
    gender: "Male" as 'Male' | 'Female',
    nationalId: "",
    goats: "",
    sheep: ""
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueForm, setIssueForm] = useState<Partial<Issue>>({
    name: "", raisedBy: "", description: "", status: "not responded"
  });
  
  const [showIssueForm, setShowIssueForm] = useState(false);

  const [activityForm, setActivityForm] = useState({
    date: "", county: "", subcounty: "", location: "",
    malebeneficiaries: "", femalebeneficiaries: "", comment: "", programme: "RANGE",
  });
  
  const { userRole } = useAuth();
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const requireChiefAdmin = () => {
    if (userIsChiefAdmin) return true;
    toast({
      title: "Access denied",
      description: "Only chief admin can create, edit, or delete records on this page.",
      variant: "destructive",
    });
    return false;
  };

  useEffect(() => {
    const maleCount = beneficiaries.filter(b => b.gender === 'Male').length;
    const femaleCount = beneficiaries.filter(b => b.gender === 'Female').length;
    setActivityForm(prev => ({
      ...prev,
      malebeneficiaries: maleCount.toString(),
      femalebeneficiaries: femaleCount.toString()
    }));
  }, [beneficiaries]);

  useEffect(() => { fetchActivities(); }, []);

  const fetchActivities = async () => {
    try {
      const cachedActivities = readCachedValue<AnimalHealthActivity[]>(ANIMAL_HEALTH_CACHE_KEY);
      if (cachedActivities) {
        setActivities(cachedActivities);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const activitiesRef = ref(db, "AnimalHealthActivities");
      const snapshot = await get(activitiesRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        const activitiesData = Object.keys(data).map((key) => {
          const item = data[key];
          let vaccines: Vaccine[] = [];
          const rawBeneficiaries = Array.isArray(item.beneficiaries) ? item.beneficiaries : [];
          const rawFarmers = Array.isArray(item.farmers) ? item.farmers : [];
          const normalizeFarmers = (records: any[]): Beneficiary[] => records.map((farmer: any, index: number) => {
            const genderRaw = String(farmer?.gender || "").toLowerCase();
            const normalizedGender: "Male" | "Female" = genderRaw.startsWith("f") ? "Female" : "Male";
            return {
              id: String(farmer?.id || `${key}-farmer-${index}`),
              name: String(farmer?.name || farmer?.farmerName || "N/A"),
              gender: normalizedGender,
              nationalId: String(farmer?.nationalId || farmer?.idNo || farmer?.idNumber || farmer?.ID || "N/A"),
              goats: Number(farmer?.goats) || 0,
              sheep: Number(farmer?.sheep) || 0,
            };
          });
          const normalizedBeneficiaries = normalizeFarmers(rawBeneficiaries);
          const normalizedFarmers = normalizeFarmers(rawFarmers);
          const beneficiariesForView = normalizedBeneficiaries.length > 0 ? normalizedBeneficiaries : normalizedFarmers;
          
          if (item.vaccines && Array.isArray(item.vaccines)) {
            vaccines = item.vaccines.map((v: any) => ({
              type: v.type || 'Unknown', doses: Number(v.doses) || 0
            })).filter((v: Vaccine) => v.type && v.doses > 0);
          } else if (item.vaccinetype) {
            vaccines = [{ type: item.vaccinetype, doses: Number(item.number_doses) || 0 }];
          }
          
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
            fieldofficers: (item.fieldofficers && Array.isArray(item.fieldofficers)) ? item.fieldofficers : [],
            issues: (item.issues && Array.isArray(item.issues)) ? item.issues : [],
            beneficiaries: beneficiariesForView,
            programme: item.programme || 'N/A',
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
        writeCachedValue(ANIMAL_HEALTH_CACHE_KEY, activitiesData);
      } else {
        setActivities([]);
        removeCachedValue(ANIMAL_HEALTH_CACHE_KEY);
      }
    } catch (error) {
      console.error("Error fetching:", error);
      toast({ title: "Error", description: "Failed to load activities", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getActivityVaccines = (activity: AnimalHealthActivity): Vaccine[] => activity.vaccines || [];
  const getActivityTotalDoses = (activity: AnimalHealthActivity): number => 
    (activity.vaccines || []).reduce((sum, v) => sum + (Number(v.doses) || 0), 0);

  const handleAddBeneficiary = () => {
    if (!beneficiaryForm.name || !beneficiaryForm.nationalId) {
      toast({ title: "Missing Info", description: "Please provide Name and National ID.", variant: "destructive" });
      return;
    }
    const newBeneficiary: Beneficiary = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      name: beneficiaryForm.name,
      gender: beneficiaryForm.gender,
      nationalId: beneficiaryForm.nationalId,
      goats: parseInt(beneficiaryForm.goats) || 0,
      sheep: parseInt(beneficiaryForm.sheep) || 0,
    };
    setBeneficiaries([...beneficiaries, newBeneficiary]);
    setBeneficiaryForm({ name: "", gender: "Male", nationalId: "", goats: "", sheep: "" });
  };

  const handleRemoveBeneficiary = (id: string) => setBeneficiaries(beneficiaries.filter(b => b.id !== id));

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          toast({ title: "Empty File", description: "No data found in the file.", variant: "destructive" });
          return;
        }

        const mappedData: Beneficiary[] = data.map((row: any, index: number) => {
          const getVal = (keys: string[]) => {
            for (const key of keys) {
              const found = Object.keys(row).find(k => k.toLowerCase().trim() === key.toLowerCase().trim());
              if (found) return row[found];
            }
            return undefined;
          };

          const genderRaw = getVal(['gender', 'sex']);
          let gender: 'Male' | 'Female' = 'Male';
          if (genderRaw) {
             const gStr = String(genderRaw).toLowerCase();
             if (gStr.startsWith('f') || gStr === 'female') gender = 'Female';
          }

          return {
            id: `upload-${Date.now()}-${index}`,
            name: String(getVal(['name', 'full name', 'farmer name', 'beneficiary']) || 'Unknown'),
            gender: gender,
            nationalId: String(getVal(['nationalid', 'national id', 'id', 'id number', 'idno']) || 'N/A'),
            goats: Number(getVal(['goats', 'goat', 'no of goats'])) || 0,
            sheep: Number(getVal(['sheep', 'sheeps', 'no of sheep'])) || 0,
          };
        });

        setBeneficiaries(prev => [...prev, ...mappedData]);
        toast({ title: "Success", description: `${mappedData.length} farmers imported successfully.` });
        
      } catch (error) {
        console.error("Parse error:", error);
        toast({ title: "Error", description: "Failed to parse file. Ensure it is a valid CSV or Excel file.", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
    if (e.target) e.target.value = '';
  };

  const handleAddIssue = () => {
    if (!issueForm.name || !issueForm.raisedBy || !issueForm.description) {
      toast({ title: "Missing Info", description: "Please fill Name, Raised By, and Description.", variant: "destructive" });
      return;
    }
    const newIssue: Issue = {
      id: Date.now().toString(), name: issueForm.name, raisedBy: issueForm.raisedBy,
      county: activityForm.county, subcounty: activityForm.subcounty, location: activityForm.location,
      programme: activityForm.programme, description: issueForm.description,
      status: issueForm.status || "not responded"
    };
    setIssues([...issues, newIssue]);
    setIssueForm({ ...issueForm, name: "", description: "", status: "not responded" });
  };

  const handleRemoveIssue = (issueId: string) => setIssues(issues.filter(i => i.id !== issueId));
  
  const handleAddFieldOfficer = () => {
    if (fieldOfficerForm.name.trim() && fieldOfficerForm.role.trim()) {
      setFieldOfficers([...fieldOfficers, { name: fieldOfficerForm.name.trim(), role: fieldOfficerForm.role.trim() }]);
      setFieldOfficerForm({ name: "", role: "" });
    }
  };
  const removeFieldOfficer = (index: number) => setFieldOfficers(fieldOfficers.filter((_, i) => i !== index));

  const handleVaccineSelection = (vaccineType: string) => {
    setSelectedVaccines(prev => 
      prev.includes(vaccineType) ? prev.filter(v => v !== vaccineType) : [...prev, vaccineType]
    );
  };

  const getVaccinesFromSelection = (): Vaccine[] => {
    if (selectedVaccines.length === 0 || !totalDoses || parseInt(totalDoses) <= 0) return [];
    const dosesPerVaccine = Math.floor(parseInt(totalDoses) / selectedVaccines.length);
    const remainder = parseInt(totalDoses) % selectedVaccines.length;
    return selectedVaccines.map((type, index) => ({
      type, doses: index === 0 ? dosesPerVaccine + remainder : dosesPerVaccine
    }));
  };

  const resetForms = () => {
    setActivityForm({ date: "", county: "", subcounty: "", location: "", malebeneficiaries: "", femalebeneficiaries: "", comment: "", programme: "RANGE" });
    setFieldOfficers([]); setFieldOfficerForm({ name: "", role: "" });
    setSelectedVaccines([]); setTotalDoses("");
    setIssues([]); setBeneficiaries([]);
    setBeneficiaryForm({ name: "", gender: "Male", nationalId: "", goats: "", sheep: "" });
    setIssueForm({ name: "", raisedBy: "", description: "", status: "not responded" });
    setShowIssueForm(false);
  };

  const handleAddActivity = async () => {
    if (!requireChiefAdmin()) return;
    if (fieldOfficers.length === 0) { toast({ title: "Error", description: "Add at least one field officer", variant: "destructive" }); return; }
    if (selectedVaccines.length === 0) { toast({ title: "Error", description: "Select at least one vaccine", variant: "destructive" }); return; }
    if (!totalDoses || parseInt(totalDoses) <= 0) { toast({ title: "Error", description: "Enter valid total doses", variant: "destructive" }); return; }
    if (!activityForm.date || !activityForm.county || !activityForm.location || !activityForm.programme) {
      toast({ title: "Error", description: "Fill Date, County, Location, and Programme", variant: "destructive" });
      return;
    }

    try {
      const vaccines = getVaccinesFromSelection();
      const activityData = {
        ...activityForm, 
        county: activityForm.county.trim(), subcounty: activityForm.subcounty.trim(), location: activityForm.location.trim(),
        malebeneficiaries: Number(activityForm.malebeneficiaries) || 0, femalebeneficiaries: Number(activityForm.femalebeneficiaries) || 0,
        comment: activityForm.comment.trim(), vaccines, fieldofficers: fieldOfficers, issues, beneficiaries,
        status: 'completed' as const, createdBy: user?.email || 'unknown', createdAt: new Date().toISOString(),
      };
      await push(ref(db, "AnimalHealthActivities"), activityData);
      toast({ title: "Success", description: "Activity recorded.", className: "bg-green-50 text-green-800" });
      setIsAddDialogOpen(false);
      resetForms();
      removeCachedValue(ANIMAL_HEALTH_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to record activity.", variant: "destructive" });
    }
  };

  const handleEditActivity = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingActivity) return;
    try {
      const vaccines = getVaccinesFromSelection();
      const activityData = {
        ...activityForm, 
        county: activityForm.county.trim(), subcounty: activityForm.subcounty.trim(), location: activityForm.location.trim(),
        malebeneficiaries: Number(activityForm.malebeneficiaries) || 0, femalebeneficiaries: Number(activityForm.femalebeneficiaries) || 0,
        comment: activityForm.comment.trim(), vaccines, fieldofficers: fieldOfficers, issues, beneficiaries,
      };
      await update(ref(db, "AnimalHealthActivities/" + editingActivity.id), activityData);
      toast({ title: "Success", description: "Activity updated.", className: "bg-green-50 text-green-800" });
      setIsEditDialogOpen(false);
      resetForms();
      removeCachedValue(ANIMAL_HEALTH_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    if (!requireChiefAdmin()) return;
    try { await remove(ref(db, "AnimalHealthActivities/" + activityId)); toast({ title: "Success", description: "Deleted." }); removeCachedValue(ANIMAL_HEALTH_CACHE_KEY); fetchActivities(); } 
    catch (error) { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
  };

  const handleDeleteMultipleActivities = async () => {
    if (!requireChiefAdmin()) return;
    if (selectedActivities.length === 0) return;
    try {
      await Promise.all(selectedActivities.map(id => remove(ref(db, "AnimalHealthActivities/" + id))));
      toast({ title: "Success", description: `${selectedActivities.length} deleted.` });
      removeCachedValue(ANIMAL_HEALTH_CACHE_KEY);
      setSelectedActivities([]); setIsSelecting(false); fetchActivities();
    } catch (error) { toast({ title: "Error", description: "Failed.", variant: "destructive" }); }
  };

  const toggleActivitySelection = (activityId: string) => {
    setSelectedActivities(prev => prev.includes(activityId) ? prev.filter(id => id !== activityId) : [...prev, activityId]);
  };
  const selectAllActivities = () => {
    setSelectedActivities(selectedActivities.length === filteredActivities.length ? [] : filteredActivities.map(a => a.id));
  };
  const openViewDialog = (activity: AnimalHealthActivity) => {
    setViewingActivity(activity);
    setViewFarmersPage(1);
    setIsViewDialogOpen(true);
  };
  const openFieldOfficersDialog = (fo: FieldOfficer[] = []) => { setSelectedActivityFieldOfficers(fo); setIsFieldOfficersDialogOpen(true); };

  // --- CALCULATIONS FOR STATS ---
  const totalDosesAdministered = useMemo(() => activities.reduce((s, a) => s + getActivityTotalDoses(a), 0), [activities]);
  
  // Beneficiary Calculations
  const totalMaleBeneficiaries = useMemo(
    () => activities.reduce((sum, a) => sum + (a.malebeneficiaries || 0), 0),
    [activities]
  );
  const totalFemaleBeneficiaries = useMemo(
    () => activities.reduce((sum, a) => sum + (a.femalebeneficiaries || 0), 0),
    [activities]
  );
  const totalBeneficiaries = useMemo(
    () => totalMaleBeneficiaries + totalFemaleBeneficiaries,
    [totalMaleBeneficiaries, totalFemaleBeneficiaries]
  );

  const calculateVaccinationRate = () => {
    if (activities.length < 2) return { rate: 0, trend: 'neutral', currentDoses: 0, previousDoses: 0 };
    const sorted = [...activities].sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
    const curr = sorted[0], prev = sorted[1];
    const currD = getActivityTotalDoses(curr), prevD = getActivityTotalDoses(prev);
    if (prevD === 0) return { rate: currD > 0 ? 100 : 0, trend: currD > 0 ? 'up' : 'neutral', currentDoses: currD, previousDoses: prevD };
    const rate = Math.round(((currD - prevD) / prevD) * 100);
    return { rate, trend: rate > 0 ? 'up' : rate < 0 ? 'down' : 'neutral', currentDoses: currD, previousDoses: prevD };
  };
  
  const vaccinationRate = calculateVaccinationRate();

  const filteredActivities = useMemo(() => activities.filter(activity => {
    const vacs = getActivityVaccines(activity);
    const s = searchTerm.toLowerCase();
    const matchSearch = (activity.comment?.toLowerCase() || '').includes(s) || (activity.location?.toLowerCase() || '').includes(s) || (activity.county?.toLowerCase() || '').includes(s) || (activity.programme?.toLowerCase() || '').includes(s) || vacs.some(v => (v.type?.toLowerCase() || '').includes(s));
    const matchIssue = (activity.issues || []).some(i => i.name?.toLowerCase().includes(s) || i.raisedBy?.toLowerCase().includes(s));
    const aDate = activity.date ? new Date(activity.date) : new Date(0);
    const matchStart = !startDate || aDate >= new Date(startDate);
    const matchEnd = !endDate || aDate <= new Date(endDate + 'T23:59:59');
    return (matchSearch || matchIssue) && matchStart && matchEnd;
  }), [activities, searchTerm, startDate, endDate]);

  const openEditDialog = (activity: AnimalHealthActivity) => {
    if (!userIsChiefAdmin) return;
    setEditingActivity(activity);
    setActivityForm({
      date: activity.date || '', county: activity.county || '', subcounty: activity.subcounty || '', location: activity.location || '',
      malebeneficiaries: (activity.malebeneficiaries || 0).toString(), femalebeneficiaries: (activity.femalebeneficiaries || 0).toString(),
      comment: activity.comment || '', programme: activity.programme || 'RANGE',
    });
    setFieldOfficers(activity.fieldofficers || []);
    const aVacs = getActivityVaccines(activity);
    setSelectedVaccines(aVacs.map(v => v.type));
    setTotalDoses(getActivityTotalDoses(activity).toString());
    setIssues(activity.issues || []);
    setBeneficiaries(activity.beneficiaries || []);
    setShowIssueForm(false);
    setIsEditDialogOpen(true);
  };

  const exportToCSV = () => {
    try {
      const headers = ['Date', 'Programme', 'County', 'Subcounty', 'Location', 'Male Ben.', 'Female Ben.', 'Total Goats', 'Total Sheep', 'Vaccines', 'Total Doses', 'Field Officers', 'Issues', 'Comment'];
      const csvData = filteredActivities.map(a => {
        const vText = getActivityVaccines(a).map(v => `${v.type}(${v.doses})`).join(';');
        const iText = (a.issues || []).map(i => `${i.name}(${i.status})`).join(';');
        const tGoats = (a.beneficiaries || []).reduce((s, b) => s + (b.goats || 0), 0);
        const tSheep = (a.beneficiaries || []).reduce((s, b) => s + (b.sheep || 0), 0);
        return [formatDate(a.date), a.programme, a.county, a.subcounty, a.location, a.malebeneficiaries, a.femalebeneficiaries, tGoats, tSheep, vText, getActivityTotalDoses(a), (a.fieldofficers || []).map(o => `${o.name}(${o.role})`).join(';'), iText, a.comment];
      });
      const csvContent = [headers.join(','), ...csvData.map(r => r.map(f => `"${f}"`).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const link = document.createElement('a'); link.href = window.URL.createObjectURL(blob);
      link.download = `vaccination-${new Date().toISOString().split('T')[0]}.csv`; link.click();
      toast({ title: "Success", description: "Exported" });
    } catch (e) { toast({ title: "Error", description: "Export failed", variant: "destructive" }); }
  };

  const renderVaccinesInTable = (activity: AnimalHealthActivity) => {
    const v = getActivityVaccines(activity);
    if (v.length === 0) return "None";
    if (v.length === 1) return `${v[0].type} (${v[0].doses})`;
    return `${v.length} types`;
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No date';

  const isSaveDisabled =
    fieldOfficers.length === 0 ||
    selectedVaccines.length === 0 ||
    !totalDoses ||
    parseInt(totalDoses) <= 0 ||
    !activityForm.date ||
    !activityForm.county ||
    !activityForm.location ||
    !activityForm.programme;
  const handleAddDialogOpenChange = (open: boolean) => {
    setIsAddDialogOpen(open);
    if (open) {
      resetForms();
    }
  };
  const viewingFarmers = viewingActivity?.beneficiaries || [];
  const totalViewFarmerPages = Math.max(1, Math.ceil(viewingFarmers.length / FARMERS_PER_PAGE));
  const safeViewFarmersPage = Math.min(viewFarmersPage, totalViewFarmerPages);
  const paginatedViewingFarmers = viewingFarmers.slice(
    (safeViewFarmersPage - 1) * FARMERS_PER_PAGE,
    safeViewFarmersPage * FARMERS_PER_PAGE
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Animal Health Management</h1>
          <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogOpenChange}>
            <DialogTrigger asChild>
              {userIsChiefAdmin && (
                <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white">
                  <Plus className="h-4 w-4 mr-2" /> Record Vaccination
                </Button>
              )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[900px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="text-lg font-semibold text-slate-900">Record New Vaccination Activity</DialogTitle></DialogHeader>
              {/* ADD FORM CONTENT */}
              <div className="grid gap-6 py-4">
                 {/* Basic Info */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Date <span className="text-red-500">*</span></Label>
                        <Input type="date" value={activityForm.date} onChange={(e) => setActivityForm({...activityForm, date: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <Label>Programme <span className="text-red-500">*</span></Label>
                        <Select value={activityForm.programme} onValueChange={(v) => setActivityForm({...activityForm, programme: v})}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PROGRAMME_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                 </div>
                 <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>County <span className="text-red-500">*</span></Label>
                        <Input value={activityForm.county} onChange={(e) => setActivityForm({...activityForm, county: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <Label>Subcounty</Label>
                        <Input value={activityForm.subcounty} onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                        <Label>Location <span className="text-red-500">*</span></Label>
                        <Input value={activityForm.location} onChange={(e) => setActivityForm({...activityForm, location: e.target.value})} />
                    </div>
                 </div>
                 
                 {/* Beneficiaries Counts - EDITED TO ALLOW INPUT */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Male Beneficiaries</Label>
                        <Input 
                            type="number" 
                            value={activityForm.malebeneficiaries} 
                            onChange={(e) => setActivityForm({...activityForm, malebeneficiaries: e.target.value})} 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Female Beneficiaries</Label>
                        <Input 
                            type="number" 
                            value={activityForm.femalebeneficiaries} 
                            onChange={(e) => setActivityForm({...activityForm, femalebeneficiaries: e.target.value})} 
                        />
                    </div>
                 </div>

                 {/* Vaccines */}
                 <div className="space-y-2">
                    <Label>Vaccines <span className="text-red-500">*</span></Label>
                    <div className="grid grid-cols-4 gap-2">
                        {VACCINE_OPTIONS.map((vaccine) => (
                        <div key={vaccine} className="flex items-center space-x-2">
                            <Checkbox id={`vaccine-${vaccine}`} checked={selectedVaccines.includes(vaccine)} onCheckedChange={() => handleVaccineSelection(vaccine)} />
                            <Label htmlFor={`vaccine-${vaccine}`} className="text-xs">{vaccine}</Label>
                        </div>
                        ))}
                    </div>
                    <Input type="number" placeholder="Total Doses" value={totalDoses} onChange={(e) => setTotalDoses(e.target.value)} className="mt-2" />
                 </div>

                 {/* Farmers Upload */}
                 <div className="space-y-2 border p-4 rounded-xl bg-blue-50/30">
                    <div className="flex justify-between items-center mb-2">
                        <Label className="font-semibold text-blue-900">Farmers ({beneficiaries.length})</Label>
                        <Button type="button" variant="outline" size="sm" className="text-blue-600 border-blue-600" onClick={() => fileInputRef.current?.click()}>
                            <Upload className="h-3 w-3 mr-1" /> Upload Excel
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" />
                    </div>
                    {/* Manual Add Form */}
                    <div className="grid grid-cols-6 gap-2">
                        <Input placeholder="Name" value={beneficiaryForm.name} onChange={e => setBeneficiaryForm({...beneficiaryForm, name: e.target.value})} className="h-8" />
                        <Select value={beneficiaryForm.gender} onValueChange={(v: any) => setBeneficiaryForm({...beneficiaryForm, gender: v})}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                        </Select>
                        <Input placeholder="ID" value={beneficiaryForm.nationalId} onChange={e => setBeneficiaryForm({...beneficiaryForm, nationalId: e.target.value})} className="h-8" />
                        <Input placeholder="Goats" type="number" value={beneficiaryForm.goats} onChange={e => setBeneficiaryForm({...beneficiaryForm, goats: e.target.value})} className="h-8" />
                        <Input placeholder="Sheep" type="number" value={beneficiaryForm.sheep} onChange={e => setBeneficiaryForm({...beneficiaryForm, sheep: e.target.value})} className="h-8" />
                        <Button type="button" size="sm" onClick={handleAddBeneficiary} className="h-8 bg-blue-600">Add</Button>
                    </div>
                    {/* List */}
                     <div className="max-h-32 overflow-y-auto mt-2 space-y-1">
                        {beneficiaries.map(b => (
                            <div key={b.id} className="flex justify-between items-center bg-white p-1 px-2 rounded border text-xs">
                                <span>{b.name} ({b.gender}) - {b.nationalId}</span>
                                <span>G: {b.goats} S: {b.sheep}</span>
                                <X className="h-3 w-3 cursor-pointer text-red-500" onClick={() => handleRemoveBeneficiary(b.id)} />
                            </div>
                        ))}
                     </div>
                 </div>

                 {/* Field Officers */}
                 <div className="space-y-2">
                    <Label>Vaccination Team <span className="text-red-500">*</span></Label>
                    <div className="flex gap-2">
                        <Input placeholder="Name" value={fieldOfficerForm.name} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, name: e.target.value})} />
                        <Input placeholder="Role" value={fieldOfficerForm.role} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, role: e.target.value})} />
                        <Button type="button" onClick={handleAddFieldOfficer} className="bg-green-600"><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {fieldOfficers.map((fo, i) => (
                            <Badge key={i} variant="outline" className="py-1 px-2">{fo.name} ({fo.role}) <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => removeFieldOfficer(i)} /></Badge>
                        ))}
                    </div>
                 </div>

                 {/* Issues */}
                 <div className="space-y-2">
                     <div className="flex justify-between items-center">
                        <Label>Issues (Optional)</Label>
                        {!showIssueForm && <Button type="button" variant="outline" size="sm" onClick={() => setShowIssueForm(true)}>Add Issue</Button>}
                     </div>
                     {showIssueForm && (
                         <div className="grid grid-cols-2 gap-2 border p-2 rounded bg-slate-50">
                             <Input placeholder="Issue Name" value={issueForm.name} onChange={e => setIssueForm({...issueForm, name: e.target.value})} />
                             <Input placeholder="Raised By" value={issueForm.raisedBy} onChange={e => setIssueForm({...issueForm, raisedBy: e.target.value})} />
                             <Textarea placeholder="Description" className="col-span-2" value={issueForm.description} onChange={e => setIssueForm({...issueForm, description: e.target.value})} />
                             <Button type="button" size="sm" onClick={handleAddIssue} className="bg-orange-500 col-span-2">Save Issue</Button>
                         </div>
                     )}
                     {issues.map(iss => (
                         <div key={iss.id} className="text-xs bg-white border p-2 rounded flex justify-between items-center">
                             <span><b>{iss.name}</b> - {iss.status}</span>
                             <X className="h-3 w-3 cursor-pointer" onClick={() => handleRemoveIssue(iss.id)} />
                         </div>
                     ))}
                 </div>
                 
                 <div className="space-y-2">
                    <Label>Comment</Label>
                    <Textarea value={activityForm.comment} onChange={(e) => setActivityForm({...activityForm, comment: e.target.value})} placeholder="Observations..." />
                 </div>

                 <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetForms(); }}>Cancel</Button>
                    <Button onClick={handleAddActivity} disabled={isSaveDisabled} className="bg-gradient-to-r from-green-500 to-emerald-600 text-white">
                    <Save className="h-4 w-4 mr-2" /> Save Activity
                    </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white shadow-sm border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-600">Total Doses</CardTitle>
              <Syringe className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <div className="text-2xl font-bold text-slate-900">{totalDosesAdministered.toLocaleString()}</div>
              <p className="text-xs text-slate-500 mt-1">Administered to date</p>
            </CardContent>
          </Card>
          
          <Card className="bg-white shadow-sm border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-600">Total Farmers</CardTitle>
              <Users className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <div className="text-2xl font-bold text-slate-900">{totalBeneficiaries.toLocaleString()}</div>
              <div className="flex items-center gap-4 mt-2">
                 <p className="text-xs text-slate-500 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-500 mr-1"></span>
                    <span className="font-semibold text-slate-700">{totalMaleBeneficiaries.toLocaleString()}</span> Male
                 </p>
                 <p className="text-xs text-slate-500 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-pink-500 mr-1"></span>
                    <span className="font-semibold text-slate-700">{totalFemaleBeneficiaries.toLocaleString()}</span> Female
                 </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-600">Vaccination Rate</CardTitle>
              {vaccinationRate.trend === 'up' ? <TrendingUp className="h-4 w-4 text-green-500" /> : vaccinationRate.trend === 'down' ? <TrendingDown className="h-4 w-4 text-red-500" /> : <Activity className="h-4 w-4 text-slate-400" />}
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <div className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                {vaccinationRate.rate}%
                {vaccinationRate.trend === 'up' && <span className="text-xs text-green-500">(inc)</span>}
                {vaccinationRate.trend === 'down' && <span className="text-xs text-red-500">(dec)</span>}
              </div>
              <p className="text-xs text-slate-500 mt-1">Vs previous activity</p>
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons & Search */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2 w-full md:w-auto flex-1">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 max-w-sm" />
                </div>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="max-w-[160px]" />
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="max-w-[160px]" />
            </div>
            
            <div className="flex items-center gap-2">
                {isSelecting && selectedActivities.length > 0 && (
                    <Button variant="destructive" size="sm" onClick={handleDeleteMultipleActivities}>
                        <Trash2 className="h-4 w-4 mr-1" /> Delete Selected ({selectedActivities.length})
                    </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setIsSelecting(!isSelecting); setSelectedActivities([]); }}>
                    {isSelecting ? "Cancel Selection" : <><CheckSquare className="h-4 w-4 mr-1" /> Select</>}
                </Button>
                <Button variant="outline" size="sm" onClick={exportToCSV}>
                    <Download className="h-4 w-4 mr-1" /> Export
                </Button>
            </div>
        </div>

        {/* Activities Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {isSelecting && (
                    <th className="py-3 px-4 text-left w-12">
                      <Checkbox checked={selectedActivities.length === filteredActivities.length && filteredActivities.length > 0} onCheckedChange={selectAllActivities} />
                    </th>
                  )}
                  <th className="py-3 px-4 text-left font-semibold text-slate-600">Vaccination Date</th>
                 
                  <th className="py-3 px-4 text-left font-semibold text-slate-600">Location</th>
                  <th className="py-3 px-4 text-left font-semibold text-slate-600">Doses</th>
                  <th className="py-3 px-4 text-left font-semibold text-slate-600">Team</th>
                  
                  <th className="py-3 px-4 text-left font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-10"><Skeleton className="h-8 w-full" /></td></tr>
                ) : filteredActivities.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-500">No activities found.</td></tr>
                ) : (
                  filteredActivities.map((activity) => (
                    <tr key={activity.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      {isSelecting && (
                        <td className="py-3 px-4">
                            <Checkbox checked={selectedActivities.includes(activity.id)} onCheckedChange={() => toggleActivitySelection(activity.id)} />
                        </td>
                      )}
                      <td className="py-3 px-4 font-medium text-slate-800">{formatDate(activity.date)}</td>
                     
                      <td className="py-3 px-4 text-slate-600">
                        <div className="flex flex-col">
                            <span className="font-medium">{activity.county}</span>
                            <span className="text-xs text-slate-400">{activity.subcounty} - {activity.location}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                            <span className="font-bold text-green-700">{getActivityTotalDoses(activity).toLocaleString()}</span>
                            <span className="text-xs text-slate-500">{renderVaccinesInTable(activity)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" className="text-blue-600 h-7 text-xs" onClick={() => openFieldOfficersDialog(activity.fieldofficers)}>
                            <Users className="h-3 w-3 mr-1" /> {activity.fieldofficers?.length || 0}
                        </Button>
                      </td>
                      
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-600" onClick={() => openViewDialog(activity)}>
                                <Eye className="h-4 w-4" />
                            </Button>
                            {userIsChiefAdmin && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-green-600" onClick={() => openEditDialog(activity)}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-600" onClick={() => handleDeleteActivity(activity.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* EDIT DIALOG */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[900px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
             <DialogHeader><DialogTitle className="text-xl font-semibold text-slate-900">Edit Vaccination Activity</DialogTitle></DialogHeader>
             <div className="grid gap-6 py-4">
                {/* Same Form Structure as Add Dialog */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Date</Label><Input type="date" value={activityForm.date} onChange={(e) => setActivityForm({...activityForm, date: e.target.value})} /></div>
                    <div className="space-y-2"><Label>Project</Label>
                        <Select value={activityForm.programme} onValueChange={(v) => setActivityForm({...activityForm, programme: v})}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{PROGRAMME_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2"><Label>County</Label><Input value={activityForm.county} onChange={(e) => setActivityForm({...activityForm, county: e.target.value})} /></div>
                    <div className="space-y-2"><Label>Subcounty</Label><Input value={activityForm.subcounty} onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})} /></div>
                    <div className="space-y-2"><Label>Location</Label><Input value={activityForm.location} onChange={(e) => setActivityForm({...activityForm, location: e.target.value})} /></div>
                </div>
                
                {/* Beneficiaries Counts in Edit - ADDED TO ALLOW MANUAL INPUT */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Male Beneficiaries</Label>
                        <Input 
                            type="number" 
                            value={activityForm.malebeneficiaries} 
                            onChange={(e) => setActivityForm({...activityForm, malebeneficiaries: e.target.value})} 
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Female Beneficiaries</Label>
                        <Input 
                            type="number" 
                            value={activityForm.femalebeneficiaries} 
                            onChange={(e) => setActivityForm({...activityForm, femalebeneficiaries: e.target.value})} 
                        />
                    </div>
                </div>

                {/* Beneficiaries in Edit */}
                <div className="border p-4 rounded-xl bg-blue-50/30 space-y-2">
                     <Label className="font-semibold text-blue-900">Farmers ({beneficiaries.length})</Label>
                     <div className="grid grid-cols-5 gap-2">
                        <Input placeholder="Name" value={beneficiaryForm.name} onChange={e => setBeneficiaryForm({...beneficiaryForm, name: e.target.value})} className="h-8" />
                        <Select value={beneficiaryForm.gender} onValueChange={(v: any) => setBeneficiaryForm({...beneficiaryForm, gender: v})}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                        </Select>
                        <Input placeholder="ID" value={beneficiaryForm.nationalId} onChange={e => setBeneficiaryForm({...beneficiaryForm, nationalId: e.target.value})} className="h-8" />
                        <Input placeholder="Goats" type="number" value={beneficiaryForm.goats} onChange={e => setBeneficiaryForm({...beneficiaryForm, goats: e.target.value})} className="h-8" />
                        <div className="flex gap-1">
                            <Button size="sm" onClick={handleAddBeneficiary} className="h-8 bg-blue-600 flex-1">Add</Button>
                            <Button variant="outline" size="sm" className="h-8 px-2 border-blue-600 text-blue-600" onClick={() => editFileInputRef.current?.click()}>
                                <Upload className="h-3 w-3" />
                            </Button>
                            <input type="file" ref={editFileInputRef} onChange={handleFileUpload} className="hidden" />
                        </div>
                    </div>
                    <div className="max-h-32 overflow-y-auto mt-2 space-y-1">
                        {beneficiaries.map(b => (
                            <div key={b.id} className="flex justify-between items-center bg-white p-1 px-2 rounded border text-xs">
                                <span>{b.name} ({b.gender}) - {b.nationalId}</span>
                                <X className="h-3 w-3 cursor-pointer text-red-500" onClick={() => handleRemoveBeneficiary(b.id)} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Field Officers in Edit */}
                <div className="space-y-2">
                    <Label>Field Officers</Label>
                    <div className="flex gap-2">
                        <Input placeholder="Name" value={fieldOfficerForm.name} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, name: e.target.value})} />
                        <Input placeholder="Role" value={fieldOfficerForm.role} onChange={(e) => setFieldOfficerForm({...fieldOfficerForm, role: e.target.value})} />
                        <Button onClick={handleAddFieldOfficer} className="bg-green-600"><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {fieldOfficers.map((fo, i) => (
                            <Badge key={i} variant="outline" className="py-1 px-2">{fo.name} ({fo.role}) <X className="h-3 w-3 ml-1 cursor-pointer" onClick={() => removeFieldOfficer(i)} /></Badge>
                        ))}
                    </div>
                 </div>

                 <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleEditActivity} disabled={isSaveDisabled} className="bg-blue-600 text-white">Update Activity</Button>
                 </div>
             </div>
          </DialogContent>
        </Dialog>

        {/* VIEW DIALOG */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
            <DialogContent className="sm:max-w-[800px] bg-white rounded-2xl max-h-[90vh] overflow-y-auto">
                {viewingActivity && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex justify-between items-center">
                                <span>Activity Details</span>
                                <Badge variant={viewingActivity.programme === 'KPMD' ? 'default' : 'secondary'} className={viewingActivity.programme === 'KPMD' ? 'bg-indigo-100 text-indigo-800' : 'bg-teal-100 text-teal-800'}>
                                    {viewingActivity.programme}
                                </Badge>
                            </DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-2 gap-4 border p-4 rounded-xl bg-slate-50">
                                <div>
                                    <Label className="text-xs text-slate-500">Date</Label>
                                    <p className="font-semibold">{formatDate(viewingActivity.date)}</p>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-500">County</Label>
                                    <p className="font-semibold">{viewingActivity.county}</p>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-500">Subcounty</Label>
                                    <p className="font-semibold">{viewingActivity.subcounty || 'N/A'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs text-slate-500">Location</Label>
                                    <p className="font-semibold">{viewingActivity.location}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 border p-4 rounded-xl bg-green-50">
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-green-700">{getActivityTotalDoses(viewingActivity)}</p>
                                    <p className="text-xs text-green-900">Total Doses</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-blue-700">{viewingActivity.malebeneficiaries}</p>
                                    <p className="text-xs text-blue-900">Male Farmers</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-purple-700">{viewingActivity.femalebeneficiaries}</p>
                                    <p className="text-xs text-purple-900">Female Farmers</p>
                                </div>
                            </div>

                            <div>
                                <Label className="text-xs text-slate-500 mb-2 block">Vaccines</Label>
                                <div className="flex flex-wrap gap-2">
                                    {getActivityVaccines(viewingActivity).map((v, i) => (
                                        <Badge key={i} className="bg-emerald-100 text-emerald-800">{v.type} ({v.doses})</Badge>
                                    ))}
                                </div>
                            </div>

                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                                    <Label className="text-xs text-slate-600">Farmers Details ({viewingActivity.beneficiaries?.length || 0})</Label>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="py-2 px-4 text-left font-semibold text-slate-600">#</th>
                                                <th className="py-2 px-4 text-left font-semibold text-slate-600">Name</th>
                                                <th className="py-2 px-4 text-left font-semibold text-slate-600">Gender</th>
                                                <th className="py-2 px-4 text-left font-semibold text-slate-600">ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(viewingActivity.beneficiaries || []).length > 0 ? (
                                                paginatedViewingFarmers.map((farmer, index) => (
                                                    <tr key={farmer.id || `${farmer.nationalId}-${index}`} className="border-b border-slate-100 last:border-b-0">
                                                        <td className="py-2 px-4 text-slate-600">{(safeViewFarmersPage - 1) * FARMERS_PER_PAGE + index + 1}</td>
                                                        <td className="py-2 px-4 font-medium text-slate-800">{farmer.name || 'N/A'}</td>
                                                        <td className="py-2 px-4 text-slate-700">{farmer.gender || 'N/A'}</td>
                                                        <td className="py-2 px-4 text-slate-700 font-mono">{farmer.nationalId || 'N/A'}</td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={4} className="py-4 px-4 text-center text-slate-500">
                                                        No farmer details recorded.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {(viewingActivity.beneficiaries || []).length > FARMERS_PER_PAGE && (
                                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
                                      <p className="text-xs text-slate-500">
                                          Showing {Math.min((safeViewFarmersPage - 1) * FARMERS_PER_PAGE + 1, viewingFarmers.length)}-
                                          {Math.min(safeViewFarmersPage * FARMERS_PER_PAGE, viewingFarmers.length)} of {viewingFarmers.length}
                                      </p>
                                      <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={safeViewFarmersPage <= 1}
                                            onClick={() => setViewFarmersPage((prev) => Math.max(1, prev - 1))}
                                          >
                                            Previous
                                          </Button>
                                          <span className="text-xs text-slate-600">
                                            Page {safeViewFarmersPage} of {totalViewFarmerPages}
                                          </span>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={safeViewFarmersPage >= totalViewFarmerPages}
                                            onClick={() => setViewFarmersPage((prev) => Math.min(totalViewFarmerPages, prev + 1))}
                                          >
                                            Next
                                          </Button>
                                      </div>
                                  </div>
                                )}
                            </div>

                            {viewingActivity.comment && (
                                <div>
                                    <Label className="text-xs text-slate-500">Comment</Label>
                                    <p className="text-sm mt-1 bg-slate-100 p-2 rounded">{viewingActivity.comment}</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>

        {/* FIELD OFFICERS DIALOG */}
        <Dialog open={isFieldOfficersDialogOpen} onOpenChange={setIsFieldOfficersDialogOpen}>
            <DialogContent className="sm:max-w-[400px] bg-white">
                <DialogHeader><DialogTitle>Vaccination Team</DialogTitle></DialogHeader>
                <div className="space-y-2 py-4">
                    {selectedActivityFieldOfficers.length === 0 ? (
                        <p className="text-sm text-slate-500">No officers recorded.</p>
                    ) : (
                        selectedActivityFieldOfficers.map((fo, i) => (
                            <div key={i} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border">
                                <div className="flex items-center gap-2">
                                    <User className="h-4 w-4 text-slate-500" />
                                    <span className="font-medium">{fo.name}</span>
                                </div>
                                <Badge variant="secondary">{fo.role}</Badge>
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>

      </div>
    </div>
  );
};

export default AnimalHealthPage;
