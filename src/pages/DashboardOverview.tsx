import { useState, useEffect, useMemo } from "react";
import { ref, push, get, query, orderByChild, equalTo } from "firebase/database"; 
import { getAuth } from "firebase/auth";
import { db } from "@/lib/firebase"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Tabs, TabsList, TabsTrigger 
} from "@/components/ui/tabs"; // Added Tabs
import { 
  Users, 
  GraduationCap, 
  Beef, 
  MapPin, 
  Plus, 
  Calendar,
  Activity,
  Eye,
  Bell,
  ArrowRight,
  Trash2,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const PROGRAMME_OPTIONS = ["KPMD", "RANGE"];

// --- Interfaces ---

interface FarmerData extends Record<string, any> {
  id: string;
  programme?: string; // Important for filtering
  goats?: number | { male: number; female: number; total: number };
  cattle?: string | number;
  sheep?: string | number;
  gender?: string;
  region?: string;
}

interface StatCardProps {
  title: string;
  icon: React.ReactNode;
  maleCount?: number;
  femaleCount?: number;
  total: number;
  gradient: string;
  description?: string;
}

interface Participant {
  name: string;
  role: string;
}

interface Activity {
  id: string;
  activityName: string;
  date: string; 
  numberOfPersons: number;
  county: string;
  location: string;
  participants: Participant[];
  subcounty: string;
  createdAt: any;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  programme?: string; // Important for filtering
  totalFarmers?: number;
}

interface RegionStats {
  name: string;
  farmerCount: number;
  maleFarmers: number;
  femaleFarmers: number;
}

// --- Helper Functions ---

const getGoatTotal = (goats: any): number => {
  if (typeof goats === 'number') return goats;
  if (typeof goats === 'object' && goats !== null && typeof goats.total === 'number') return goats.total;
  return 0;
};

// --- Components ---

const StatCard = ({ title, icon, maleCount, femaleCount, total, gradient, description }: StatCardProps) => (
  <div className="group relative bg-white">
    <div className="relative bg-white backdrop-blur-sm rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 p-6">
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center shadow-lg ${gradient}`}>
            {icon}
          </div>
        </div>
        <div className="ml-5 flex-1">
          <p className="text-sm font-medium text-slate-600 uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{total.toLocaleString()}</p>
          
          {(maleCount !== undefined && femaleCount !== undefined) ? (
            <div className="flex gap-4 mt-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-600">Male</span>
                <span className="text-sm font-semibold text-slate-900">{maleCount.toLocaleString()}</span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate-600">Female</span>
                <span className="text-sm font-semibold text-slate-900">{femaleCount.toLocaleString()}</span>
              </div>
            </div>
          ) : description && (
             <p className="text-xs text-slate-500 mt-3">{description}</p>
          )}
        </div>
      </div>
    </div>
  </div>
);

const ActivityTable = ({ activities }: { activities: Activity[] }) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      'in-progress': { color: 'bg-blue-100 text-blue-800', label: 'In Progress' },
      'completed': { color: 'bg-green-100 text-green-800', label: 'Completed' },
      'cancelled': { color: 'bg-red-100 text-red-800', label: 'Cancelled' }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return <Badge className={`${config.color} border-0 text-xs`}>{config.label}</Badge>;
  };

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 shadow-sm">
              <th className="p-4 text-left font-semibold text-slate-700 text-sm">Activity Name</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-sm">Date</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-sm">Status</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-sm">Location</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-sm">Participants</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activities.map((activity) => (
              <tr 
                key={activity.id} 
                className="hover:bg-slate-50/50 transition-colors duration-200 group"
              >
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                    <span className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
                      {activity.activityName}
                    </span>
                  </div>
                </td>
                <td className="p-4">
                  <Badge className="bg-blue-100 text-blue-700 border-0 shadow-sm">
                    {formatDate(activity.date)}
                  </Badge>
                </td>
                <td className="p-4">
                  {getStatusBadge(activity.status)}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-slate-500" />
                    <span className="text-slate-700">{activity.location}</span>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-500" />
                    <span className="font-semibold text-slate-900">{activity.numberOfPersons}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Main Page ---

const DashboardOverview = () => {
  const auth = getAuth();
  const { user } = useAuth();
  const { toast } = useToast();

  // Permissions State
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allowedProgrammes, setAllowedProgrammes] = useState<string[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(true);

  // Dashboard View State
  const [selectedProgramme, setSelectedProgramme] = useState<string>("All"); // "All", "KPMD", "RANGE"
  const [loadingData, setLoadingData] = useState(true);

  // Raw Data States (Fetched once)
  const [rawFarmers, setRawFarmers] = useState<FarmerData[]>([]);
  const [rawActivities, setRawActivities] = useState<Activity[]>([]);

  // Dialog State
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [participantForm, setParticipantForm] = useState({ name: "", role: "" });
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeProgrammeForAdd, setActiveProgrammeForAdd] = useState<string>("KPMD");
  
  const [activityForm, setActivityForm] = useState({
    activityName: "",
    date: "",
    county: "",
    subcounty: "",
    location: "",
  });

  const programmeOptions = userRole === "chief-admin" ? PROGRAMME_OPTIONS : allowedProgrammes;

  // --- Filters ---

  const filteredFarmers = useMemo(() => {
    if (selectedProgramme === "All") return rawFarmers;
    return rawFarmers.filter(f => f.programme === selectedProgramme);
  }, [rawFarmers, selectedProgramme]);

  const filteredActivities = useMemo(() => {
    let activities = rawActivities;
    if (selectedProgramme !== "All") {
      activities = activities.filter(a => a.programme === selectedProgramme);
    }
    return activities.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawActivities, selectedProgramme]);

  // --- Stats Calculations (Reactive to Filters) ---

  const stats = useMemo(() => {
    const data = filteredFarmers;

    // 1. Gender Stats
    const maleFarmers = data.filter(f => String(f.gender || f.Gender).toLowerCase() === 'male').length;
    const femaleFarmers = data.filter(f => String(f.gender || f.Gender).toLowerCase() === 'female').length;

    // 2. Trained Stats (Sum totalFarmers from filtered activities)
    // Note: We need to map farmers to activities? The previous code summed "totalFarmers" property from capacityBuilding.
    // Assuming capacityBuilding data was fetched into rawActivities (or we need to fetch it separately).
    // *Correction*: The original code fetched 'capacityBuilding' for trained stats, but 'Recent Activities' for the table.
    // We need to fetch capacity building data too.
    return {
      totalFarmers: data.length,
      maleFarmers,
      femaleFarmers,
      trainedFarmers: 0, // Placeholder, will be updated below
      trainedMale: 0,
      trainedFemale: 0,
      totalGoats: 0,
      totalSheep: 0,
      totalCattle: 0,
      maleGoats: 0,
      femaleGoats: 0,
      regionsVisited: 0,
    };
  }, [filteredFarmers]);

  const regionStats = useMemo(() => {
    const regionMap: Record<string, RegionStats> = {};
    filteredFarmers.forEach((farmer) => {
      const region = farmer.region || farmer.Region || farmer.county || farmer.County;
      if (region) {
        const regionName = String(region).trim();
        if (!regionMap[regionName]) {
          regionMap[regionName] = { name: regionName, farmerCount: 0, maleFarmers: 0, femaleFarmers: 0 };
        }
        regionMap[regionName].farmerCount++;
        const gender = String(farmer.gender || farmer.Gender).toLowerCase();
        if (gender === 'male') regionMap[regionName].maleFarmers++;
        else if (gender === 'female') regionMap[regionName].femaleFarmers++;
      }
    });
    return Object.values(regionMap).sort((a, b) => b.farmerCount - a.farmerCount);
  }, [filteredFarmers]);

  // Animal Census
  const animalStats = useMemo(() => {
    let totalGoats = 0, maleGoats = 0, femaleGoats = 0, totalSheep = 0, totalCattle = 0;
    filteredFarmers.forEach((farmer) => {
      const g = getGoatTotal(farmer.goats);
      totalGoats += g;
      if (farmer.goats && typeof farmer.goats === 'object') {
        maleGoats += Number(farmer.goats.male || 0);
        femaleGoats += Number(farmer.goats.female || 0);
      }
      totalSheep += Number(farmer.sheep || 0);
      totalCattle += Number(farmer.cattle || 0);
    });
    return { totalGoats, maleGoats, femaleGoats, totalSheep, totalCattle, regionsVisited: regionStats.length };
  }, [filteredFarmers, regionStats.length]);

  // Merge stats objects
  const finalStats = { ...stats, ...animalStats };

  // Recent Activities (Top 3)
  const recentActivities = useMemo(() => filteredActivities.slice(0, 3), [filteredActivities]);
  const pendingActivitiesCount = useMemo(() => filteredActivities.filter(a => a.status === 'pending').length, [filteredActivities]);


  // --- Data Fetching ---

  const fetchSecureCollection = async (nodePath: string): Promise<any[]> => {
    if (!auth.currentUser) return [];

    // Chief Admin: Fetch all
    if (userRole === 'chief-admin') {
      const snapshot = await get(ref(db, nodePath));
      if (!snapshot.exists()) return [];
      return Object.keys(snapshot.val()).map(key => ({ id: key, ...snapshot.val()[key] }));
    }

    // Non-Admin: Fetch by allowed programmes
    if (allowedProgrammes.length === 0) return [];

    const promises = allowedProgrammes.map(programme => {
      const q = query(ref(db, nodePath), orderByChild('programme'), equalTo(programme));
      return get(q);
    });

    try {
      const snapshots = await Promise.all(promises);
      const results: any[] = [];

      snapshots.forEach(snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          Object.keys(data).forEach(key => {
            results.push({ id: key, ...data[key] });
          });
        }
      });

      return results;
    } catch (error) {
      console.warn(`Query failed for ${nodePath}, falling back to client-side filter.`, error);
      const snapshot = await get(ref(db, nodePath));
      if (!snapshot.exists()) return [];
      const data = snapshot.val();
      return Object.keys(data)
        .map(key => ({ id: key, ...data[key] }))
        .filter(item => allowedProgrammes.includes(item.programme));
    }
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoadingPermissions(false);
      return;
    }

    const fetchUserDetails = async () => {
      try {
        const userRef = ref(db, `users/${uid}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
          const data = snapshot.val();
          setUserRole(data.role || null);
          
          const programmesObj = data.allowedProgrammes || {};
          const programmesList = Object.keys(programmesObj).filter(k => programmesObj[k] === true);
          if (data.role === "chief-admin") {
            setAllowedProgrammes(PROGRAMME_OPTIONS);
          } else {
            setAllowedProgrammes(programmesList);
          }
          
          // Set default add programme
          const defaultProgrammes = data.role === "chief-admin" ? PROGRAMME_OPTIONS : programmesList;
          if (defaultProgrammes.length > 0) {
            setActiveProgrammeForAdd(defaultProgrammes[0]);
          }
        }
      } catch (error) {
        console.error("Error fetching user permissions:", error);
      } finally {
        setLoadingPermissions(false);
      }
    };

    fetchUserDetails();
  }, [auth.currentUser?.uid]);

  // Fetch Data on permissions load
  useEffect(() => {
    if (loadingPermissions) return;
    fetchData();
  }, [userRole, allowedProgrammes, loadingPermissions]);

  const fetchData = async () => {
    try {
      setLoadingData(true);
      
      const [farmersData, activitiesData, capacityData] = await Promise.all([
        fetchSecureCollection("farmers"),
        fetchSecureCollection("Recent Activities"),
        fetchSecureCollection("capacityBuilding")
      ]);

      setRawFarmers(farmersData);
      setRawActivities(activitiesData);

      setRawCapacityData(capacityData);

    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoadingData(false);
    }
  };

  const [rawCapacityData, setRawCapacityData] = useState<any[]>([]);

  // Re-calculate stats when raw data or selection changes
  // We need to merge this into the previous `stats` useMemo or create a combined one.
  // I will adjust the `finalStats` calculation to include this.

  const calculatedStats = useMemo(() => {
    // Recalculate trained based on raw capacity
    let filteredCapacity = rawCapacityData;
    if (selectedProgramme !== "All") {
      filteredCapacity = rawCapacityData.filter((c: any) => c.programme === selectedProgramme);
    }
    const totalTrained = filteredCapacity.reduce((sum, t: any) => sum + (Number(t.totalFarmers) || 0), 0);

    return {
        ...finalStats,
        trainedFarmers: totalTrained
    };
  }, [finalStats, rawCapacityData, selectedProgramme]); 

  // Handlers
  const handleAddParticipant = () => {
    if (participantForm.name.trim() && participantForm.role.trim()) {
      setParticipants([...participants, { ...participantForm }]);
      setParticipantForm({ name: "", role: "" });
    }
  };

  const removeParticipant = (index: number) => {
    const updatedParticipants = participants.filter((_, i) => i !== index);
    setParticipants(updatedParticipants);
  };

  const handleAddActivity = async () => {
    if (participants.length === 0) {
      toast({ title: "Error", description: "Please add at least one participant", variant: "destructive" });
      return;
    }

    try {
      await push(ref(db, "Recent Activities"), {
        ...activityForm,
        numberOfPersons: participants.length, 
        participants: participants,
        status: 'pending', 
        programme: activeProgrammeForAdd,
        createdBy: user?.email,
        createdAt: new Date().toISOString(), 
      });
      
      toast({ title: "Success", description: "Activity scheduled successfully." });
      
      setActivityForm({ activityName: "", date: "", county: "", subcounty: "", location: "" });
      setParticipants([]);
      setIsAddDialogOpen(false);
      fetchData(); // Refresh to show new activity
    } catch (error) {
      toast({ title: "Error", description: "Failed to schedule activity.", variant: "destructive" });
    }
  };

  // Update Add Dialog default programme when Tab changes
  useEffect(() => {
    if (selectedProgramme !== "All") {
      setActiveProgrammeForAdd(selectedProgramme);
    } else if (programmeOptions.length > 0) {
      setActiveProgrammeForAdd(programmeOptions[0]);
    }
  }, [selectedProgramme, programmeOptions]);

  const LoadingSkeleton = () => (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="group relative">
            <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Skeleton className="w-14 h-14 rounded-xl" />
                </div>
                <div className="ml-5 flex-1">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-8 w-20 mb-3" />
                  <div className="flex gap-4">
                    <Skeleton className="h-10 flex-1 rounded-lg" />
                    <Skeleton className="h-10 flex-1 rounded-lg" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const topRegions = regionStats.slice(0, 4);

  if (loadingPermissions) {
    return (
       <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-6 flex items-center justify-center">
         <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
       </div>
    );
  }

  if (userRole !== 'chief-admin' && allowedProgrammes.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-6">
        <Card className="max-w-md mx-auto mt-20">
          <CardHeader>
            <CardTitle>No Access</CardTitle>
          </CardHeader>
          <CardContent>
            <p>You are not assigned to any programmes. Please contact your administrator.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-md font-bold text-slate-900">Dashboard Overview</h1>
            {userRole !== 'chief-admin' && (
               <div className="flex gap-2 mt-2">
                 {programmeOptions.map(p => (
                   <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                 ))}
               </div>
            )}
          </div>
          <Link to="/activities">
            <Button variant="outline" className="relative">
              <Bell className="h-4 w-4 mr-2" />
              Activities
              {pendingActivitiesCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
                  {pendingActivitiesCount}
                </span>
              )}
            </Button>
          </Link>
        </div>

        {loadingData ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Programme Switcher Tabs */}
            {programmeOptions.length > 1 && (
               <div className="flex justify-center mb-6">
                 <Tabs value={selectedProgramme} onValueChange={setSelectedProgramme} className="bg-white p-1 rounded-xl shadow-sm border border-slate-200">
                   <TabsList className="bg-transparent w-auto p-0">
                     {userRole === 'chief-admin' && (
                       <TabsTrigger value="All" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white text-slate-600 rounded-lg px-6">
                         All
                       </TabsTrigger>
                     )}
                     {programmeOptions.map(prog => (
                       <TabsTrigger key={prog} value={prog} className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-600 rounded-lg px-6">
                         {prog}
                       </TabsTrigger>
                     ))}
                   </TabsList>
                 </Tabs>
               </div>
            )}

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StatCard
                title="Farmers Registered"
                icon={<Users className="h-7 w-7 text-blue-600" />}
                maleCount={calculatedStats.maleFarmers}
                femaleCount={calculatedStats.femaleFarmers}
                total={calculatedStats.totalFarmers}
                gradient="bg-gradient-to-br from-blue-100 to-blue-50"
              />
              
              <StatCard
                title="Trained Farmers"
                icon={<GraduationCap className="h-7 w-7 text-green-600" />}
                maleCount={calculatedStats.trainedMale}
                femaleCount={calculatedStats.trainedFemale}
                total={calculatedStats.trainedFarmers}
                gradient="bg-gradient-to-br from-green-100 to-green-50"
                description={`Data from ${selectedProgramme === "All" ? "All Programmes" : selectedProgramme}`}
              />

              <StatCard
                title="Animal Census"
                icon={<Beef className="h-7 w-7 text-orange-600" />}
                maleCount={calculatedStats.maleGoats}
                femaleCount={calculatedStats.femaleGoats}
                total={calculatedStats.totalGoats}
                gradient="bg-gradient-to-br from-orange-100 to-orange-50"
              />
              
              <div className="group relative">
                <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-14 h-14 bg-gradient-to-br from-purple-100 to-purple-50 rounded-xl flex items-center justify-center shadow-lg">
                        <MapPin className="h-7 w-7 text-purple-600" />
                      </div>
                    </div>
                    <div className="ml-5 flex-1">
                     <div className="flex items-center justify-between mb-1"> 
                      <p className="text-sm font-medium text-slate-600 uppercase tracking-wide">COUNTIES COVERED</p>
                      <p className="bg-purple-100 text-purple-700 border-0 text-xs rounded-full text-center w-10">{calculatedStats.regionsVisited}</p>
                      </div>
                      {topRegions.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-1">
                          {topRegions.map((region) => (
                            <div key={region.name} className="bg-slate-50/80 rounded-lg p-1 shadow-sm">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-slate-700 truncate">
                                  {region.name}
                                </span>
                                <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">
                                  {region.farmerCount}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {topRegions.length === 0 && (
                        <div className="mt-3 text-sm text-slate-500">
                          No region data available
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activities Section */}
            <div className="space-y-6">
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-slate-100/80 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg mr-3">
                        <Activity className="w-4 h-4 text-white" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900">Recent Activities</h3>
                      {selectedProgramme !== "All" && (
                          <Badge className="ml-2 bg-blue-100 text-blue-700 border-0">{selectedProgramme}</Badge>
                      )}
                    </div>
                    <Link to="/dashboard/activities">
                      <Button variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900">
                        View All <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>

                <div className="p-6">
                  {recentActivities.length > 0 ? (
                    <>
                      <ActivityTable activities={recentActivities} />
                      
                      <div className="flex justify-between items-center pt-6 mt-6 border-t border-slate-200">
                        <Link to="/dashboard/activities">
                          <Button variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50 font-medium px-4 py-2 rounded-xl transition-all duration-200 shadow-sm">
                            <Eye className="h-4 w-4 mr-2" />
                            View All Activities
                          </Button>
                        </Link>
                        
                        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                          <DialogTrigger asChild>
                            <Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200">
                              <Plus className="h-4 w-4 mr-2" />
                              Schedule Activity
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle className="text-xl font-semibold text-slate-900">
                                Schedule New Activity
                              </DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-6 py-4">
                              {/* Programme Selector (Hidden if user has only 1) */}
                              {userRole !== 'chief-admin' && programmeOptions.length > 1 && (
                                <div className="space-y-2">
                                  <Label htmlFor="programmeSelect">Programme</Label>
                                  <select 
                                    id="programmeSelect"
                                    value={activeProgrammeForAdd}
                                    onChange={(e) => setActiveProgrammeForAdd(e.target.value)}
                                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                                  >
                                    {allowedProgrammes.map(p => (
                                      <option key={p} value={p}>{p}</option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="activityName">Activity Name</Label>
                                  <Input
                                    id="activityName"
                                    value={activityForm.activityName}
                                    onChange={(e) => setActivityForm({...activityForm, activityName: e.target.value})}
                                    placeholder="Enter activity name"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="date">Date</Label>
                                  <Input
                                    id="date"
                                    type="date"
                                    value={activityForm.date}
                                    onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label htmlFor="county">County</Label>
                                  <Input
                                    id="county"
                                    value={activityForm.county}
                                    onChange={(e) => setActivityForm({...activityForm, county: e.target.value})}
                                    placeholder="Enter county"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="subcounty">Subcounty</Label>
                                  <Input
                                    id="subcounty"
                                    value={activityForm.subcounty}
                                    onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})}
                                    placeholder="Enter subcounty"
                                  />
                                </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="location">Location</Label>
                                <Input
                                  id="location"
                                  value={activityForm.location}
                                  onChange={(e) => setActivityForm({...activityForm, location: e.target.value})}
                                  placeholder="Enter location"
                                />
                              </div>

                              {/* Participants Section */}
                              <div className="space-y-4 border-t pt-4">
                                <div className="flex items-center justify-between">
                                  <Label>Participants ({participants.length})</Label>
                                  <span className="text-xs text-slate-500">Add participants with their roles</span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                  <Input
                                    placeholder="Participant Name"
                                    value={participantForm.name}
                                    onChange={(e) => setParticipantForm({...participantForm, name: e.target.value})}
                                  />
                                  <div className="flex gap-2">
                                    <Input
                                      placeholder="Role"
                                      value={participantForm.role}
                                      onChange={(e) => setParticipantForm({...participantForm, role: e.target.value})}
                                    />
                                    <Button 
                                      type="button" 
                                      onClick={handleAddParticipant}
                                      className="bg-blue-500 hover:bg-blue-600 text-white"
                                      disabled={!participantForm.name.trim() || !participantForm.role.trim()}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>

                                {participants.length > 0 && (
                                  <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {participants.map((participant, index) => (
                                      <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                                        <div className="flex-1">
                                          <p className="font-medium text-slate-900">{participant.name}</p>
                                          <p className="text-sm text-slate-600">{participant.role}</p>
                                        </div>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => removeParticipant(index)}
                                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
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
                                  setParticipants([]);
                                  setActivityForm({ activityName: "", date: "", county: "", subcounty: "", location: "" });
                                }}
                              >
                                Cancel
                              </Button>
                              <Button 
                                onClick={handleAddActivity}
                                disabled={participants.length === 0}
                                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                              >
                                <Calendar className="h-4 w-4 mr-2" />
                                Schedule Activity
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </>
                  ) : (
                    <div className="text-center p-8 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50/50">
                      <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <Activity className="h-8 w-8 text-white" />
                      </div>
                      <h4 className="text-xl font-bold text-slate-800 mb-2">
                        No activities yet
                      </h4>
                      <p className="text-slate-600 mb-4">
                        Start scheduling your field activities and events to see them displayed here.
                      </p>
                      <div className="flex justify-center">
                        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                          <DialogTrigger asChild>
                            <Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200">
                              <Plus className="h-4 w-4 mr-2" />
                              Schedule Your First Activity
                            </Button>
                          </DialogTrigger>
                        </Dialog>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardOverview;