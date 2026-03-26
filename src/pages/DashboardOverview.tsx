import { useState, useEffect, useMemo } from "react";
import { ref, push, get, query, orderByChild, equalTo } from "firebase/database"; 
import { db } from "@/lib/firebase"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Users, GraduationCap, Beef, MapPin, Plus, Activity, Eye, Bell, ArrowRight, Trash2, Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query"; // Import React Query
import { fetchAnalysisSummary } from "@/lib/analysis";
import { Calendar } from "@/components/ui/calendar";
import { canViewAllProgrammes } from "@/contexts/authhelper";

const PROGRAMME_OPTIONS = ["KPMD", "RANGE"];

// --- Interfaces ---
interface FarmerData extends Record<string, any> {
  id: string;
  programme?: string;
  goats?: number | { male: number; female: number; total: number };
  cattle?: string | number;
  sheep?: string | number;
  gender?: string;
  region?: string;
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
  programme?: string;
  totalFarmers?: number;
}

interface RegionStats {
  name: string;
  farmerCount: number;
  maleFarmers: number;
  femaleFarmers: number;
}

interface OverviewSummaryData {
  stats: {
    totalFarmers: number;
    maleFarmers: number;
    femaleFarmers: number;
    trainedFarmers: number;
    maleGoats: number;
    femaleGoats: number;
    totalGoats: number;
    totalSheep: number;
    totalCattle: number;
    regionsVisited: number;
  };
  topRegions: RegionStats[];
  recentActivities: Activity[];
  pendingActivitiesCount: number;
}

// --- Helper Functions ---
const getGoatTotal = (goats: any): number => {
  if (typeof goats === 'number') return goats;
  if (typeof goats === 'object' && goats !== null && typeof goats.total === 'number') return goats.total;
  return 0;
};

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const USE_REMOTE_ANALYTICS =
  typeof window !== "undefined" && !LOCALHOSTS.has(window.location.hostname);

const EMPTY_OVERVIEW_DATA: OverviewSummaryData = {
  stats: {
    totalFarmers: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    trainedFarmers: 0,
    maleGoats: 0,
    femaleGoats: 0,
    totalGoats: 0,
    totalSheep: 0,
    totalCattle: 0,
    regionsVisited: 0,
  },
  topRegions: [],
  recentActivities: [],
  pendingActivitiesCount: 0,
};

const parseDate = (date: any): Date | null => {
  if (!date) return null;

  try {
    if (date?.toDate && typeof date.toDate === "function") return date.toDate();
    if (date instanceof Date) return date;
    if (typeof date === "number") return new Date(date);
    if (typeof date === "string") {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (date?.seconds) return new Date(date.seconds * 1000);
  } catch (error) {
    console.error("Error parsing date:", error, date);
  }

  return null;
};

const normalizeProgramme = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const getAssignedProgrammes = (
  allowedProgrammes: Record<string, boolean> | null | undefined,
): string[] => PROGRAMME_OPTIONS.filter((programme) => allowedProgrammes?.[programme] === true);

const getNumberField = (obj: Record<string, any>, ...fieldNames: string[]): number => {
  for (const fieldName of fieldNames) {
    const value = obj[fieldName];
    if (value !== undefined && value !== null && value !== "") {
      const num = Number(value);
      return Number.isNaN(num) ? 0 : num;
    }
  }
  return 0;
};

// --- Components ---
const StatCard = ({ title, icon, maleCount, femaleCount, total, gradient, description }: any) => (
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
      year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: any = {
      'pending': { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      'in-progress': { color: 'bg-blue-100 text-blue-800', label: 'In Progress' },
      'completed': { color: 'bg-green-100 text-green-800', label: 'Completed' },
      'cancelled': { color: 'bg-red-100 text-red-800', label: 'Cancelled' }
    };
    const config = statusConfig[status] || statusConfig.pending;
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
              <tr key={activity.id} className="hover:bg-slate-50/50 transition-colors duration-200 group">
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                    <span className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">{activity.activityName}</span>
                  </div>
                </td>
                <td className="p-4"><Badge className="bg-blue-100 text-blue-700 border-0 shadow-sm">{formatDate(activity.date)}</Badge></td>
                <td className="p-4">{getStatusBadge(activity.status)}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-500" /><span className="text-slate-700">{activity.location}</span></div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-500" /><span className="font-semibold text-slate-900">{activity.numberOfPersons}</span></div>
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
  const { user, userRole, userAttribute, allowedProgrammes, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userIsChiefAdmin = userRole === "chief-admin";
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );

  // Dashboard View State
  const [selectedProgramme, setSelectedProgramme] = useState<string>("");

  // Dialog State
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [participantForm, setParticipantForm] = useState({ name: "", role: "" });
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeProgrammeForAdd, setActiveProgrammeForAdd] = useState<string>("");
  
  const [activityForm, setActivityForm] = useState({
    activityName: "", date: "", county: "", subcounty: "", location: "",
  });

  const assignedProgrammeOptions = useMemo(
    () => getAssignedProgrammes(allowedProgrammes),
    [allowedProgrammes]
  );
  const programmeOptions = useMemo(
    () => userIsChiefAdmin ? PROGRAMME_OPTIONS : assignedProgrammeOptions,
    [assignedProgrammeOptions, userIsChiefAdmin]
  );
  const showOverviewProgrammeSelector = programmeOptions.length > 1;

  const [localOverviewData, setLocalOverviewData] = useState<OverviewSummaryData | null>(null);
  const [localOverviewLoading, setLocalOverviewLoading] = useState(false);
  const remoteOverviewEnabled = USE_REMOTE_ANALYTICS && !!selectedProgramme && !loading;

  const overviewQuery = useQuery({
    queryKey: ["overview-analysis", user?.uid, userRole, userAttribute, selectedProgramme],
    queryFn: () =>
      fetchAnalysisSummary({
        scope: "overview",
        programme: selectedProgramme === "All" ? "All" : selectedProgramme || null,
      }),
    enabled: remoteOverviewEnabled,
    retry: 0,
    staleTime: 2 * 60 * 1000,
  });

  const shouldFetchLocalOverview = !!selectedProgramme && (!remoteOverviewEnabled || overviewQuery.isError);

  useEffect(() => {
    if (!selectedProgramme) {
      setLocalOverviewData(EMPTY_OVERVIEW_DATA);
      setLocalOverviewLoading(false);
      return;
    }

    if (!shouldFetchLocalOverview) {
      setLocalOverviewLoading(false);
      return;
    }

    let cancelled = false;

    const fetchLocalOverview = async () => {
      setLocalOverviewLoading(true);
      setLocalOverviewData(null);
      try {
        const [farmersSnap, activitiesSnap, capacitySnap] = await Promise.all([
          get(ref(db, "farmers")),
          get(ref(db, "Recent Activities")),
          get(ref(db, "capacityBuilding")),
        ]);

        if (cancelled) return;

        const requestedProgramme = normalizeProgramme(selectedProgramme);
        const includeAllProgrammes = !requestedProgramme || requestedProgramme === "ALL";

        const farmers = farmersSnap.exists()
          ? Object.entries(farmersSnap.val() as Record<string, any>).map(([id, record]) => ({ id, ...record }))
          : [];
        const activities = activitiesSnap.exists()
          ? Object.entries(activitiesSnap.val() as Record<string, any>).map(([id, record]) => ({ id, ...record }))
          : [];
        const capacity = capacitySnap.exists()
          ? Object.entries(capacitySnap.val() as Record<string, any>).map(([id, record]) => ({ id, ...record }))
          : [];

        const filteredFarmers = farmers.filter((farmer) => {
          const programme = normalizeProgramme(farmer.programme);
          return includeAllProgrammes || programme === requestedProgramme;
        });
        const filteredActivities = activities.filter((activity) => {
          const programme = normalizeProgramme(activity.programme);
          return includeAllProgrammes || programme === requestedProgramme;
        });
        const filteredCapacity = capacity.filter((record) => {
          const programme = normalizeProgramme(record.programme);
          return includeAllProgrammes || programme === requestedProgramme;
        });

        let maleFarmers = 0;
        let femaleFarmers = 0;
        let maleGoats = 0;
        let femaleGoats = 0;
        let totalGoats = 0;
        let totalSheep = 0;
        let totalCattle = 0;
        const regionMap: Record<string, number> = {};

        for (const farmer of filteredFarmers) {
          const gender = String(farmer.gender || "").trim().toLowerCase();
          if (gender === "male") maleFarmers += 1;
          else if (gender === "female") femaleFarmers += 1;

          totalGoats += getGoatTotal(farmer.goats);
          if (farmer.goats && typeof farmer.goats === "object") {
            const goatRecord = farmer.goats as Record<string, any>;
            maleGoats += getNumberField(goatRecord, "male");
            femaleGoats += getNumberField(goatRecord, "female");
          }
          totalSheep += getNumberField(farmer as Record<string, any>, "sheep");
          totalCattle += getNumberField(farmer as Record<string, any>, "cattle");

          const region = String(farmer.region || farmer.county || "Unknown").trim() || "Unknown";
          regionMap[region] = (regionMap[region] || 0) + 1;
        }

        const topRegions = Object.entries(regionMap)
          .map(([name, farmerCount]) => ({ name, farmerCount, maleFarmers: 0, femaleFarmers: 0 }))
          .sort((a, b) => b.farmerCount - a.farmerCount)
          .slice(0, 4);

        const recentActivities = [...filteredActivities]
          .sort((a, b) => (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0))
          .slice(0, 3)
          .map((record) => {
            const rawStatus = String(record.status || "pending").trim().toLowerCase();
            const status: Activity["status"] = ["pending", "in-progress", "completed", "cancelled"].includes(rawStatus)
              ? (rawStatus as Activity["status"])
              : "pending";

            return {
              id: String(record.id || ""),
              activityName: String(record.activityName || ""),
              date: String(record.date || record.createdAt || ""),
              numberOfPersons: getNumberField(record as Record<string, any>, "numberOfPersons") ||
                (Array.isArray(record.participants) ? record.participants.length : 0),
              county: String(record.county || ""),
              location: String(record.location || ""),
              participants: Array.isArray(record.participants) ? record.participants : [],
              subcounty: String(record.subcounty || ""),
              createdAt: record.createdAt || record.date || "",
              status,
              programme: record.programme ? normalizeProgramme(record.programme) : undefined,
              totalFarmers: getNumberField(record as Record<string, any>, "totalFarmers"),
            };
          });

        const pendingActivitiesCount = filteredActivities.filter(
          (activity) => String(activity.status || "").trim().toLowerCase() === "pending",
        ).length;
        const trainedFarmers = filteredCapacity.reduce(
          (sum, record) => sum + getNumberField(record as Record<string, any>, "totalFarmers", "trainedFarmers"),
          0,
        );

        if (!cancelled) {
          setLocalOverviewData({
            stats: {
              totalFarmers: filteredFarmers.length,
              maleFarmers,
              femaleFarmers,
              trainedFarmers,
              maleGoats,
              femaleGoats,
              totalGoats,
              totalSheep,
              totalCattle,
              regionsVisited: Object.keys(regionMap).length,
            },
            topRegions,
            recentActivities,
            pendingActivitiesCount,
          });
        }
      } catch (error) {
        console.error("Error building local overview data:", error);
        if (!cancelled) setLocalOverviewData(EMPTY_OVERVIEW_DATA);
      } finally {
        if (!cancelled) setLocalOverviewLoading(false);
      }
    };

    void fetchLocalOverview();

    return () => {
      cancelled = true;
    };
  }, [selectedProgramme, shouldFetchLocalOverview]);

  const overviewData =
    (overviewQuery.data as OverviewSummaryData | undefined) ?? localOverviewData ?? EMPTY_OVERVIEW_DATA;

  const calculatedStats = {
    totalFarmers: overviewData?.stats?.totalFarmers || 0,
    maleFarmers: overviewData?.stats?.maleFarmers || 0,
    femaleFarmers: overviewData?.stats?.femaleFarmers || 0,
    trainedFarmers: overviewData?.stats?.trainedFarmers || 0,
    maleGoats: overviewData?.stats?.maleGoats || 0,
    femaleGoats: overviewData?.stats?.femaleGoats || 0,
    totalGoats: overviewData?.stats?.totalGoats || 0,
    totalSheep: overviewData?.stats?.totalSheep || 0,
    totalCattle: overviewData?.stats?.totalCattle || 0,
    regionsVisited: overviewData?.stats?.regionsVisited || 0,
  };

  const regionStats = overviewData?.topRegions || [];
  const recentActivities = overviewData?.recentActivities || [];
  const pendingActivitiesCount = overviewData?.pendingActivitiesCount || 0;
  const isLoadingRemoteOverview =
    remoteOverviewEnabled &&
    !overviewQuery.isError &&
    (overviewQuery.isLoading || overviewQuery.isFetching);
  const isLoadingData = isLoadingRemoteOverview || localOverviewLoading;


  // --- Effects & Handlers ---

  useEffect(() => {
    if (!userRole) {
      setSelectedProgramme("");
      return;
    }

    if (userIsChiefAdmin && userCanViewAllProgrammeData) {
      setSelectedProgramme((prev) => (
        prev === "All" || PROGRAMME_OPTIONS.includes(prev) ? prev : "All"
      ));
      return;
    }

    if (assignedProgrammeOptions.length === 0) {
      setSelectedProgramme("");
      return;
    }

    setSelectedProgramme(assignedProgrammeOptions[0]);
  }, [assignedProgrammeOptions, userCanViewAllProgrammeData, userIsChiefAdmin, userRole]);

  const handleAddParticipant = () => {
    if (participantForm.name.trim() && participantForm.role.trim()) {
      setParticipants([...participants, { ...participantForm }]);
      setParticipantForm({ name: "", role: "" });
    }
  };

  const removeParticipant = (index: number) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };

  const handleAddActivity = async () => {
    if (!userIsChiefAdmin) {
      toast({
        title: "Access denied",
        description: "Only chief admin can create, edit, or delete records on this page.",
        variant: "destructive",
      });
      return;
    }

    if (participants.length === 0) {
      toast({ title: "Error", description: "Please add at least one participant", variant: "destructive" });
      return;
    }
    if (!activeProgrammeForAdd) {
      toast({ title: "Error", description: "Select a programme first.", variant: "destructive" });
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
      
      // Invalidate queries to trigger a refetch
      queryClient.invalidateQueries({ queryKey: ["overview-analysis"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to schedule activity.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (selectedProgramme && selectedProgramme !== "All" && PROGRAMME_OPTIONS.includes(selectedProgramme)) {
      setActiveProgrammeForAdd(selectedProgramme);
    } else if (PROGRAMME_OPTIONS.length > 0) {
      setActiveProgrammeForAdd(PROGRAMME_OPTIONS[0]);
    } else {
      setActiveProgrammeForAdd("");
    }
  }, [selectedProgramme]);

  const LoadingSkeleton = () => (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="group relative">
            <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0"><Skeleton className="w-14 h-14 rounded-xl" /></div>
                <div className="ml-5 flex-1">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-8 w-20 mb-3" />
                  <div className="flex gap-4"><Skeleton className="h-10 flex-1 rounded-lg" /><Skeleton className="h-10 flex-1 rounded-lg" /></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const topRegions = regionStats.slice(0, 4);

  if (loading) {
    return (
       <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-4 sm:p-6 flex items-center justify-center">
         <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
       </div>
    );
  }

  if (!userIsChiefAdmin && assignedProgrammeOptions.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-4 sm:p-6">
        <Card className="max-w-md mx-auto mt-20"><CardHeader><CardTitle>No Access</CardTitle></CardHeader><CardContent><p>You are not assigned to any programmes.</p></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-md font-bold text-slate-900">Dashboard Overview</h1>
            {!showOverviewProgrammeSelector && selectedProgramme && (
               <div className="flex gap-2 mt-2">
                 <Badge variant="outline" className="text-xs">{selectedProgramme}</Badge>
               </div>
            )}
          </div>
          <Link to="/dashboard/activities">
            <Button variant="outline" className="relative">
              <Bell className="h-4 w-4 mr-2" /> Activities
              {pendingActivitiesCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">{pendingActivitiesCount}</span>
              )}
            </Button>
          </Link>
        </div>

        {isLoadingData ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Programme Selector */}
            {showOverviewProgrammeSelector && (
              <div className="flex justify-center mb-6">
                <div className="w-full max-w-xs space-y-2">
                  <Label htmlFor="dashboard-overview-programme" className="text-sm font-medium text-slate-700">
                    Programme
                  </Label>
                  <Select value={selectedProgramme} onValueChange={setSelectedProgramme}>
                    <SelectTrigger id="dashboard-overview-programme" className="bg-white rounded-xl border border-slate-200 shadow-sm">
                      <SelectValue placeholder="Select programme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Programmes</SelectItem>
                      {programmeOptions.map((programme) => (
                        <SelectItem key={programme} value={programme}>
                          {programme}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StatCard title="Farmers Registered" icon={<Users className="h-7 w-7 text-blue-600" />} maleCount={calculatedStats.maleFarmers} femaleCount={calculatedStats.femaleFarmers} total={calculatedStats.totalFarmers} gradient="bg-gradient-to-br from-blue-100 to-blue-50" />
              <StatCard title="Trained Farmers" icon={<GraduationCap className="h-7 w-7 text-green-600" />} maleCount={calculatedStats.trainedMale} femaleCount={calculatedStats.trainedFemale} total={calculatedStats.trainedFarmers} gradient="bg-gradient-to-br from-green-100 to-green-50" description={`Data from ${selectedProgramme === "All" ? "All Programmes" : selectedProgramme}`} />
              <StatCard title="Animal Census" icon={<Beef className="h-7 w-7 text-orange-600" />} maleCount={calculatedStats.maleGoats} femaleCount={calculatedStats.femaleGoats} total={calculatedStats.totalGoats} gradient="bg-gradient-to-br from-orange-100 to-orange-50" />
              <div className="group relative">
                <div className="relative bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-14 h-14 bg-gradient-to-br from-purple-100 to-purple-50 rounded-xl flex items-center justify-center shadow-lg"><MapPin className="h-7 w-7 text-purple-600" /></div>
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
                                <span className="text-xs font-semibold text-slate-700 truncate">{region.name}</span>
                                <Badge className="bg-purple-100 text-purple-700 border-0 text-xs">{region.farmerCount}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {topRegions.length === 0 && <div className="mt-3 text-sm text-slate-500">No region data available</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Activities */}
            <div className="space-y-6">
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-slate-100/80 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg mr-3"><Activity className="w-4 h-4 text-white" /></div>
                      <h3 className="text-lg font-semibold text-slate-900">Recent Activities</h3>
                      {selectedProgramme !== "All" && <Badge className="ml-2 bg-blue-100 text-blue-700 border-0">{selectedProgramme}</Badge>}
                    </div>
                    <Link to="/dashboard/activities"><Button variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900">View All <ArrowRight className="h-4 w-4 ml-1" /></Button></Link>
                  </div>
                </div>

                <div className="p-6">
                  {recentActivities.length > 0 ? (
                    <>
                      <ActivityTable activities={recentActivities} />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-6 mt-6 border-t border-slate-200">
                        <Link to="/dashboard/activities"><Button variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50 font-medium px-4 py-2 rounded-xl transition-all duration-200 shadow-sm"><Eye className="h-4 w-4 mr-2" /> View All Activities</Button></Link>
                        {userIsChiefAdmin && (
                          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                            <DialogTrigger asChild><Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"><Plus className="h-4 w-4 mr-2" /> Schedule Activity</Button></DialogTrigger>
                            <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader><DialogTitle className="text-xl font-semibold text-slate-900">Schedule New Activity</DialogTitle></DialogHeader>
                            <div className="grid gap-6 py-4">
                              {userIsChiefAdmin && (
                                <div className="space-y-2">
                                  <Label htmlFor="schedule-programme-select">Programme</Label>
                                  <Select value={activeProgrammeForAdd} onValueChange={setActiveProgrammeForAdd}>
                                    <SelectTrigger id="schedule-programme-select" className="bg-white rounded-xl border border-slate-300">
                                      <SelectValue placeholder="Select programme" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PROGRAMME_OPTIONS.map((programme) => (
                                        <SelectItem key={programme} value={programme}>
                                          {programme}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2"><Label htmlFor="activityName">Activity Name</Label><Input id="activityName" value={activityForm.activityName} onChange={(e) => setActivityForm({...activityForm, activityName: e.target.value})} placeholder="Enter activity name" /></div>
                                <div className="space-y-2"><Label htmlFor="date">Date</Label><Input id="date" type="date" value={activityForm.date} onChange={(e) => setActivityForm({...activityForm, date: e.target.value})} /></div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2"><Label htmlFor="county">County</Label><Input id="county" value={activityForm.county} onChange={(e) => setActivityForm({...activityForm, county: e.target.value})} placeholder="Enter county" /></div>
                                <div className="space-y-2"><Label htmlFor="subcounty">Subcounty</Label><Input id="subcounty" value={activityForm.subcounty} onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})} placeholder="Enter subcounty" /></div>
                              </div>
                              <div className="space-y-2"><Label htmlFor="location">Location</Label><Input id="location" value={activityForm.location} onChange={(e) => setActivityForm({...activityForm, location: e.target.value})} placeholder="Enter location" /></div>
                              <div className="space-y-4 border-t pt-4">
                                <div className="flex items-center justify-between"><Label>Participants ({participants.length})</Label><span className="text-xs text-slate-500">Add participants with their roles</span></div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <Input placeholder="Participant Name" value={participantForm.name} onChange={(e) => setParticipantForm({...participantForm, name: e.target.value})} />
                                  <div className="flex gap-2">
                                    <Input placeholder="Role" value={participantForm.role} onChange={(e) => setParticipantForm({...participantForm, role: e.target.value})} />
                                    <Button type="button" onClick={handleAddParticipant} className="bg-blue-500 hover:bg-blue-600 text-white" disabled={!participantForm.name.trim() || !participantForm.role.trim()}><Plus className="h-4 w-4" /></Button>
                                  </div>
                                </div>
                                {participants.length > 0 && (
                                  <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {participants.map((participant, index) => (
                                      <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                                        <div className="flex-1"><p className="font-medium text-slate-900">{participant.name}</p><p className="text-sm text-slate-600">{participant.role}</p></div>
                                        <Button type="button" variant="ghost" size="sm" onClick={() => removeParticipant(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                              <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); setParticipants([]); setActivityForm({ activityName: "", date: "", county: "", subcounty: "", location: "" }); }}>Cancel</Button>
                              <Button onClick={handleAddActivity} disabled={participants.length === 0} className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"><Calendar className="h-4 w-4 mr-2" /> Schedule Activity</Button>
                            </div>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center p-8 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50/50">
                      <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg"><Activity className="h-8 w-8 text-white" /></div>
                      <h4 className="text-xl font-bold text-slate-800 mb-2">No activities yet</h4>
                      <p className="text-slate-600 mb-4">Start scheduling your field activities and events to see them displayed here.</p>
                      <div className="flex justify-center">
                        {userIsChiefAdmin && (
                          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                            <DialogTrigger asChild><Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"><Plus className="h-4 w-4 mr-2" /> Schedule Your First Activity</Button></DialogTrigger>
                          </Dialog>
                        )}
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

