import { useState, useEffect, useCallback, useMemo } from "react";
// CHANGE: Import Realtime Database functions instead of Firestore
import { ref, get, set, query as rtdbQuery, orderByChild, Database } from "firebase/database";
import { db } from "@/lib/firebase"; // Ensure this is getDatabase(), not getFirestore()
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LineChart, Line } from "recharts";
import { Users, GraduationCap, Beef, Calendar, TrendingUp, Target, BarChart3, Map, Award, UserCheck, Plus, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isChiefAdmin } from "./onboardingpage";
import { useAuth } from "@/contexts/AuthContext";

const COLORS = {
  navy: "#1e3a8a",
  orange: "#f97316", 
  yellow: "#f59e0b"
};

const BAR_COLORS = [COLORS.navy, COLORS.orange, COLORS.yellow];

interface User {
  id: string;
  name: string;
  email: string;
  region: string;
  monthlyTarget: number;
}

interface UserProgress {
  id: string;
  name: string;
  email: string;
  region: string;
  farmersRegistered: number;
  monthlyTarget: number;
  progressPercentage: number;
  status: 'achieved' | 'on-track' | 'behind' | 'needs-attention';
}

const LivestockFarmersAnalytics = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [allFarmers, setAllFarmers] = useState<any[]>([]);
  const [trainingRecords, setTrainingRecords] = useState<any[]>([]);
  const [filteredData, setFilteredData] = useState<any[]>([]);
  const [genderData, setGenderData] = useState<any[]>([]);
  const [regionData, setRegionData] = useState<any[]>([]);
  const [goatsData, setGoatsData] = useState<any[]>([]);
  const [trainingComparisonData, setTrainingComparisonData] = useState<any[]>([]);
  const [trainingTrendData, setTrainingTrendData] = useState<any[]>([]);
  const [regionalPerformanceData, setRegionalPerformanceData] = useState<any[]>([]);
  const [topRegions, setTopRegions] = useState<string[]>([]);
  const [stats, setStats] = useState({ 
    total: 0, 
    trained: 0, 
    totalAnimals: 0,
    trainingRate: 0,
    maleFarmers: 0,
    femaleFarmers: 0,
    totalTrainedFromCapacity: 0
  });
  const [dateRange, setDateRange] = useState({
    startDate: "",
    endDate: ""
  });
  const [timeFrame, setTimeFrame] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  
  // User assignment state
  const [users, setUsers] = useState<User[]>([]);
  const [allAvailableUsers, setAllAvailableUsers] = useState<User[]>([]);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    userId: "",
    name: "",
    email: "",
    region: "",
    monthlyTarget: 117
  });

  // Helper to convert RTDB snapshot to array
  const snapshotToArray = (snapshot: any) => {
    if (!snapshot.exists()) return [];
    const data = snapshot.val();
    return Object.keys(data).map((key) => ({
      id: key,
      ...data[key]
    }));
  };

  // Function to fetch all available users
  const fetchAllAvailableUsers = async (): Promise<User[]> => {
    try {
      // CHANGE: Use RTDB get() and ref()
      const usersSnapshot = await get(ref(db, "users"));
      
      if (usersSnapshot.exists()) {
        const usersData = snapshotToArray(usersSnapshot).map((user: any) => ({
          id: user.id,
          name: user.name || user.displayName || user.email?.split('@')[0] || 'Unknown User',
          email: user.email || '',
          region: user.region || user.assignedRegion || '',
          monthlyTarget: user.monthlyTarget || 117
        })).filter((user: User) => user.email); 
        
        return usersData;
      }
      
      // If no users found, return mock users (kept from original logic)
      console.log("No users found in Database, using mock data");
      return [];
      
    } catch (error) {
      console.error("Error fetching users:", error);
      return [];
    }
  };

  // Function to fetch assigned users (users with regions)
  const fetchAssignedUsers = async (): Promise<User[]> => {
    try {
      // CHANGE: Use RTDB get() and ref()
      const assignedUsersSnapshot = await get(ref(db, "users"));
      
      if (assignedUsersSnapshot.exists()) {
        const allUsers = snapshotToArray(assignedUsersSnapshot);
        // Filter manually since RTDB queries for "!=" are tricky/limited compared to Firestore
        return allUsers
          .map((u: any) => ({
            id: u.id,
            name: u.name || u.displayName || u.email?.split('@')[0] || 'Unknown User',
            email: u.email || '',
            region: u.region || u.assignedRegion || '',
            monthlyTarget: u.monthlyTarget || 117
          }))
          .filter((u: User) => u.region && u.region.trim() !== "");
      }
      return [];
    } catch (error) {
      console.error("Error fetching assigned users:", error);
      return [];
    }
  };

  // Fetch all data on component mount
  useEffect(() => {
    fetchAllData();
  }, []);

  // Apply filters whenever dateRange changes
  useEffect(() => {
    if (allFarmers.length > 0 && trainingRecords.length > 0) {
      applyFilters();
    }
  }, [dateRange, allFarmers, trainingRecords, timeFrame]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      
      // CHANGE: Use RTDB get() and ref() for all collections
      const [farmersSnapshot, trainingSnapshot, availableUsers, assignedUsers] = await Promise.all([
        get(ref(db, "Livestock Farmers")),
        get(ref(db, "Capacity Building")),
        fetchAllAvailableUsers(),
        fetchAssignedUsers()
      ]);

      const farmersData = farmersSnapshot.exists() ? snapshotToArray(farmersSnapshot) : [];
      const trainingData = trainingSnapshot.exists() ? snapshotToArray(trainingSnapshot) : [];

      setAllFarmers(farmersData);
      setTrainingRecords(trainingData);
      setAllAvailableUsers(availableUsers);
      setUsers(assignedUsers);
      
    } catch (error) {
      console.error("Error fetching data:", error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  // Function to check if a farmer is trained (exists in Capacity Building)
  const isFarmerTrained = (farmer: any): boolean => {
    if (!farmer.phone && !farmer.phoneNo && !farmer.Phone && !farmer.name && !farmer.Name) return false;
    
    // Check if farmer exists in training records by phone number or name
    return trainingRecords.some(record => {
      const recordPhone = record.Phone?.toString().trim();
      const recordName = record.Name?.toString().toLowerCase().trim();
      
      const farmerPhone = (farmer.phone || farmer.phoneNo || farmer.Phone)?.toString().trim();
      const farmerName = (farmer.name || farmer.Name)?.toString().toLowerCase().trim();
      
      return (
        (recordPhone && farmerPhone && recordPhone === farmerPhone) ||
        (recordName && farmerName && recordName === farmerName)
      );
    });
  };

  const getTotalTrainedFromCapacityBuilding = (): number => {
    return trainingRecords.length;
  };

  const getCurrentWeekDates = () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay()));
    
    return {
      startDate: startOfWeek.toISOString().split('T')[0],
      endDate: endOfWeek.toISOString().split('T')[0]
    };
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
        // RTDB often stores dates as numbers (milliseconds)
        return new Date(date);
      } else if (date.seconds) {
        return new Date(date.seconds * 1000);
      }
    } catch (error) {
      console.error('Error parsing date:', error);
    }
    return null;
  };

  const isDateInRange = (date: any, startDate: string, endDate: string): boolean => {
    if (!startDate && !endDate) return true;
    
    const farmerDate = parseDate(date);
    if (!farmerDate) return false;

    const farmerDateOnly = new Date(farmerDate);
    farmerDateOnly.setHours(0, 0, 0, 0);

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);

    if (start && farmerDateOnly < start) return false;
    if (end && farmerDateOnly > end) return false;
    
    return true;
  };

  const applyFilters = () => {
    const filtered = allFarmers.filter(farmer => 
      isDateInRange(
        farmer.dateSubmitted || farmer.createdAt || farmer.date, 
        dateRange.startDate, 
        dateRange.endDate
      )
    );

    setFilteredData(filtered);
    updateAnalytics(filtered);
  };

  const updateAnalytics = (data: any[]) => {
    // Gender distribution
    const male = data.filter(f => 
      String(f.gender || f.Gender).toLowerCase() === 'male'
    ).length;
    const female = data.filter(f => 
      String(f.gender || f.Gender).toLowerCase() === 'female'
    ).length;

    const trained = data.filter(farmer => isFarmerTrained(farmer)).length;
    const totalTrainedFromCapacity = getTotalTrainedFromCapacityBuilding();
    
    const notTrained = data.length - trained;
    const trainingRate = data.length > 0 ? (trained / data.length) * 100 : 0;

    // Animal census
    let totalMaleGoats = 0;
    let totalFemaleGoats = 0;
    data.forEach(farmer => {
      totalMaleGoats += parseInt(farmer.goatsMale || farmer.GoatsMale || farmer.maleGoats || 0);
      totalFemaleGoats += parseInt(farmer.goatsFemale || farmer.GoatsFemale || farmer.femaleGoats || 0);
    });
    const totalAnimals = totalMaleGoats + totalFemaleGoats;

    setStats({ 
      total: data.length, 
      trained, 
      totalAnimals,
      trainingRate,
      maleFarmers: male,
      femaleFarmers: female,
      totalTrainedFromCapacity
    });

    setGenderData([
      { name: "Male", value: male, color: COLORS.navy },
      { name: "Female", value: female, color: COLORS.orange },
    ]);

    setGoatsData([
      { name: "Male Goats", value: totalMaleGoats, color: COLORS.navy },
      { name: "Female Goats", value: totalFemaleGoats, color: COLORS.yellow },
    ]);

    const comparisonData = [
      { name: "Trained", value: trained > 0 ? trained : 1, color: COLORS.yellow },
      { name: "Not Trained", value: notTrained > 0 ? notTrained : 1, color: COLORS.orange },
    ];
    setTrainingComparisonData(comparisonData);

    const monthlyTraining = generateMonthlyTrainingData();
    setTrainingTrendData(monthlyTraining);

    const { weeklyData, regions } = generateRegionalPerformanceData(data);
    setRegionalPerformanceData(weeklyData);
    setTopRegions(regions);

    const regionCount: Record<string, number> = {};
    data.forEach(farmer => {
      const region = String(farmer.region || farmer.Region || farmer.location || "Unknown");
      regionCount[region] = (regionCount[region] || 0) + 1;
    });
    
    const regionChartData = Object.entries(regionCount)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    setRegionData(regionChartData);
  };

  const generateMonthlyTrainingData = () => {
    const monthlyCount: Record<string, number> = {};
    
    trainingRecords.forEach(record => {
      const date = parseDate(record.date || record.timestamp);
      if (date) {
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyCount[monthYear] = (monthlyCount[monthYear] || 0) + 1;
      }
    });

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData = months.map((month, index) => {
      const monthKey = `2024-${String(index + 1).padStart(2, '0')}`;
      return {
        name: month,
        trained: monthlyCount[monthKey] || 0,
      };
    });

    return monthlyData;
  };

  const generateRegionalPerformanceData = (data: any[]) => {
    const regionCount: Record<string, number> = {};
    data.forEach(farmer => {
      const region = String(farmer.region || farmer.Region || farmer.location || "Unknown").trim();
      if (region && region !== "Unknown") {
        regionCount[region] = (regionCount[region] || 0) + 1;
      }
    });

    const topRegions = Object.entries(regionCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([region]) => region);

    const weeklyData = [];
    
    for (let week = 1; week <= 4; week++) {
      const weekData: any = { name: `W${week}` };
      
      topRegions.forEach(region => {
        const regionData = data.filter(farmer => {
          const farmerRegion = String(farmer.region || farmer.Region || farmer.location || "Unknown").trim();
          if (farmerRegion !== region) return false;
          
          const farmerDate = parseDate(farmer.dateSubmitted || farmer.createdAt || farmer.date);
          if (!farmerDate) return false;
          
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - ((4 - week) * 7));
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          
          return farmerDate >= weekStart && farmerDate <= weekEnd;
        });

        const totalFarmers = regionData.length;
        const trainedFarmers = regionData.filter(farmer => isFarmerTrained(farmer)).length;
        const performance = totalFarmers > 0 ? Math.round((trainedFarmers / totalFarmers) * 100) : 0;
        
        weekData[region] = performance;
        weekData[`${region}_farmers`] = totalFarmers;
        weekData[`${region}_trained`] = trainedFarmers;
      });
      
      weeklyData.push(weekData);
    }

    return { weeklyData, regions: topRegions };
  };

  const userProgressData = useMemo(() => {
    const usersWithRegions = users.filter(user => user.region && user.region.trim() !== '');
    
    const userProgressData: UserProgress[] = usersWithRegions.map(user => {
      const farmersRegistered = filteredData.filter(farmer => 
        farmer.region === user.region || farmer.Region === user.region
      ).length;

      const monthlyTarget = user.monthlyTarget || 117;
      const progressPercentage = (farmersRegistered / monthlyTarget) * 100;
      
      let status: UserProgress['status'] = 'needs-attention';
      if (progressPercentage >= 100) {
        status = 'achieved';
      } else if (progressPercentage >= 75) {
        status = 'on-track';
      } else if (progressPercentage >= 50) {
        status = 'behind';
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        region: user.region,
        farmersRegistered,
        monthlyTarget,
        progressPercentage,
        status
      };
    }).sort((a, b) => b.progressPercentage - a.progressPercentage);

    return userProgressData;
  }, [users, filteredData]);

  const handleDateRangeChange = (key: string, value: string) => {
    setDateRange(prev => ({ ...prev, [key]: value }));
  };

  const setWeekFilter = () => {
    const weekDates = getCurrentWeekDates();
    setDateRange(weekDates);
  };

  const setMonthFilter = () => {
    const monthDates = getCurrentMonthDates();
    setDateRange(monthDates);
  };

  const clearFilters = () => {
    setDateRange({ startDate: "", endDate: "" });
  };

  const setTimeFrameFilter = (frame: 'weekly' | 'monthly' | 'yearly') => {
    setTimeFrame(frame);
  };

  const handleUserFormChange = (field: string, value: string) => {
    setUserForm(prev => ({
      ...prev,
      [field]: value
    }));

    if (field === "userId" && value) {
      const selectedUser = allAvailableUsers.find(user => user.id === value);
      if (selectedUser) {
        setUserForm(prev => ({
          ...prev,
          userId: value,
          name: selectedUser.name,
          email: selectedUser.email
        }));
      }
    }
  };

  const handleAddUser = async () => {
    try {
      if (!userForm.userId || !userForm.region) {
        toast({
          title: "Validation Error",
          description: "Please select a user and assign a region",
          variant: "destructive",
        });
        return;
      }

      const selectedUserData = allAvailableUsers.find(user => user.id === userForm.userId);
      if (!selectedUserData) {
        toast({
          title: "Error",
          description: "Selected user not found",
          variant: "destructive",
        });
        return;
      }

      const userData = {
        name: selectedUserData.name,
        email: selectedUserData.email,
        region: userForm.region,
        monthlyTarget: userForm.monthlyTarget,
        updatedAt: new Date().toISOString() // RTDB prefers ISO strings or numbers
      };

      // CHANGE: Use RTDB set() and ref()
      if (selectedUser) {
        await set(ref(db, `users/${selectedUser.id}`), userData);
        toast({
          title: "Success",
          description: "User assignment updated successfully",
        });
      } else {
        await set(ref(db, `users/${userForm.userId}`), userData);
        toast({
          title: "Success",
          description: "User assigned to region successfully",
        });
      }

      setUserForm({
        userId: "",
        name: "",
        email: "",
        region: "",
        monthlyTarget: 117
      });
      setSelectedUser(null);
      setIsUserDialogOpen(false);
      fetchAllData();
    } catch (error) {
      console.error("Error saving user assignment:", error);
      toast({
        title: "Error",
        description: "Failed to assign user to region",
        variant: "destructive",
      });
    }
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setUserForm({
      userId: user.id,
      name: user.name,
      email: user.email,
      region: user.region,
      monthlyTarget: user.monthlyTarget
    });
    setIsUserDialogOpen(true);
  };

  const openAddUserDialog = () => {
    setSelectedUser(null);
    setUserForm({
      userId: "",
      name: "",
      email: "",
      region: "",
      monthlyTarget: 117
    });
    setIsUserDialogOpen(true);
  };

  const uniqueRegions = Array.from(new Set(allFarmers.map(farmer => 
    farmer.region || farmer.Region || farmer.county || farmer.County
  ).filter(Boolean)));

  const unassignedUsers = allAvailableUsers.filter(availableUser => 
    !users.some(assignedUser => assignedUser.id === availableUser.id)
  );

  const renderCustomizedLabel = useCallback(({
    cx, cy, midAngle, innerRadius, outerRadius, percent
  }: any) => {
    if (percent === 0) return null;
    
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize="12"
        fontWeight="bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  }, []);

  const StatsCard = ({ title, value, icon: Icon, description, color = "navy" }: any) => (
    <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
        color === 'navy' ? 'bg-blue-900' :
        color === 'orange' ? 'bg-orange-500' :
        color === 'yellow' ? 'bg-yellow-500' : 'bg-blue-900'
      }`}></div>
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 pl-6">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <div className={`p-2 rounded-xl ${
          color === 'navy' ? 'bg-blue-100' :
          color === 'orange' ? 'bg-orange-100' :
          color === 'yellow' ? 'bg-yellow-100' : 'bg-blue-100'
        } shadow-sm`}>
          <Icon className={`h-4 w-4 ${
            color === 'navy' ? 'text-blue-900' :
            color === 'orange' ? 'text-orange-600' :
            color === 'yellow' ? 'text-yellow-600' : 'text-blue-900'
          }`} />
        </div>
      </CardHeader>
      <CardContent className="pl-6 pb-4">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {description && (
          <p className="text-xs text-gray-500 mt-2 font-medium">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="ml-2 text-gray-600">Loading analytics data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-col justify-between items-start gap-4">
        <h1 className="text-xl font-bold text-gray-900">Livestock Farmers Analytics</h1>

        <Card className="w-full lg:w-auto border-0 shadow-lg bg-white">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row gap-4 items-end">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate" className="text-sm font-medium text-gray-700">From Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) => handleDateRangeChange("startDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate" className="text-sm font-medium text-gray-700">To Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) => handleDateRangeChange("endDate", e.target.value)}
                    className="border-gray-200 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={setWeekFilter} className="text-xs">
                  This Week
                </Button>
                <Button variant="outline" onClick={setMonthFilter} className="text-xs">
                  This Month
                </Button>
                <Button onClick={clearFilters} variant="outline" className="text-xs">
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
        <StatsCard 
          title="Total Farmers" 
          value={stats.total.toLocaleString()} 
          icon={Users}
          description={`${stats.maleFarmers} male, ${stats.femaleFarmers} female`}
          color="navy"
        />

        <StatsCard 
          title="Trained Farmers" 
          value={stats.trained.toLocaleString()} 
          icon={GraduationCap}
          description={`${stats.trainingRate.toFixed(1)}% of livestock farmers`}
          color="yellow"
        />

        <StatsCard 
          title="Animal Census" 
          value={stats.totalAnimals.toLocaleString()} 
          icon={Beef}
          description="Total goats registered"
          color="orange"
        />
      </div>

      <Card className="border-0 shadow-lg bg-white">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <UserCheck className="h-5 w-5 text-blue-600" />
              Field Officers Assignment & Progress (Monthly Target: 117 farmers)
            </CardTitle>

            {isChiefAdmin(userRole) &&
            (<Button onClick={openAddUserDialog} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Assign User
            </Button>)}
            
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto rounded-md">
            <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
              <thead className="rounded">
                <tr className="bg-blue-100 p-1 px-3">
                  <th className="py-2 px-4 text-sm text-blue-500">Field Officer</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Assigned Region</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Farmers Registered</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Monthly Target</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Progress</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Status</th>
                  <th className="py-2 px-4 text-sm text-blue-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userProgressData.map((user) => (
                  <tr key={user.id} className="border-b hover:bg-blue-50 transition-all duration-200 group text-sm">
                    <td className="py-1 px-4 text-sm text-gray-500 font-medium">{user.name}</td>
                    <td className="py-1 px-4">
                      <Badge variant="outline" className="bg-blue-50 text-blue-700">
                        {user.region}
                      </Badge>
                    </td>
                    <td className="py-1 px-4 text-sm text-gray-500 font-semibold">{user.farmersRegistered}</td>
                    <td className="py-1 px-4 text-sm text-gray-500">{user.monthlyTarget}</td>
                    <td className="py-1 px-4 text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              user.status === 'achieved' ? 'bg-green-500' :
                              user.status === 'on-track' ? 'bg-blue-500' :
                              user.status === 'behind' ? 'bg-yellow-500' :
                              'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(user.progressPercentage, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{user.progressPercentage.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="py-1 px-4">
                      <Badge 
                        className={
                          user.status === 'achieved' ? 'bg-green-100 text-green-800' :
                          user.status === 'on-track' ? 'bg-blue-100 text-blue-800' :
                          user.status === 'behind' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }
                      >
                        {user.status === 'achieved' ? 'Target Achieved' :
                         user.status === 'on-track' ? 'On Track' :
                         user.status === 'behind' ? 'Behind Schedule' :
                         'Needs Attention'}
                      </Badge>
                    </td>
                    <td className="py-1 px-4">
                      {isChiefAdmin(userRole) && ( 
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditUser(user as any)}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {userProgressData.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      No users assigned to regions yet. Click "Assign User" to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedUser ? "Edit User Assignment" : "Assign User to Region"}
            </DialogTitle>
            <DialogDescription>
              {selectedUser 
                ? "Update the region assignment and target for this user."
                : "Select a user and assign them to a region with a monthly target."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="userSelect">Select User *</Label>
              <Select 
                value={userForm.userId} 
                onValueChange={(value) => handleUserFormChange("userId", value)}
                disabled={!!selectedUser}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a user to assign" />
                </SelectTrigger>
                <SelectContent>
                  {selectedUser ? (
                    <SelectItem value={selectedUser.id}>
                      {selectedUser.name} ({selectedUser.email})
                    </SelectItem>
                  ) : (
                    unassignedUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {!selectedUser && unassignedUsers.length === 0 && (
                <p className="text-xs text-gray-500">No unassigned users available.</p>
              )}
            </div>

            {userForm.userId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="userName">User Name</Label>
                  <Input
                    id="userName"
                    value={userForm.name}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="userEmail">Email</Label>
                  <Input
                    id="userEmail"
                    type="email"
                    value={userForm.email}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="userRegion">Assigned Region *</Label>
              <Select value={userForm.region} onValueChange={(value) => handleUserFormChange("region", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a region" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueRegions.map((region) => (
                    <SelectItem key={region} value={region}>
                      {region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="monthlyTarget">Monthly Target</Label>
              <Input
                id="monthlyTarget"
                type="number"
                value={userForm.monthlyTarget}
                onChange={(e) => handleUserFormChange("monthlyTarget", e.target.value)}
                placeholder="117"
              />
              <p className="text-xs text-gray-500">Default target is 117 farmers per month</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUserDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={!userForm.userId || !userForm.region}>
              {selectedUser ? "Update" : "Assign"} User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <Users className="h-5 w-5 text-blue-900" />
              Farmers by Gender
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={genderData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                >
                  {genderData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value, "Farmers"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <GraduationCap className="h-5 w-5 text-yellow-600" />
              Training Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={trainingComparisonData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                  startAngle={90}
                  endAngle={-270}
                >
                  {trainingComparisonData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number, name) => [value, name]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center mt-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-900 text-xs">
                Total trained: {stats.totalTrainedFromCapacity}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <Beef className="h-5 w-5 text-orange-600" />
              Animal Census
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={goatsData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomizedLabel}
                  labelLine={false}
                >
                  {goatsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value.toLocaleString(), "Goats"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-md flex items-center gap-2 text-gray-800">
              <Map className="h-5 w-5 text-blue-900" />
              Regional Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={regionalPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  fontSize={11}
                  tick={{ fill: '#6b7280' }}
                />
                <YAxis 
                  fontSize={11} 
                  tick={{ fill: '#6b7280' }}
                  domain={[0, 100]}
                />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    const region = topRegions.find(reg => name === reg);
                    if (region) {
                      return [`${value}%`, `${region}`];
                    }
                    return [value, name];
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={40}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px' }}
                />
                
                {topRegions.map((region, index) => (
                  <Line
                    key={region}
                    type="monotone"
                    dataKey={region}
                    stroke={BAR_COLORS[index]}
                    strokeWidth={2}
                    dot={{ 
                      fill: BAR_COLORS[index], 
                      strokeWidth: 1, 
                      r: 3,
                      stroke: 'white'
                    }}
                    activeDot={{ 
                      r: 4, 
                      fill: BAR_COLORS[index],
                      stroke: 'white',
                      strokeWidth: 1
                    }}
                    name={region}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LivestockFarmersAnalytics;