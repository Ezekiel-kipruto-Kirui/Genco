import { useState, useEffect, useMemo } from "react";
// REALTIME DATABASE IMPORTS
import { ref, get, push, update, remove } from "firebase/database";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Filter,
  Search,
  ArrowLeft,
  MoreVertical
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

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
  status: 'pending' | 'completed';
  createdBy: string;
}

const ACTIVITIES_CACHE_KEY = cacheKey("admin-page", "activities", "recent");

const ActivitiesPage = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isParticipantsDialogOpen, setIsParticipantsDialogOpen] = useState(false);
  const [selectedActivityParticipants, setSelectedActivityParticipants] = useState<Participant[]>([]);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [participantForm, setParticipantForm] = useState({ name: "", role: "" });
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activityForm, setActivityForm] = useState({
    activityName: "",
    date: "",
    numberOfPersons: "",
    county: "",
    subcounty: "",
    location: "",
  });
  const { userRole } = useAuth();
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
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
    fetchActivities();
  }, []);

  // --- REALTIME DATABASE FETCH ---
  const fetchActivities = async () => {
    try {
      const cachedActivities = readCachedValue<Activity[]>(ACTIVITIES_CACHE_KEY);
      if (cachedActivities) {
        setActivities(cachedActivities);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const activitiesRef = ref(db, "Recent Activities");
      const snapshot = await get(activitiesRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        // Transform object from RTDB to array
        const activitiesData = Object.keys(data).map((key) => ({
          id: key,
          ...data[key]
        })) as Activity[];

        // Sort by createdAt descending (client-side sort for RTDB)
        activitiesData.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });

        setActivities(activitiesData);
        writeCachedValue(ACTIVITIES_CACHE_KEY, activitiesData);
      } else {
        setActivities([]);
        removeCachedValue(ACTIVITIES_CACHE_KEY);
      }
    } catch (error) {
      console.error("Error fetching activities:", error);
      toast({
        title: "Error",
        description: "Failed to load activities",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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

  // --- REALTIME DATABASE ADD FUNCTION ---
  const handleAddActivity = async () => {
    if (!requireChiefAdmin()) return;

    if (participants.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one participant",
        variant: "destructive",
      });
      return;
    }

    try {
      await push(ref(db, "Recent Activities"), {
        ...activityForm,
        numberOfPersons: participants.length,
        participants: participants,
        status: 'pending',
        createdBy: user?.email,
        createdAt: new Date().toISOString(), // RTDB stores dates as ISO strings
      });
      toast({
        title: "Success",
        description: "Activity scheduled successfully.",
        className: "bg-white text-slate-900 border border-slate-200"
      });
      setActivityForm({
        activityName: "",
        date: "",
        numberOfPersons: "",
        county: "",
        subcounty: "",
        location: "",
      });
      setParticipants([]);
      setIsAddDialogOpen(false);
      removeCachedValue(ACTIVITIES_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error("Error adding activity:", error);
      toast({
        title: "Error",
        description: "Failed to schedule activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  // --- REALTIME DATABASE UPDATE FUNCTION ---
  const handleEditActivity = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingActivity) return;

    try {
      await update(ref(db, "Recent Activities/" + editingActivity.id), {
        ...activityForm,
        numberOfPersons: participants.length,
        participants: participants,
      });
      toast({
        title: "Success",
        description: "Activity updated successfully.",
        className: "bg-white text-slate-900 border border-slate-200"
      });
      setEditingActivity(null);
      setIsEditDialogOpen(false);
      setActivityForm({
        activityName: "",
        date: "",
        numberOfPersons: "",
        county: "",
        subcounty: "",
        location: "",
      });
      setParticipants([]);
      removeCachedValue(ACTIVITIES_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error("Error updating activity:", error);
      toast({
        title: "Error",
        description: "Failed to update activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  // --- REALTIME DATABASE DELETE FUNCTION ---
  const handleDeleteActivity = async (activityId: string) => {
    if (!requireChiefAdmin()) return;
    try {
      await remove(ref(db, "Recent Activities/" + activityId));
      toast({
        title: "Success",
        description: "Activity deleted successfully.",
        className: "bg-white text-slate-900 border border-slate-200"
      });
      removeCachedValue(ACTIVITIES_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error("Error deleting activity:", error);
      toast({
        title: "Error",
        description: "Failed to delete activity. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (activityId: string, newStatus: Activity['status']) => {
    if (!requireChiefAdmin()) return;
    try {
      await update(ref(db, "Recent Activities/" + activityId), {
        status: newStatus
      });
      toast({
        title: "Success",
        description: `Activity marked as ${newStatus}`,
        className: "bg-white text-slate-900 border border-slate-200"
      });
      removeCachedValue(ACTIVITIES_CACHE_KEY);
      fetchActivities();
    } catch (error) {
      console.error("Error updating activity status:", error);
      toast({
        title: "Error",
        description: "Failed to update activity status",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (activity: Activity) => {
    if (!userIsChiefAdmin) return;
    setEditingActivity(activity);
    setActivityForm({
      activityName: activity.activityName,
      date: activity.date,
      numberOfPersons: activity.numberOfPersons.toString(),
      county: activity.county,
      subcounty: activity.subcounty,
      location: activity.location,
    });
    setParticipants(activity.participants || []);
    setIsEditDialogOpen(true);
  };

  const openParticipantsDialog = (participants: Participant[]) => {
    setSelectedActivityParticipants(participants);
    setIsParticipantsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      'completed': { color: 'bg-green-100 text-green-800', label: 'Completed' }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return <Badge className={`${config.color} border-0`}>{config.label}</Badge>;
  };

  const filteredActivities = activities.filter(activity => {
    const matchesStatus = filterStatus === "all" || activity.status === filterStatus;
    const matchesSearch = activity.activityName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         activity.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         activity.county.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const pendingActivitiesCount = activities.filter(activity => activity.status === 'pending').length;
  const completedActivitiesCount = activities.filter(activity => activity.status === 'completed').length;

  const formatDate = (dateString: string) => {
    if (!dateString) return 'No date';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/80 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {/* <Link to="/dashboard">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link> */}
            <div>
              <h1 className="text-md font-bold text-slate-900">Activities Management</h1>
            
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              {userIsChiefAdmin ? (<Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Schedule Activity
              </Button>) : <span className="hidden" />}
              
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold text-slate-900">
                  Schedule New Activity
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="activityName" className="text-sm font-medium text-slate-700">Activity Name</Label>
                    <Input
                      id="activityName"
                      value={activityForm.activityName}
                      onChange={(e) => setActivityForm({...activityForm, activityName: e.target.value})}
                      placeholder="Enter activity name"
                      className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date" className="text-sm font-medium text-slate-700">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={activityForm.date}
                      onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                      className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="county" className="text-sm font-medium text-slate-700">County</Label>
                    <Input
                      id="county"
                      value={activityForm.county}
                      onChange={(e) => setActivityForm({...activityForm, county: e.target.value})}
                      placeholder="Enter county"
                      className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                    <Input
                      id="subcounty"
                      value={activityForm.subcounty}
                      onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})}
                      placeholder="Enter subcounty"
                      className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location" className="text-sm font-medium text-slate-700">Location</Label>
                  <Input
                    id="location"
                    value={activityForm.location}
                    onChange={(e) => setActivityForm({...activityForm, location: e.target.value})}
                    placeholder="Enter location"
                    className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                  />
                </div>

                {/* Participants Section */}
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">Participants ({participants.length})</Label>
                    <span className="text-xs text-slate-500">Add participants with their roles</span>
                  </div>
                  
                  {/* Add Participant Form */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      placeholder="Participant Name"
                      value={participantForm.name}
                      onChange={(e) => setParticipantForm({...participantForm, name: e.target.value})}
                      className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      <Input
                        placeholder="Role"
                        value={participantForm.role}
                        onChange={(e) => setParticipantForm({...participantForm, role: e.target.value})}
                        className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                      />
                      <Button 
                        type="button" 
                        onClick={handleAddParticipant}
                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl"
                        disabled={!participantForm.name.trim() || !participantForm.role.trim()}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Participants List */}
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
                    setParticipants([]);
                  }}
                  className="rounded-xl border-slate-300 hover:border-slate-400 transition-all text-slate-700"
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

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Total Activities</p>
                  <p className="text-2xl font-bold text-slate-900">{activities.length}</p>
                </div>
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Pending</p>
                  <p className="text-2xl font-bold text-yellow-600">{pendingActivitiesCount}</p>
                </div>
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Filter className="h-5 w-5 text-yellow-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Completed</p>
                  <p className="text-2xl font-bold text-green-600">{completedActivitiesCount}</p>
                </div>
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Users className="h-5 w-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
              <Input
                placeholder="Search activities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white rounded-xl"
              />
            </div>
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 bg-white rounded-xl">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Activities Table */}
        <Card className="bg-white/95 backdrop-blur-sm">
          <CardContent className="p-0">
            {loading ? (
              // Loading skeletons for table
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
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Activity Name</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Date</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Location</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">County</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Participants</th>
                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Status</th>

                      <th className="p-4 text-left font-semibold text-slate-700 text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActivities.map((activity) => (
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
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-slate-500" />
                            <span className="text-slate-700">{activity.location}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-slate-700">{activity.county}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-slate-500" />
                            <span className="font-semibold text-slate-900 mr-2">{activity.numberOfPersons}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openParticipantsDialog(activity.participants || [])}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg text-xs"
                            >
                              View
                            </Button>
                          </div>
                        </td>
                        <td className="p-4">
                          {getStatusBadge(activity.status)}
                        </td>
                        <td className="p-4">
                           {userIsChiefAdmin && (<div className="flex gap-2">
                           
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
                                <DropdownMenuItem onClick={() => handleStatusChange(activity.id, 'completed')}>
                                  <Badge className="bg-green-100 text-green-800 mr-2">C</Badge>
                                  Mark Completed
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleStatusChange(activity.id, 'pending')}>
                                  <Badge className="bg-yellow-100 text-yellow-800 mr-2">P</Badge>
                                  Mark Pending
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteActivity(activity.id)}
                                  className="text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>)}
                          
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
                  No activities found
                </h4>
                <p className="text-slate-600 mb-4">
                  {searchTerm || filterStatus !== 'all' 
                    ? "Try adjusting your search or filter criteria"
                    : "Get started by scheduling your first activity"
                  }
                </p>
                {(searchTerm || filterStatus !== 'all') ? (
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setSearchTerm("");
                      setFilterStatus("all");
                    }}
                  >
                    Clear Filters
                  </Button>
                ) : (
                  <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                      {userIsChiefAdmin ? <Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Schedule Your First Activity
                      </Button> : <span className="hidden" />}
                    </DialogTrigger>
                  </Dialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Activity Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[700px] bg-white rounded-2xl border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900">
              Edit Activity
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-activityName" className="text-sm font-medium text-slate-700">Activity Name</Label>
                <Input
                  id="edit-activityName"
                  value={activityForm.activityName}
                  onChange={(e) => setActivityForm({...activityForm, activityName: e.target.value})}
                  placeholder="Enter activity name"
                  className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-date" className="text-sm font-medium text-slate-700">Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={activityForm.date}
                  onChange={(e) => setActivityForm({...activityForm, date: e.target.value})}
                  className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-county" className="text-sm font-medium text-slate-700">County</Label>
                <Input
                  id="edit-county"
                  value={activityForm.county}
                  onChange={(e) => setActivityForm({...activityForm, county: e.target.value})}
                  placeholder="Enter county"
                  className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subcounty" className="text-sm font-medium text-slate-700">Subcounty</Label>
                <Input
                  id="edit-subcounty"
                  value={activityForm.subcounty}
                  onChange={(e) => setActivityForm({...activityForm, subcounty: e.target.value})}
                  placeholder="Enter subcounty"
                  className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-location" className="text-sm font-medium text-slate-700">Location</Label>
              <Input
                id="edit-location"
                value={activityForm.location}
                onChange={(e) => setActivityForm({...activityForm, location: e.target.value})}
                placeholder="Enter location"
                className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500 transition-all bg-white"
              />
            </div>

            {/* Participants Section */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Participants ({participants.length})</Label>
                <span className="text-xs text-slate-500">Add participants with their roles</span>
              </div>
              
              {/* Add Participant Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Participant Name"
                  value={participantForm.name}
                  onChange={(e) => setParticipantForm({...participantForm, name: e.target.value})}
                  className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Role"
                    value={participantForm.role}
                    onChange={(e) => setParticipantForm({...participantForm, role: e.target.value})}
                    className="rounded-xl border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                  <Button 
                    type="button" 
                    onClick={handleAddParticipant}
                    className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl"
                    disabled={!participantForm.name.trim() || !participantForm.role.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Participants List */}
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
                setParticipants([]);
              }}
              className="rounded-xl border-slate-300 hover:border-slate-400 transition-all text-slate-700"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleEditActivity}
              disabled={participants.length === 0}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-xl text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
            >
              <Edit className="h-4 w-4 mr-2" />
              Update Activity
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Participants Dialog */}
      <Dialog open={isParticipantsDialogOpen} onOpenChange={setIsParticipantsDialogOpen}>
        <DialogContent className="sm:max-w-[500px] bg-white rounded-2xl border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900 flex items-center justify-between">
              <span>Participants</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsParticipantsDialogOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-slate-100 transition-colors text-slate-600"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {selectedActivityParticipants.map((participant, index) => (
              <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg p-4">
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">{participant.name}</p>
                  <p className="text-sm text-slate-600 mt-1">{participant.role}</p>
                </div>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              </div>
            ))}
            {selectedActivityParticipants.length === 0 && (
              <div className="text-center p-6 text-slate-500">
                No participants found
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ActivitiesPage;

