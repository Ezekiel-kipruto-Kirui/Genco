import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getAuth } from "firebase/auth";
import { ref, set, update, remove, onValue, push, query, orderByChild, equalTo } from "firebase/database";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Users, MapPin, Eye, Calendar, Scale, Phone, CreditCard, Edit, Trash2, Weight, Upload, Loader2 } from "lucide-react";
import { toast, useToast } from "@/hooks/use-toast";
import { isChiefAdmin } from "@/contexts/authhelper";
import { cacheKey, readCachedValue, removeCachedValue, writeCachedValue } from "@/lib/data-cache";

// Types
interface OfftakeData {
  id: string;
  date: Date | string;
  farmerName: string;
  gender: string;
  idNumber: string;
  liveWeight: number[];
  carcassWeight: number[];
  location: string;
  noSheepGoats: number;
  phoneNumber: string;
  pricePerGoatAndSheep: number[];
  region: string;
  programme: string;
  subcounty: string;
  username: string;
  offtakeUserId: string;
  totalprice: number;
  createdAt: number;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  region: string;
  gender: string;
}

interface Stats {
  totalRegions: number;
  totalAnimals: number;
  totalRevenue: number;
  averageLiveWeight: number;
  averageCarcassWeight: number;
  averageRevenue: number;
  totalFarmers: number;
  totalMaleFarmers: number;
  totalFemaleFarmers: number;
  avgPricePerCarcassKg: number;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EditForm {
  date: string;
  farmerName: string;
  gender: string;
  idNumber: string;
  phoneNumber: string;
  region: string;
  location: string;
}

interface WeightEditForm {
  liveWeights: number[];
  carcassWeights: number[];
  prices: number[];
}

// Constants
const PAGE_LIMIT = 15;
const AVAILABLE_PROGRAMS = ["KPMD", "RANGE"];

// --- HELPER: Clean Number for Currency/Weight ---
const cleanNumber = (val: string): number => {
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
};

interface FilterSectionProps {
  localSearchInput: string;
  filters: Filters;
  uniqueRegions: string[];
  uniqueGenders: string[];
  onSearchChange: (value: string) => void;
  onFilterChange: (key: keyof Filters, value: string) => void;
}

const FilterSection = memo(({
  localSearchInput,
  filters,
  uniqueRegions,
  uniqueGenders,
  onSearchChange,
  onFilterChange
}: FilterSectionProps) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
    <div className="space-y-2">
      <Label htmlFor="search" className="font-semibold text-gray-700">Search</Label>
      <Input
        id="search"
        placeholder="Search farmers..."
        value={localSearchInput}
        onChange={(e) => onSearchChange(e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="region" className="font-semibold text-gray-700">Counties</Label>
      <Select value={filters.region} onValueChange={(value) => onFilterChange("region", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
          <SelectValue placeholder="Select region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">County</SelectItem>
          {uniqueRegions.slice(0, 20).map(region => (
            <SelectItem key={region} value={region}>{region}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label htmlFor="gender" className="font-semibold text-gray-700">Gender</Label>
      <Select value={filters.gender} onValueChange={(value) => onFilterChange("gender", value)}>
        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
          <SelectValue placeholder="Select gender" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Genders</SelectItem>
          {uniqueGenders.slice(0, 20).map(gender => (
            <SelectItem key={gender} value={gender}>{gender}</SelectItem>
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
        onChange={(e) => onFilterChange("startDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="endDate" className="font-semibold text-gray-700">To Date</Label>
      <Input
        id="endDate"
        type="date"
        value={filters.endDate}
        onChange={(e) => onFilterChange("endDate", e.target.value)}
        className="border-gray-300 focus:border-blue-500 bg-white"
      />
    </div>
  </div>
));


// Helper functions
const parseDate = (date: any): Date | null => {
  if (!date) return null;
  
  try {
    if (date instanceof Date) {
      return date;
    } else if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    } else if (typeof date === 'number') {
      return new Date(date);
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

const formatDateToLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateForInput = (date: any): string => {
  const parsedDate = parseDate(date);
  return parsedDate ? formatDateToLocal(parsedDate) : '';
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amount || 0);
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  return {
    startDate: formatDateToLocal(startOfMonth),
    endDate: formatDateToLocal(endOfMonth)
  };
};

const calculateAverage = (data: number[]): number => {
  if (!data || data.length === 0) return 0;
  const sum = data.reduce((acc, val) => acc + (Number(val) || 0), 0);
  return sum / data.length;
};

const calculateTotal = (data: number[]): number => {
  if (!data || data.length === 0) return 0;
  return data.reduce((acc, val) => acc + (Number(val) || 0), 0);
};

const getFarmerGroupingKey = (record: OfftakeData): string => {
  const normalizedId = String(record.idNumber || '').trim().toLowerCase();
  return normalizedId ? `id:${normalizedId}` : `record:${record.id}`;
};

const LivestockOfftakePage = () => {
  const { userRole } = useAuth();
  const { toast } = useToast();
  const auth = getAuth();
  
  // State
  const [allOfftake, setAllOfftake] = useState<OfftakeData[]>([]);
  const [filteredOfftake, setFilteredOfftake] = useState<OfftakeData[]>([]);
  
  // Local Search State (Optimization: Prevents full re-renders on every keystroke)
  const [localSearchInput, setLocalSearchInput] = useState("");
  
  // User Permissions State
  const [allowedProgrammes, setAllowedProgrammes] = useState<string[]>([]);
  const [userPermissionsLoading, setUserPermissionsLoading] = useState(true);
  
  // Logic: Admin can switch, User restricted to allowed
  const [activeProgram, setActiveProgram] = useState<string>("KPMD"); 
  
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[]>([]);
  
  // Upload Progress State
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isWeightEditDialogOpen, setIsWeightEditDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSingleDeleteDialogOpen, setIsSingleDeleteDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<OfftakeData | null>(null);
  const [editingRecord, setEditingRecord] = useState<OfftakeData | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<OfftakeData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File[] | null>(null);
  
  const currentMonth = useMemo(getCurrentMonthDates, []);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
    region: "all",
    gender: "all"
  });

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stats, setStats] = useState<Stats>({
    totalRegions: 0,
    totalAnimals: 0,
    totalRevenue: 0,
    averageLiveWeight: 0,
    averageCarcassWeight: 0,
    averageRevenue: 0,
    totalFarmers: 0,
    totalMaleFarmers: 0,
    totalFemaleFarmers: 0,
    avgPricePerCarcassKg: 0
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  });

  const [editForm, setEditForm] = useState<EditForm>({
    date: "",
    farmerName: "",
    gender: "",
    idNumber: "",
    phoneNumber: "",
    region: "",
    location: ""
  });

  const [weightEditForm, setWeightEditForm] = useState<WeightEditForm>({
    liveWeights: [],
    carcassWeights: [],
    prices: []
  });

  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const requireChiefAdmin = () => {
    if (userIsChiefAdmin) return true;
    toast({
      title: "Access denied",
      description: "Only chief admin can create, edit, or delete records on this page.",
      variant: "destructive",
    });
    return false;
  };
  const offtakeCacheKey = useMemo(
    () => cacheKey("admin-page", "livestock-offtake", activeProgram),
    [activeProgram]
  );

  // --- OPTIMIZATION: Debounce Search Input ---
  useEffect(() => {
    const delay = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: localSearchInput }));
      setPagination(prev => ({ ...prev, page: 1 }));
    }, 500); // 500ms debounce

    return () => clearTimeout(delay);
  }, [localSearchInput]);


  // --- HELPER: Parse CSV Line (Handles quotes) ---
  const parseCSVLine = (text: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };
const parseCSVFile = (file: File): Promise<any[]> => new Promise((resolve) => {
  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target?.result as string;
    const rows = text.split('\n').filter(r => r.trim() !== '');

    if (rows.length < 2) {
      toast({
        title: "Error",
        description: "CSV file is empty or invalid.",
        variant: "destructive"
      });
      resolve([]);
      return;
    }

    // ===============================
    // 1. PARSE & NORMALIZE HEADERS
    // ===============================
    const rawHeaders = parseCSVLine(rows[0]);

    const headers = rawHeaders.map(h => ({
      original: h.trim(),
      clean: h
        .trim()
        .toLowerCase()
        .replace(/\(.*?\)/g, '')   // remove (kg), (KES)
        .replace(/[^a-z0-9 ]/g, '') // remove symbols
        .replace(/\s+/g, ' ')
    }));

    const findIndex = (keys: string[]) =>
      headers.findIndex(h => keys.some(k => h.clean.includes(k)));

    // ===============================
    // 2. TRANSACTION COLUMNS
    // ===============================
    const idxDate = findIndex(['date']);
    const idxName = findIndex(['farmer name', 'name']);
    const idxGender = findIndex(['gender']);
    const idxId = findIndex(['id number', 'idnumber', 'id']);
    const idxPhone = findIndex(['phone number', 'phone']);
    const idxCounty = findIndex(['county', 'region']);
    const idxSub = findIndex(['subcounty', 'sub county']);
    const idxLoc = findIndex(['location', 'village']);
    const idxProg = findIndex(['programme']);
    const idxUser = findIndex(['username', 'user']);
    const idxUserId = findIndex(['user id', 'offtake user id']);

    // ===============================
    // 3. GOAT COLUMNS (PER ROW OR MULTI-COLUMN)
    // ===============================
    const idxLive = headers.findIndex(h => h.clean.startsWith('live weight'));
    const idxCarcass = headers.findIndex(h => h.clean.startsWith('carcass weight'));
    const idxPrice = headers.findIndex(h => h.clean.includes('price'));

    const animalColumnMap = new Map<number, { live?: number; carcass?: number; price?: number; number?: number }>();

    headers.forEach((h, i) => {
      const match = h.clean.match(/(\d+)/);
      if (!match) return;
      const num = parseInt(match[1], 10);
      if (Number.isNaN(num)) return;

      const isLive = h.clean.includes('live weight');
      const isCarcass = h.clean.includes('carcass weight') || h.clean.includes('carcass');
      const isPrice = h.clean.includes('price');
      const isGoatNo = h.clean.includes('goat') && (h.clean.includes('number') || h.clean.includes('no'));

      if (!isLive && !isCarcass && !isPrice && !isGoatNo) return;

      const existing = animalColumnMap.get(num) || {};
      if (isLive) existing.live = i;
      if (isCarcass) existing.carcass = i;
      if (isPrice) existing.price = i;
      if (isGoatNo) existing.number = i;
      animalColumnMap.set(num, existing);
    });

    const animalColumnIndices = Array.from(animalColumnMap.keys()).sort((a, b) => a - b);
    const hasMultiAnimalColumns = animalColumnIndices.length > 0;

    if (idxId === -1) {
      toast({
        title: "CSV Error",
        description: "ID Number column is missing.",
        variant: "destructive"
      });
      resolve([]);
      return;
    }

    const transactionsMap = new Map<string, any>();
    let lastTransactionKey: string | null = null;

    const buildGoatsFromRow = (cols: string[]) => {
      const goats: { live: string; carcass: string; price: string }[] = [];

      if (hasMultiAnimalColumns) {
        for (const idx of animalColumnIndices) {
          const col = animalColumnMap.get(idx);
          const liveVal = col?.live !== undefined ? cols[col.live] : '';
          const carcassVal = col?.carcass !== undefined ? cols[col.carcass] : '';
          const priceVal = col?.price !== undefined ? cols[col.price] : (idxPrice !== -1 ? cols[idxPrice] : '');

          if (![liveVal, carcassVal, priceVal].some(v => v && v.trim() !== '')) continue;

          goats.push({
            live: liveVal ? cleanNumber(liveVal).toFixed(1) : '',
            carcass: carcassVal ? cleanNumber(carcassVal).toFixed(2) : '',
            price: priceVal ? cleanNumber(priceVal).toFixed(2) : ''
          });
        }

        return goats;
      }

      const liveVal = idxLive !== -1 ? cols[idxLive] : '';
      const carcassVal = idxCarcass !== -1 ? cols[idxCarcass] : '';
      const priceVal = idxPrice !== -1 ? cols[idxPrice] : '';

      if (![liveVal, carcassVal, priceVal].some(v => v && v.trim() !== '')) return goats;

      goats.push({
        live: liveVal ? cleanNumber(liveVal).toFixed(1) : '',
        carcass: carcassVal ? cleanNumber(carcassVal).toFixed(2) : '',
        price: priceVal ? cleanNumber(priceVal).toFixed(2) : ''
      });

      return goats;
    };

    // ===============================
    // 4. PROCESS ROWS
    // ===============================
    for (let i = 1; i < rows.length; i++) {
      const cols = parseCSVLine(rows[i]);
      if (!cols || cols.every(c => !c.trim())) continue;

      const id = cols[idxId]?.trim();
      const rawDate = cols[idxDate]?.trim() || '';
      const uniqueKey = id ? `${id}_${rawDate}` : (lastTransactionKey || '');

      if (!uniqueKey) continue;

      // -------------------------------
      // CREATE TRANSACTION (ONCE)
      // -------------------------------
      if (id && !transactionsMap.has(uniqueKey)) {
        const loc = cols[idxLoc] || cols[idxCounty] || 'UNK';
        const prefix = loc.substring(0, 3).toUpperCase();
        const generatedUserId = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;

        let formattedDate = rawDate;
        const parsedDate = parseDate(rawDate);
        if (parsedDate) {
          formattedDate = parsedDate
            .toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            })
            .replace(/ /g, ' ');
        }

        transactionsMap.set(uniqueKey, {
          date: formattedDate,
          name: cols[idxName] || '',
          gender: cols[idxGender] || '',
          idNumber: id,
          phone: cols[idxPhone] || '',
          county: cols[idxCounty] || '',
          subcounty: cols[idxSub] || '',
          location: cols[idxLoc] || '',
          programme: cols[idxProg] || activeProgram,
          username:
            cols[idxUser] ||
            auth.currentUser?.displayName ||
            auth.currentUser?.email ||
            'admin',
          createdAt: Date.now(),
          offtakeUserId: idxUserId !== -1 ? cols[idxUserId] : generatedUserId,
          goats: []
        });
      }

      const transaction = transactionsMap.get(uniqueKey);
      if (!transaction) continue;

      lastTransactionKey = uniqueKey;

      // -------------------------------
      // ROW GOATS (SINGLE OR MULTI-COLUMN)
      // -------------------------------
      const goats = buildGoatsFromRow(cols);
      if (goats.length === 0) continue;

      goats.forEach(goat => transaction.goats.push(goat));
    }

    // ===============================
    // 5. FINAL RESULT
    // ===============================
    const transactions = Array.from(transactionsMap.values());

    if (transactions.length === 0) {
      toast({
        title: "No Data",
        description: "No valid transactions found.",
        variant: "destructive"
      });
      resolve([]);
    } else {
      toast({
        title: "Parsed Successfully",
        description: `Found ${transactions.length} transactions`
      });
      resolve(transactions);
    }
  };

  reader.readAsText(file);
});


  // --- Fetch User Permissions ---
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUserPermissionsLoading(false);
      return;
    }

    const userRef = ref(db, `users/${uid}`);
    
    const unsubscribe = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const programmesObj = data.allowedProgrammes || {};
        const programmesList = Object.keys(programmesObj).filter(key => programmesObj[key] === true);
        
        setAllowedProgrammes(programmesList);

        if (!userIsChiefAdmin) {
          if (programmesList.length > 0) {
             if (!programmesList.includes(activeProgram)) {
               setActiveProgram(programmesList[0]);
             }
          } else {
            console.warn("User has no allowed programmes assigned.");
          }
        }
      }
      setUserPermissionsLoading(false);
    }, (error) => {
      console.error("Error fetching user permissions:", error);
      setUserPermissionsLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid, userIsChiefAdmin, activeProgram]);

  // Data fetching
  useEffect(() => {
    if (userPermissionsLoading) return;

    const cachedOfftakes = readCachedValue<OfftakeData[]>(offtakeCacheKey);
    if (cachedOfftakes) {
      setAllOfftake(cachedOfftakes);
      setLoading(false);
    } else {
      setLoading(true);
    }
    
    const dbRef = query(ref(db, 'offtakes'), orderByChild('programme'), equalTo(activeProgram));

    const unsubscribe = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      
      if (!data) {
        setAllOfftake([]);
        removeCachedValue(offtakeCacheKey);
        setLoading(false);
        return;
      }

      const offtakeList = Object.keys(data).map((key) => {
        const item = data[key];
        
        let dateValue = item.date; 
        if (typeof dateValue === 'number') dateValue = new Date(dateValue);
        else if (typeof dateValue === 'string' && dateValue.includes('-')) {
           const d = new Date(dateValue);
           if (!isNaN(d.getTime())) dateValue = d;
        }

        const liveWeights = (item.goats || []).map((g: any) => parseFloat(g.live) || 0);
        const carcassWeights = (item.goats || []).map((g: any) => parseFloat(g.carcass) || 0);
        const prices = (item.goats || []).map((g: any) => parseFloat(g.price) || 0);

        return {
          id: key,
          date: dateValue,
          farmerName: item.name || '', 
          gender: item.gender || '',
          idNumber: item.idNumber || '',
          liveWeight: liveWeights,
          carcassWeight: carcassWeights,
          location: item.location || '',
          noSheepGoats: Number(item.totalGoats || 0),
          phoneNumber: item.phone || '', 
          pricePerGoatAndSheep: prices,
          region: item.county || '', 
          programme: item.programme || activeProgram, 
          subcounty: item.subcounty || '', 
          username: item.username || '',
          offtakeUserId: item.offtakeUserId || '',
          totalprice: Number(item.totalPrice || 0),
          createdAt: item.createdAt || Date.now()
        };
      });

      setAllOfftake(offtakeList);
      writeCachedValue(offtakeCacheKey, offtakeList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching livestock offtake data:", error);
      toast({
        title: "Error",
        description: "Failed to load livestock offtake data. You might not have permission for this programme.",
        variant: "destructive",
      });
      setLoading(false);
    });

    return () => {
       if(typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeProgram, userPermissionsLoading, toast, offtakeCacheKey]);

  // Filter application
  useEffect(() => {
    if (allOfftake.length === 0) {
      setFilteredOfftake([]);
      setStats({
        totalRegions: 0,
        totalAnimals: 0,
        totalRevenue: 0,
        averageLiveWeight: 0,
        averageCarcassWeight: 0,
        averageRevenue: 0,
        totalFarmers: 0,
        totalMaleFarmers: 0,
        totalFemaleFarmers: 0,
        avgPricePerCarcassKg: 0
      });
      return;
    }

    let filtered = allOfftake.filter(record => {
      if (filters.region !== "all" && record.region?.toLowerCase() !== filters.region.toLowerCase()) {
        return false;
      }

      if (filters.gender !== "all" && record.gender?.toLowerCase() !== filters.gender.toLowerCase()) {
        return false;
      }

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

      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const searchMatch = [
          record.farmerName, 
          record.location, 
          record.region,
          record.subcounty, 
          record.idNumber,
          record.phoneNumber,
          record.offtakeUserId
        ].some(field => field?.toLowerCase().includes(searchTerm));
        if (!searchMatch) return false;
      }

      return true;
    });

    setFilteredOfftake(filtered);
    
    const totalAnimals = filtered.reduce((sum, record) => sum + (record.noSheepGoats || 0), 0);
    const totalRevenue = filtered.reduce((sum, record) => sum + (record.totalprice || 0), 0);
    
    const uniqueRegions = new Set(filtered.map(f => f.region).filter(Boolean));

    // Count farmers by unique ID number so repeated sessions are treated as one farmer.
    const uniqueFarmersMap = new Map<string, OfftakeData>();
    filtered.forEach((record) => {
      const farmerKey = getFarmerGroupingKey(record);
      if (!uniqueFarmersMap.has(farmerKey)) {
        uniqueFarmersMap.set(farmerKey, record);
      }
    });
    const uniqueFarmers = Array.from(uniqueFarmersMap.values());
    const totalFarmers = uniqueFarmers.length;

    let totalMaleFarmers = 0;
    let totalFemaleFarmers = 0;
    uniqueFarmers.forEach(record => {
      if (record.gender?.toLowerCase() === 'male') totalMaleFarmers++;
      else if (record.gender?.toLowerCase() === 'female') totalFemaleFarmers++;
    });

    const totalLiveWeight = filtered.reduce((sum, record) => sum + calculateTotal(record.liveWeight), 0);
    const totalCarcassWeight = filtered.reduce((sum, record) => sum + calculateTotal(record.carcassWeight || []), 0);
    
    const averageLiveWeight = totalAnimals > 0 ? totalLiveWeight / totalAnimals : 0;
    const averageCarcassWeight = totalAnimals > 0 ? totalCarcassWeight / totalAnimals : 0;
    const averageRevenue = totalAnimals > 0 ? totalRevenue / totalAnimals : 0;
    const avgPricePerCarcassKg = totalCarcassWeight > 0 ? totalRevenue / totalCarcassWeight : 0;

    setStats({
      totalRegions: uniqueRegions.size,
      totalAnimals,
      totalRevenue,
      averageLiveWeight,
      averageCarcassWeight,
      averageRevenue,
      totalFarmers,
      totalMaleFarmers,
      totalFemaleFarmers,
      avgPricePerCarcassKg
    });

    const totalPages = Math.ceil(filtered.length / pagination.limit);
    const currentPage = Math.min(pagination.page, Math.max(1, totalPages));
    
    setPagination(prev => ({
      ...prev,
      page: currentPage,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1
    }));

  }, [allOfftake, filters, pagination.limit]);

  function safeTruncate(value: string | number) {
    let str = String(value);
    str = str.replace(/[^0-9.]/g, "");
    const num = Number(str);
    if (isNaN(num)) return "Invalid Number";
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString();
  }

  // --- Handlers ---

  const handleProgramChange = (program: string) => {
    setActiveProgram(program);
    setFilters({
      search: "",
      startDate: currentMonth.startDate,
      endDate: currentMonth.endDate,
      region: "all",
      gender: "all"
    });
    setLocalSearchInput(""); // Reset local search input
    setPagination(prev => ({ ...prev, page: 1 }));
    setSelectedRecords([]);
  };

  // No longer needed, handled by useEffect debounce
  // const handleSearchChange = ... 

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleExport = async () => {
    try {
      setExportLoading(true);
      
      if (filteredOfftake.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no records matching your current filters",
          variant: "destructive",
        });
        return;
      }

      const headers = [
        'Date', 'Farmer Name', 'Gender', 'ID Number', 'Programme', 'Region (County)', 
        'Subcounty', 'Location', 'Phone Number', 'Total Animals', 
        'Live Weight (kg)', 'Carcass Weight (kg)', 'Price per Animal (KES)', 'Total Price (KES)'
      ];

      const csvData = [];

      filteredOfftake.forEach(record => {
        const liveWeights = Array.isArray(record.liveWeight) ? record.liveWeight : [record.liveWeight || 0];
        const carcassWeights = Array.isArray(record.carcassWeight) ? record.carcassWeight : [record.carcassWeight || 0];
        const prices = Array.isArray(record.pricePerGoatAndSheep) ? record.pricePerGoatAndSheep : [record.pricePerGoatAndSheep || 0];

        const numAnimals = Math.max(liveWeights.length, carcassWeights.length, prices.length, record.noSheepGoats || 1);

        for (let i = 0; i < numAnimals; i++) {
          const liveWeight = liveWeights[i] !== undefined ? Number(liveWeights[i]) : null;
          const carcassWeight = carcassWeights[i] !== undefined ? Number(carcassWeights[i]) : null;
          const price = prices[i] !== undefined ? Number(prices[i]) : null;

          const row = [
            i === 0 ? formatDate(record.date) : '',
            i === 0 ? (record.farmerName || 'N/A') : '',
            i === 0 ? (record.gender || 'N/A') : '',
            i === 0 ? (record.idNumber || 'N/A') : '',
            i === 0 ? (record.programme || 'N/A') : '',
            i === 0 ? (record.region || 'N/A') : '',
            i === 0 ? (record.subcounty || 'N/A') : '',
            i === 0 ? (record.location || 'N/A') : '',
            i === 0 ? (record.phoneNumber || 'N/A') : '',
            i === 0 ? (record.noSheepGoats || 0).toString() : '',
            liveWeight !== null && liveWeight > 0 ? liveWeight.toFixed(1) : '',
            carcassWeight !== null && carcassWeight > 0 ? carcassWeight.toFixed(2) : '',
            price !== null && price > 0 ? price.toFixed(2) : '',
            i === 0 ? (record.totalprice || 0).toFixed(2) : ''
          ];
          csvData.push(row);
        }

        csvData.push(Array(headers.length).fill(''));
      });

      const totalAnimals = filteredOfftake.reduce((sum, record) => sum + (record.noSheepGoats || 0), 0);
      const totalRevenue = filteredOfftake.reduce((sum, record) => sum + (record.totalprice || 0), 0);
      const grandTotalRow = [
        `GRAND TOTALS (${filteredOfftake.length} Sessions)`, '', '', '', '', '', '', '', '', 
        totalAnimals.toString(), '', '', '', totalRevenue.toFixed(2)
      ];

      const csvContent = [headers, ...csvData, grandTotalRow]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const programLabel = userIsChiefAdmin ? activeProgram : "ASSIGNED_PROGRAMS";
      let filename = `livestock-offtake-${programLabel}`;
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
        description: `Exported detailed data for ${filteredOfftake.length} sessions`,
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

  const handleExportAggregatedByFarmer = async () => {
    try {
      setExportLoading(true);

      if (filteredOfftake.length === 0) {
        toast({
          title: "No Data to Export",
          description: "There are no records matching your current filters",
          variant: "destructive",
        });
        return;
      }

      type AggregatedFarmer = {
        idNumber: string;
        farmerName: string;
        gender: string;
        programme: string;
        region: string;
        subcounty: string;
        location: string;
        phoneNumber: string;
        sessions: number;
        totalAnimals: number;
        totalLiveWeight: number;
        totalCarcassWeight: number;
        totalRevenue: number;
      };

      const groupedFarmers = new Map<string, AggregatedFarmer>();

      filteredOfftake.forEach((record) => {
        const groupKey = getFarmerGroupingKey(record);
        const existing = groupedFarmers.get(groupKey);

        const liveWeightSum = calculateTotal(
          Array.isArray(record.liveWeight) ? record.liveWeight : [Number(record.liveWeight) || 0],
        );
        const carcassWeightSum = calculateTotal(
          Array.isArray(record.carcassWeight) ? record.carcassWeight : [Number(record.carcassWeight) || 0],
        );

        if (!existing) {
          groupedFarmers.set(groupKey, {
            idNumber: record.idNumber || 'N/A',
            farmerName: record.farmerName || 'N/A',
            gender: record.gender || 'N/A',
            programme: record.programme || 'N/A',
            region: record.region || 'N/A',
            subcounty: record.subcounty || 'N/A',
            location: record.location || 'N/A',
            phoneNumber: record.phoneNumber || 'N/A',
            sessions: 1,
            totalAnimals: Number(record.noSheepGoats) || 0,
            totalLiveWeight: liveWeightSum,
            totalCarcassWeight: carcassWeightSum,
            totalRevenue: Number(record.totalprice) || 0,
          });
          return;
        }

        existing.sessions += 1;
        existing.totalAnimals += Number(record.noSheepGoats) || 0;
        existing.totalLiveWeight += liveWeightSum;
        existing.totalCarcassWeight += carcassWeightSum;
        existing.totalRevenue += Number(record.totalprice) || 0;

        if (existing.farmerName === 'N/A' && record.farmerName) existing.farmerName = record.farmerName;
        if (existing.gender === 'N/A' && record.gender) existing.gender = record.gender;
        if (existing.phoneNumber === 'N/A' && record.phoneNumber) existing.phoneNumber = record.phoneNumber;
        if (existing.region === 'N/A' && record.region) existing.region = record.region;
        if (existing.subcounty === 'N/A' && record.subcounty) existing.subcounty = record.subcounty;
        if (existing.location === 'N/A' && record.location) existing.location = record.location;
      });

      const aggregatedFarmers = Array.from(groupedFarmers.values());

      const headers = [
        'ID Number',
        'Farmer Name',
        'Gender',
        'Programme',
        'Region (County)',
        'Subcounty',
        'Location',
        'Phone Number',
        'Sessions',
        'Total Animals',
        'Total Live Weight (kg)',
        'Total Carcass Weight (kg)',
        'Total Revenue (KES)',
      ];

      const csvRows = aggregatedFarmers.map((farmer) => [
        farmer.idNumber,
        farmer.farmerName,
        farmer.gender,
        farmer.programme,
        farmer.region,
        farmer.subcounty,
        farmer.location,
        farmer.phoneNumber,
        farmer.sessions.toString(),
        farmer.totalAnimals.toString(),
        farmer.totalLiveWeight.toFixed(1),
        farmer.totalCarcassWeight.toFixed(2),
        farmer.totalRevenue.toFixed(2),
      ]);

      const totals = aggregatedFarmers.reduce((acc, farmer) => {
        acc.sessions += farmer.sessions;
        acc.animals += farmer.totalAnimals;
        acc.liveWeight += farmer.totalLiveWeight;
        acc.carcassWeight += farmer.totalCarcassWeight;
        acc.revenue += farmer.totalRevenue;
        return acc;
      }, { sessions: 0, animals: 0, liveWeight: 0, carcassWeight: 0, revenue: 0 });

      const grandTotalRow = [
        `GRAND TOTALS (${aggregatedFarmers.length} Farmers)`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        totals.sessions.toString(),
        totals.animals.toString(),
        totals.liveWeight.toFixed(1),
        totals.carcassWeight.toFixed(2),
        totals.revenue.toFixed(2),
      ];

      const csvContent = [headers, ...csvRows, grandTotalRow]
        .map((row) => row.map((field) => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const programLabel = userIsChiefAdmin ? activeProgram : "ASSIGNED_PROGRAMS";
      let filename = `livestock-offtake-aggregated-${programLabel}`;
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
        description: `Exported aggregated data for ${aggregatedFarmers.length} unique farmers`,
      });
    } catch (error) {
      console.error("Error exporting aggregated data:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export aggregated data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setUploadFile(files);
    setUploadProgress({ current: 0, total: 0 });
    setUploadPreview([]);

    const parsedSets = await Promise.all(files.map(parseCSVFile));
    const combined = parsedSets.flat();
    setUploadPreview(combined);
  };

  // --- OPTIMIZED BULK UPLOAD HANDLER (Non-blocking) ---
  const handleUpload = async () => {
    if (!requireChiefAdmin()) return;
    if (uploadPreview.length === 0) {
      toast({ title: "Error", description: "No data to upload", variant: "destructive" });
      return;
    }

    try {
      setUploadLoading(true);
      const totalRecords = uploadPreview.length;
      setUploadProgress({ current: 0, total: totalRecords });

      // Larger batch size to reduce HTTP overhead for "millions" of records
      // 500 records per batch is usually safe for Firebase JSON payload limits
      const BATCH_SIZE = 2000; 
      let processedCount = 0;

      // Recursive function to process batches asynchronously with UI breaks
      const processBatch = async (startIndex: number) => {
        if (startIndex >= totalRecords) {
          // Finished
          setUploadLoading(false);
          setIsUploadDialogOpen(false);
          setUploadFile(null);
          setUploadPreview([]);
          setUploadProgress({ current: 0, total: 0 });
          toast({
            title: "Upload Successful",
            description: `Uploaded ${totalRecords} transactions to Firebase.`,
          });
          return;
        }

        const endIndex = Math.min(startIndex + BATCH_SIZE, totalRecords);
        const batch = uploadPreview.slice(startIndex, endIndex);
        const updates: Record<string, any> = {};

        batch.forEach(record => {
          const newKey = push(ref(db, 'offtakes')).key;
          if (!newKey) return;

          const totalGoats = record.goats.length;
          const totalPrice = record.goats.reduce((sum: number, g: any) => sum + parseFloat(g.price), 0);
          
          updates[`offtakes/${newKey}`] = {
            county: record.county,
            createdAt: record.createdAt,
            date: record.date,
            gender: record.gender,
            idNumber: record.idNumber,
            location: record.location,
            name: record.name,
            offtakeUserId: record.offtakeUserId,
            phone: record.phone,
            programme: record.programme,
            subcounty: record.subcounty,
            username: record.username,
            totalGoats: totalGoats,
            totalPrice: totalPrice,
            goats: record.goats
          };
        });

        if (Object.keys(updates).length > 0) {
          await update(ref(db), updates);
          removeCachedValue(offtakeCacheKey);
          processedCount += batch.length;
          setUploadProgress({ current: processedCount, total: totalRecords });
        }

        // Use setTimeout to allow UI to render progress bar before processing next batch
        setTimeout(() => processBatch(endIndex), 0);
      };

      // Start processing
      processBatch(0);

    } catch (error) {
      console.error("Error uploading:", error);
      setUploadLoading(false);
      toast({
        title: "Upload Failed",
        description: "Check permissions or network connection.",
        variant: "destructive"
      });
    }
  };

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => {
      const totalPages = Math.ceil(filteredOfftake.length / prev.limit);
      const validatedPage = Math.max(1, Math.min(newPage, totalPages));
      
      return {
        ...prev,
        page: validatedPage,
        hasNext: validatedPage < totalPages,
        hasPrev: validatedPage > 1
      };
    });
  }, [filteredOfftake.length]);

  const getCurrentPageRecords = useCallback(() => {
    const startIndex = (pagination.page - 1) * pagination.limit;
    const endIndex = startIndex + pagination.limit;
    return filteredOfftake.slice(startIndex, endIndex);
  }, [filteredOfftake, pagination.page, pagination.limit]);

  const handleSelectRecord = useCallback((recordId: string) => {
    setSelectedRecords(prev =>
      prev.includes(recordId)
        ? prev.filter(id => id !== recordId)
        : [...prev, recordId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = getCurrentPageRecords().map(f => f.id);
    setSelectedRecords(prev =>
      prev.length === currentPageIds.length ? [] : currentPageIds
    );
  }, [getCurrentPageRecords]);

  const openViewDialog = useCallback((record: OfftakeData) => {
    setViewingRecord(record);
    setIsViewDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((record: OfftakeData) => {
    if (!userIsChiefAdmin) return;
    setEditingRecord(record);
    setEditForm({
      date: formatDateForInput(record.date),
      farmerName: record.farmerName || "",
      gender: record.gender || "",
      idNumber: record.idNumber || "",
      phoneNumber: record.phoneNumber || "",
      region: record.region || "",
      location: record.location || ""
    });
    setIsEditDialogOpen(true);
  }, [userIsChiefAdmin]);

  const openWeightEditDialog = useCallback((record: OfftakeData) => {
    if (!userIsChiefAdmin) return;
    setEditingRecord(record);
    
    const liveWeights = Array.isArray(record.liveWeight) ? record.liveWeight : [record.liveWeight || 0];
    const carcassWeights = Array.isArray(record.carcassWeight) ? record.carcassWeight : [record.carcassWeight || 0];
    const prices = Array.isArray(record.pricePerGoatAndSheep) ? record.pricePerGoatAndSheep : [record.pricePerGoatAndSheep || 0];
    
    const numAnimals = Math.max(liveWeights.length, carcassWeights.length, prices.length, record.noSheepGoats || 1);
    
    const paddedLiveWeights = [...liveWeights];
    const paddedCarcassWeights = [...carcassWeights];
    const paddedPrices = [...prices];
    
    while (paddedLiveWeights.length < numAnimals) paddedLiveWeights.push(0);
    while (paddedCarcassWeights.length < numAnimals) paddedCarcassWeights.push(0);
    while (paddedPrices.length < numAnimals) paddedPrices.push(0);

    setWeightEditForm({
      liveWeights: paddedLiveWeights,
      carcassWeights: paddedCarcassWeights,
      prices: paddedPrices
    });
    
    setIsWeightEditDialogOpen(true);
  }, [userIsChiefAdmin]);

  const handleSingleDelete = async () => {
    if (!requireChiefAdmin()) return;
    if (!recordToDelete) return;
    try {
      setDeleteLoading(true);
      await remove(ref(db, `offtakes/${recordToDelete.id}`));
      removeCachedValue(offtakeCacheKey);

      toast({
        title: "Success",
        description: "Record deleted successfully",
      });

      setIsSingleDeleteDialogOpen(false);
      setRecordToDelete(null);
      setSelectedRecords(prev => prev.filter(id => id !== recordToDelete.id));
      
    } catch (error) {
      console.error("Error deleting record:", error);
      toast({
        title: "Error",
        description: "Failed to delete record",
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const openSingleDeleteConfirm = useCallback((record: OfftakeData) => {
    if (!userIsChiefAdmin) return;
    setRecordToDelete(record);
    setIsSingleDeleteDialogOpen(true);
  }, [userIsChiefAdmin]);

  const openBulkDeleteConfirm = () => {
    if (!requireChiefAdmin()) return;
    if (selectedRecords.length === 0) {
      toast({
        title: "No Records Selected",
        description: "Please select records to delete",
        variant: "destructive",
      });
      return;
    }
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteMultiple = async () => {
    if (!requireChiefAdmin()) return;
    if (selectedRecords.length === 0) return;
    try {
      setDeleteLoading(true);
      const updates: { [key: string]: null } = {};
      selectedRecords.forEach(recordId => {
        updates[`offtakes/${recordId}`] = null;
      });
      await update(ref(db), updates);
      removeCachedValue(offtakeCacheKey);

      toast({ title: "Success", description: `Deleted ${selectedRecords.length} records.` });
      setSelectedRecords([]);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingRecord) return;

    try {
      await update(ref(db, `offtakes/${editingRecord.id}`), {
        date: editForm.date ? new Date(editForm.date).toISOString() : null,
        name: editForm.farmerName,
        gender: editForm.gender,
        idNumber: editForm.idNumber,
        phone: editForm.phoneNumber,
        county: editForm.region,
        location: editForm.location
      });
      removeCachedValue(offtakeCacheKey);

      toast({ title: "Success", description: "Record updated successfully" });
      setIsEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      console.error("Error updating record:", error);
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  };

  const handleWeightEditSubmit = async () => {
    if (!requireChiefAdmin()) return;
    if (!editingRecord) return;

    try {
      const filteredLiveWeights = weightEditForm.liveWeights.filter(w => w > 0);
      const filteredCarcassWeights = weightEditForm.carcassWeights.filter(w => w > 0);
      const filteredPrices = weightEditForm.prices.filter(p => p > 0);

      const newGoatsArray = filteredLiveWeights.map((live, index) => ({
        live: String(live.toFixed(1)),
        carcass: String(filteredCarcassWeights[index]?.toFixed(2) || "0.00"),
        price: String(filteredPrices[index]?.toFixed(2) || "0.00")
      }));

      const newTotalPrice = filteredPrices.reduce((sum, price) => sum + price, 0);

      await update(ref(db, `offtakes/${editingRecord.id}`), {
        goats: newGoatsArray,
        totalGoats: newGoatsArray.length,
        totalPrice: newTotalPrice
      });
      removeCachedValue(offtakeCacheKey);

      toast({ title: "Success", description: "Weights and prices updated" });
      setIsWeightEditDialogOpen(false);
      setEditingRecord(null);
    } catch (error) {
      console.error("Error updating weights:", error);
      toast({ title: "Error", description: "Failed to update weights", variant: "destructive" });
    }
  };

  const uniqueRegions = useMemo(() => {
    const regions = [...new Set(allOfftake.map(f => f.region).filter(Boolean))];
    return regions;
  }, [allOfftake]);

  const uniqueGenders = useMemo(() => {
    const genders = [...new Set(allOfftake.map(f => f.gender).filter(Boolean))];
    return genders;
  }, [allOfftake]);

  const currentPageRecords = useMemo(getCurrentPageRecords, [getCurrentPageRecords]);

  const clearAllFilters = useCallback(() => {
    setFilters({
      search: "",
      startDate: "",
      endDate: "",
      region: "all",
      gender: "all"
    });
    setLocalSearchInput(""); // Reset local input
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const resetToCurrentMonth = useCallback(() => {
    setFilters(prev => ({
        ...prev,
        startDate: currentMonth.startDate,
        endDate: currentMonth.endDate
    }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [currentMonth]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const availableProgramsForSelect = useMemo(() => {
    if (userIsChiefAdmin) {
      return AVAILABLE_PROGRAMS;
    }
    return allowedProgrammes.length > 0 ? allowedProgrammes : [];
  }, [userIsChiefAdmin, allowedProgrammes]);

  const StatsCard = useMemo(() => ({ title, value, icon: Icon, description, subValue }: any) => (
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
          <div className="text-xl font-bold text-green-500 mb-2">{value}</div>
          {subValue && <div className="text-sm font-medium text-slate-600 mb-2">{subValue}</div>}
          {description && <p className="text-[10px] mt-2 bg-orange-50 px-2 py-1 rounded-md border border-slate-100">{description}</p>}
        </div>
      </CardContent>
    </Card>
  ), []);

  const handleLocalSearchChange = useCallback((value: string) => {
    setLocalSearchInput(value);
  }, []);


  const TableRow = useMemo(() => ({ record }: { record: OfftakeData }) => {
    const avgLiveWeight = calculateAverage(record.liveWeight);
    const avgPrice = calculateAverage(record.pricePerGoatAndSheep);
    
    return (
      <tr className="border-b hover:bg-blue-50 transition-all duration-200 group text-sm">
        <td className="py-1 px-4">
          <Checkbox
            checked={selectedRecords.includes(record.id)}
            onCheckedChange={() => handleSelectRecord(record.id)}
          />
        </td>
        <td className="py-1 px-6 text-xs">{formatDate(record.date)}</td>
        <td className="py-1 px-6 text-xs">{record.farmerName || 'N/A'}</td>
        <td className="py-1 px-6 text-xs">{record.gender || 'N/A'}</td>
        <td className="py-1 px-6 text-xs">
          <code className="text-sm bg-gray-100 px-2 py-1 rounded text-gray-700">
            {record.idNumber || record.offtakeUserId || 'N/A'}
          </code>
        </td>
        <td className="py-1 px-6 text-xs">{record.region || 'N/A'}</td>
         <td className="py-1 px-6 text-xs">{record.subcounty || 'N/A'}</td>
          <td className="py-1 px-6 text-xs">{record.location || 'N/A'}</td>
        <td className="py-1 px-6 text-xs font-bold">{record.noSheepGoats || 0}</td>
        <td className="py-1 px-6 text-xs font-bold text-green-600">{formatCurrency(record.totalprice || 0)}</td>
        <td className="py-1 px-6 text-xs">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => openViewDialog(record)} className="h-8 w-8 p-0 hover:bg-green-100 hover:text-green-600 border-green-200">
              <Eye className="h-4 w-4 text-green-500" />
            </Button>
            {isChiefAdmin(userRole) && (
              <>
                <Button variant="outline" size="sm" onClick={() => openEditDialog(record)} className="h-8 w-8 p-0 hover:bg-yellow-100 border-white">
                  <Edit className="h-4 w-4 text-orange-500" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => openSingleDeleteConfirm(record)} className="h-8 w-8 p-0 hover:bg-red-100 hover:text-red-600 border-white">
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  }, [selectedRecords, handleSelectRecord, openViewDialog, openEditDialog, openSingleDeleteConfirm, userRole]);

  return (
    <div className="space-y-6">
      <div className="flex md:flex-row flex-col justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
            <h2 className="text-md font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Livestock Offtake Data
            </h2>
            <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-bold px-3 py-1 w-fit">
                    {userIsChiefAdmin ? `${activeProgram} PROGRAMME` : activeProgram}
                </Badge>
            </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
            {availableProgramsForSelect.length > 0 && (
                <div className="mr-4">
                    <Select value={activeProgram} onValueChange={handleProgramChange} disabled={userPermissionsLoading || (!userIsChiefAdmin && availableProgramsForSelect.length === 1)}>
                        <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white w-[140px]">
                            {userPermissionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
                        </SelectTrigger>
                        <SelectContent>
                            {availableProgramsForSelect.map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

          {selectedRecords.length > 0 && isChiefAdmin(userRole) && (
            <Button variant="destructive" size="sm" onClick={openBulkDeleteConfirm} disabled={deleteLoading} className="text-xs">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete ({selectedRecords.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={clearAllFilters} className="text-xs border-gray-300 hover:bg-gray-50">
            Clear Filters
          </Button>
          <Button variant="outline" size="sm" onClick={resetToCurrentMonth} className="text-xs border-gray-300 hover:bg-gray-50">
            This Month
          </Button>
          
          {/* Upload Button */}
          <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)} className="text-xs border-gray-300 hover:bg-blue-50 hover:text-blue-600">
            <Upload className="h-4 w-4 mr-2" />
            Upload Data
          </Button>

          {isChiefAdmin(userRole) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={exportLoading || filteredOfftake.length === 0} className="bg-gradient-to-r from-blue-800 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-md text-xs">
                  <Download className="h-4 w-4 mr-2" />
                  {exportLoading ? "Exporting..." : `Export (${filteredOfftake.length})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onSelect={() => handleExport()} disabled={exportLoading}>
                  <Download className="h-4 w-4 mr-2" />
                  Export Detailed Data
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExportAggregatedByFarmer()} disabled={exportLoading}>
                  <Users className="h-4 w-4 mr-2" />
                  Export Summed by Farmer ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard 
          title="TOTAL FARMERS" 
          value={stats.totalFarmers.toLocaleString()} 
          icon={Users} 
          description={`${stats.totalMaleFarmers} Males | ${stats.totalFemaleFarmers} Females`} 
        />
        <StatsCard title="TOTAL ANIMALS" value={stats.totalAnimals.toLocaleString()} icon={Scale} description={`Avg Live: ${stats.averageLiveWeight.toFixed(1)}kg | Avg Carcass: ${stats.averageCarcassWeight.toFixed(1)}kg`} />
        <StatsCard 
          title="TOTAL REVENUE" 
          value={safeTruncate(formatCurrency(stats.totalRevenue))} 
          icon={CreditCard} 
          description={`Avg Price per Goat: ${formatCurrency(stats.averageRevenue)} | Avg per Kg: ${formatCurrency(stats.avgPricePerCarcassKg)}`} 
        />
      </div>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="space-y-4 pt-6">
          <FilterSection localSearchInput={localSearchInput} filters={filters} uniqueRegions={uniqueRegions} uniqueGenders={uniqueGenders} onSearchChange={handleLocalSearchChange} onFilterChange={handleFilterChange} />
        </CardContent>
      </Card>

      <Card className="shadow-lg border-0 bg-white">
        <CardContent className="p-0">
          {loading || userPermissionsLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-muted-foreground mt-2">Loading data...</p>
            </div>
          ) : currentPageRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {allOfftake.length === 0 ? "No data found in database" : "No records found matching your criteria"}
            </div>
          ) : (
            <>
              <div className="w-full overflow-x-auto rounded-md">
                <table className="w-full border-collapse border border-gray-300 text-sm text-left whitespace-nowrap">
                  <thead className="rounded">
                    <tr className="bg-blue-100 p-1 px-3">
                      <th className="py-2 px-4">
                        <Checkbox checked={selectedRecords.length === currentPageRecords.length && currentPageRecords.length > 0} onCheckedChange={handleSelectAll} />
                      </th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Date</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Farmer Name</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Gender</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">ID No</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">County</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Sub County</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Village</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">No.Animals</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Total Price</th>
                      <th className="text-left py-2 px-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageRecords.map((record) => (
                      <TableRow key={record.id} record={record} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <div className="text-sm text-muted-foreground">
                  {filteredOfftake.length} total records • Page {pagination.page} of {pagination.totalPages}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => handlePageChange(pagination.page - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => handlePageChange(pagination.page + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-4xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Eye className="h-5 w-5 text-green-600" />
              Livestock Offtake Details
            </DialogTitle>
          </DialogHeader>
          {viewingRecord && (
            <div className="space-y-6 py-4 overflow-y-auto max-h-[60vh]">
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Weight className="h-4 w-4" />
                    Animal Details Table
                  </h3>
                  {isChiefAdmin(userRole) && (
                    <Button variant="outline" size="sm" onClick={() => openWeightEditDialog(viewingRecord)}>
                      <Edit className="h-4 w-4 mr-2" /> Edit Weights
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-gray-300 text-sm">
                    <thead>
                      <tr className="bg-blue-100">
                        <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Animal #</th>
                        <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Live Weight (kg)</th>
                        <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Carcass Weight (kg)</th>
                        <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Price (Ksh)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingRecord.liveWeight.map((_, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="border border-gray-300 py-2 px-3 font-medium">Animal {index + 1}</td>
                          <td className="border border-gray-300 py-2 px-3">{viewingRecord.liveWeight[index]?.toFixed(1)}</td>
                          <td className="border border-gray-300 py-2 px-3">{viewingRecord.carcassWeight[index]?.toFixed(2) || 'N/A'}</td>
                          <td className="border border-gray-300 py-2 px-3 font-medium text-green-700">{formatCurrency(viewingRecord.pricePerGoatAndSheep[index] || 0)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-100 font-semibold">
                        <td className="border border-gray-300 py-2 px-3">Total</td>
                        <td className="border border-gray-300 py-2 px-3">{calculateTotal(viewingRecord.liveWeight).toFixed(1)} kg</td>
                        <td className="border border-gray-300 py-2 px-3">{calculateTotal(viewingRecord.carcassWeight).toFixed(2)} kg</td>
                        <td className="border border-gray-300 py-2 px-3 text-green-700">{formatCurrency(calculateTotal(viewingRecord.pricePerGoatAndSheep))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  Transaction Summary
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <Label className="text-sm font-medium text-slate-600 block mb-2">PROJECT</Label>
                    <p className="text-slate-900 font-bold text-xl text-blue-600">{viewingRecord.programme || 'N/A'}</p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <Label className="text-sm font-medium text-slate-600 block mb-2">Total Animals</Label>
                    <p className="text-slate-900 font-medium text-2xl font-bold text-blue-600">{viewingRecord.noSheepGoats}</p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg p-4 text-center">
                    <Label className="text-sm font-medium text-slate-600 block mb-2">Total Value</Label>
                    <p className="text-slate-900 font-medium text-2xl font-bold text-green-600">{formatCurrency(viewingRecord.totalprice)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Farmer Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Farmer Name</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.farmerName}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Gender</Label>
                    <Badge className={viewingRecord.gender?.toLowerCase() === 'male' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'}>{viewingRecord.gender}</Badge>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">ID Number</Label>
                    <p className="text-slate-900 font-medium font-mono">{viewingRecord.idNumber}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Phone Number</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.phoneNumber}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">County</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.region}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Subcounty</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.subcounty}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Location</Label>
                    <p className="text-slate-900 font-medium">{viewingRecord.location}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Date</Label>
                    <p className="text-slate-900 font-medium">{formatDate(viewingRecord.date)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIsViewDialogOpen(false)} className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Edit className="h-5 w-5 text-blue-600" />
              Edit Record Data
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date">Date</Label>
                <Input id="edit-date" type="date" value={editForm.date} onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))} className="bg-white border-slate-300" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-farmerName">Farmer Name</Label>
                <Input id="edit-farmerName" value={editForm.farmerName} onChange={(e) => setEditForm(prev => ({ ...prev, farmerName: e.target.value }))} className="bg-white border-slate-300" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-gender">Gender</Label>
                <Select value={editForm.gender} onValueChange={(value) => setEditForm(prev => ({ ...prev, gender: value }))}>
                  <SelectTrigger className="bg-white border-slate-300"><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-idNumber">ID Number</Label>
                <Input id="edit-idNumber" value={editForm.idNumber} onChange={(e) => setEditForm(prev => ({ ...prev, idNumber: e.target.value }))} className="bg-white border-slate-300" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                <Label htmlFor="edit-phoneNumber">Phone Number</Label>
                <Input id="edit-phoneNumber" value={editForm.phoneNumber} onChange={(e) => setEditForm(prev => ({ ...prev, phoneNumber: e.target.value }))} className="bg-white border-slate-300" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-region">County (Region)</Label>
                <Input id="edit-region" value={editForm.region} onChange={(e) => setEditForm(prev => ({ ...prev, region: e.target.value }))} className="bg-white border-slate-300" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-location">Location</Label>
              <Input id="edit-location" value={editForm.location} onChange={(e) => setEditForm(prev => ({ ...prev, location: e.target.value }))} className="bg-white border-slate-300" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSubmit} className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Weight Edit Dialog */}
      <Dialog open={isWeightEditDialogOpen} onOpenChange={setIsWeightEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Weight className="h-5 w-5 text-blue-600" />
              Edit Weights and Prices
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto max-h-[60vh]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300 text-sm">
                <thead>
                  <tr className="bg-blue-100">
                    <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Animal #</th>
                    <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Live Weight (kg)</th>
                    <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Carcass Weight (kg)</th>
                    <th className="border border-gray-300 py-2 px-3 font-medium text-gray-700 text-left">Price (Ksh)</th>
                  </tr>
                </thead>
                <tbody>
                  {weightEditForm.liveWeights.map((_, index) => (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="border border-gray-300 py-2 px-3 font-medium">Animal {index + 1}</td>
                      <td className="border border-gray-300 py-2 px-3">
                        <Input type="number" step="0.1" value={weightEditForm.liveWeights[index] || 0} onChange={(e) => {
                          const newLiveWeights = [...weightEditForm.liveWeights];
                          newLiveWeights[index] = parseFloat(e.target.value) || 0;
                          setWeightEditForm(prev => ({ ...prev, liveWeights: newLiveWeights }));
                        }} className="w-24" />
                      </td>
                      <td className="border border-gray-300 py-2 px-3">
                        <Input type="number" step="0.1" value={weightEditForm.carcassWeights[index] || 0} onChange={(e) => {
                          const newCarcassWeights = [...weightEditForm.carcassWeights];
                          newCarcassWeights[index] = parseFloat(e.target.value) || 0;
                          setWeightEditForm(prev => ({ ...prev, carcassWeights: newCarcassWeights }));
                        }} className="w-24" />
                      </td>
                      <td className="border border-gray-300 py-2 px-3">
                        <Input type="number" step="1" value={weightEditForm.prices[index] || 0} onChange={(e) => {
                          const newPrices = [...weightEditForm.prices];
                          newPrices[index] = parseFloat(e.target.value) || 0;
                          setWeightEditForm(prev => ({ ...prev, prices: newPrices }));
                        }} className="w-32" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsWeightEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleWeightEditSubmit} className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Upload className="h-5 w-5 text-blue-600" />
              Upload CSV Data
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file. Ensure columns include Date, ID Number, Live Weight, Carcass Weight, and Price per Animal.
              Rows will be grouped by ID Number and Date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="csvUpload">CSV File</Label>
              <Input id="csvUpload" type="file" accept=".csv" multiple ref={fileInputRef} onChange={handleFileSelect} disabled={uploadLoading} />
            </div>
            
            {/* Progress Bar */}
            {uploadLoading && uploadProgress.total > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Uploading...</span>
                  <span>{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
            
            {uploadPreview.length > 0 && !uploadLoading && (
              <div className="max-h-60 overflow-y-auto border rounded-md">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-2">Farmer Name</th>
                      <th className="p-2">Date</th>
                      <th className="p-2">ID</th>
                      <th className="p-2">Goats</th>
                      <th className="p-2">Total (KES)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadPreview.map((record, idx) => {
                       const total = record.goats.reduce((sum: number, g: any) => sum + parseFloat(g.price), 0);
                       return (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{record.name}</td>
                          <td className="p-2">{record.date}</td>
                          <td className="p-2">{record.idNumber}</td>
                          <td className="p-2">{record.goats.length}</td>
                          <td className="p-2">{total.toLocaleString()}</td>
                        </tr>
                       )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
                if(!uploadLoading) setIsUploadDialogOpen(false);
            }} disabled={uploadLoading}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploadLoading || uploadPreview.length === 0} className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
              {uploadLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploadLoading ? `Uploading...` : "Upload Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isSingleDeleteDialogOpen} onOpenChange={setIsSingleDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">Confirm Deletion</DialogTitle>
            <DialogDescription>Are you sure you want to delete this record?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSingleDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleSingleDelete} disabled={deleteLoading}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-600">Confirm Bulk Deletion</DialogTitle>
            <DialogDescription>Delete {selectedRecords.length} records?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteMultiple} disabled={deleteLoading}>Delete All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default LivestockOfftakePage;
