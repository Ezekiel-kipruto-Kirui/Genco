import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition, useDeferredValue } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { onValue, orderByChild, equalTo, query, ref, remove, update, push, set } from "firebase/database";
import { db, fetchCollection } from "@/lib/firebase";
import { canViewAllProgrammes, isChiefAdmin, isOfftakeOfficer, resolvePermissionPrincipal } from "@/contexts/authhelper";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChevronDown,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Save,
  ShoppingCart,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";

interface OrderItem {
  id?: string;
  date?: string | number;
  goats?: number;
  location?: string;
  subcounty?: string;
  village?: string;
  fieldOfficer?: string;
  fieldOfficerName?: string;
  officer?: string;
  officerName?: string;
  createdBy?: string;
  username?: string;
}

interface MobileAppDataItem {
  date?: string;
  goats?: number;
  location?: string;
  subcounty?: string;
}

interface OrderRecord {
  id: string;
  batchId?: string;
  fieldOfficer?: string;
  fieldOfficerName?: string;
  recordId?: string;
  completedAt?: string | number;
  county?: string;
  createdAt?: string | number;
  createdBy?: string;
  date?: string | number;
  goats?: number;
  goatsBought?: number;
  location?: string;
  mobileAppdata?: MobileAppDataItem[] | Record<string, MobileAppDataItem>;
  orderId?: string;
  officer?: string;
  officerName?: string;
  orders?: OrderItem[] | Record<string, OrderItem>;
  offtakeOrderId?: string;
  parentOrderId?: string;
  programme?: string;
  requestId?: string;
  remainingGoats?: number;
  status?: string;
  subcounty?: string;
  targetGoats?: number;
  timestamp?: number;
  totalGoats?: number;
  targetOrderId?: string;
  username?: string;
  village?: string;
}

interface NormalizedOrderItem {
  id: string;
  date: string | number;
  goats: number;
  location: string;
  village: string;
  subcounty: string;
  officer: string;
  raw?: OrderItem;
}

interface BatchOrderRow {
  batchId: string;
  batchDate: string | number;
  createdAt: string | number;
  completedAt: string | number;
  targetGoats: number;
  totalGoats: number;
  recordedGoats: number;
  goatsBought: number;
  remainingGoats: number;
  status: string;
  county: string;
  subcounty: string;
  location: string;
  programme: string;
  username: string;
  sortTimestamp: number;
  isReadyForCompletion: boolean;
  items: NormalizedOrderItem[];
  searchableText: string;
}

interface Filters {
  search: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface NewOrderForm {
  date: string;
  goats: string;
  county: string;
  programme: string;
}

interface FieldOfficerRecord {
  id?: string;
  name?: string;
  userName?: string;
  username?: string;
  displayName?: string;
  email?: string;
  phoneNumber?: string;
  phone?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  county?: string;
  subcounty?: string;
  role?: string;
  allowedProgrammes?: Record<string, boolean>;
  accessControl?: {
    customAttribute?: string;
    customAttributes?: Record<string, string>;
  };
}

interface FieldOfficerOption {
  id: string;
  name: string;
  phone: string;
  counties: string[];
  aliases: string[];
}

const PAGE_LIMIT = 15;
const PROGRAMME_OPTIONS = ["KPMD", "RANGE"];

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const formatDate = (value: unknown): string => {
  const date = parseDate(value);
  if (!date) return "N/A";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const normalizeStatus = (value: string | undefined): string => {
  if (!value) return "pending";
  return value.toLowerCase();
};

const getStatusBadgeClass = (status: string): string => {
  if (status === "completed") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (status === "pending") return "bg-amber-100 text-amber-700 border-amber-200";
  if (status === "in-progress") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

const getCurrentMonthDates = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toInput = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { startDate: toInput(startOfMonth), endDate: toInput(endOfMonth) };
};

const toInputDate = (value: unknown): string => {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const getDefaultOrderForm = (programme: string): NewOrderForm => ({
  date: toInputDate(new Date()),
  goats: "",
  county: "",
  programme,
});

const formatCompactNumber = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};

const normalizeText = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")
    : "";

const parseAssignedCounties = (value: unknown): string[] => {
  if (typeof value !== "string") return [];

  const countyMap = new Map<string, string>();
  value
    .split(/[,\n;|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((county) => {
      const token = normalizeText(county);
      if (token && !countyMap.has(token)) countyMap.set(token, county);
    });

  return Array.from(countyMap.values());
};

const normalizeIdValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
};

const getRoleTokens = (record: FieldOfficerRecord): string[] => {
  const tokens = new Set<string>();
  const roleToken = normalizeText(record.role);
  if (roleToken) tokens.add(roleToken);

  const customAttribute = normalizeText(record.accessControl?.customAttribute);
  if (customAttribute) tokens.add(customAttribute);

  const legacy = record.accessControl?.customAttributes;
  if (legacy && typeof legacy === "object") {
    for (const key of Object.keys(legacy)) {
      const token = normalizeText(key);
      if (token) tokens.add(token);
    }
  }

  return Array.from(tokens);
};

const isMobileUserRecord = (record: FieldOfficerRecord): boolean =>
  getRoleTokens(record).some(
    (token) =>
      token === "mobile" ||
      token === "mobile user" ||
      token === "field officer" ||
      token === "fieldofficer"
  );

const getOfficerDisplayName = (record: FieldOfficerRecord): string => {
  const candidates = [record.name, record.userName, record.username, record.displayName, record.email];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "Field Officer";
};

const getOfficerPhone = (record: FieldOfficerRecord): string => {
  const candidates = [record.phoneNumber, record.phone, record.mobile, record.telephone, record.contact];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getBatchTotalGoats = (record: OrderRecord, itemsTotal: number): number => {
  const target = Number(record.targetGoats || 0);
  if (target > 0) return target;
  const storedTotal = Number(record.totalGoats || 0);
  const bought = Number(record.goatsBought || 0);
  const remaining = Number(record.remainingGoats || 0);
  return Math.max(itemsTotal, storedTotal, bought + remaining, 0);
};

const getRecordOfficerCandidates = (record: OrderRecord): unknown[] => [
  record.username,
  record.createdBy,
  record.fieldOfficer,
  record.fieldOfficerName,
  record.officer,
  record.officerName,
];

const getOrderEntries = (record: OrderRecord): OrderItem[] => {
  /* Prefer mobileAppdata (new format) over orders (legacy format) */
  const mobileData = record.mobileAppdata;
  if (mobileData) {
    if (Array.isArray(mobileData)) return mobileData.filter(Boolean) as OrderItem[];
    if (mobileData && typeof mobileData === "object") return Object.values(mobileData).filter(Boolean) as OrderItem[];
  }
  const orders = record.orders;
  if (Array.isArray(orders)) return orders.filter(Boolean);
  if (orders && typeof orders === "object") return Object.values(orders).filter(Boolean);
  return [];
};

const looksLikeReferenceKey = (key: string): boolean => /order|batch|request|target|offtake|parent/i.test(key);

const getBatchIdentifiers = (record: OrderRecord): string[] => {
  const identifiers = new Set<string>();
  [
    record.id,
    record.recordId,
    record.batchId,
    record.orderId,
    record.parentOrderId,
    record.requestId,
    record.targetOrderId,
    record.offtakeOrderId,
  ].forEach((value) => {
    const normalized = normalizeIdValue(value);
    if (normalized) identifiers.add(normalized);
  });
  return Array.from(identifiers);
};

const getBatchReferenceId = (record: OrderRecord): string | null => {
  const recordId = normalizeIdValue(record.id);
  const candidates = [
    record.parentOrderId,
    record.orderId,
    record.batchId,
    record.requestId,
    record.targetOrderId,
    record.offtakeOrderId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeIdValue(candidate);
    if (normalized && normalized !== recordId) return normalized;
  }
  return null;
};

const hasDirectGoatsOnly = (record: OrderRecord): boolean => {
  const hasGoats = Number.isFinite(Number(record.goats)) && Number(record.goats) > 0;
  const hasOrders = getOrderEntries(record).length > 0;
  const hasTarget = Number.isFinite(Number(record.targetGoats)) && Number(record.targetGoats) > 0;
  if (!hasGoats) return false;
  if (!hasOrders) return true;
  return !hasTarget;
};

const hasTopLevelGoats = (record: OrderRecord): boolean => {
  const goatsValue = Number(record.goats);
  return Number.isFinite(goatsValue) && goatsValue > 0;
};

const isSubmissionRecord = (record: OrderRecord): boolean => {
  if (getBatchReferenceId(record)) return true;
  if (hasDirectGoatsOnly(record)) return true;

  const ordersCount = getOrderEntries(record).length;
  const hasTarget = Number.isFinite(Number(record.targetGoats)) && Number(record.targetGoats) > 0;  const hasProgress =
    Number.isFinite(Number(record.remainingGoats)) || Number.isFinite(Number(record.goatsBought));
  const hasStatus = typeof record.status === "string" && record.status.trim().length > 0;
  
  return false;
};

const isBatchRecord = (record: OrderRecord): boolean => {
  if (isSubmissionRecord(record)) return false;

  const hasOrders = getOrderEntries(record).length > 0;
  const target = Number(record.targetGoats) || Number(record.totalGoats);
  const hasTarget = Number.isFinite(target) && target > 0;
  const hasProgress =
    Number.isFinite(Number(record.remainingGoats)) || Number.isFinite(Number(record.goatsBought));
  const hasStatus = typeof record.status === "string" && record.status.trim().length > 0;

  if (hasOrders) return true;
  if (hasTarget && (hasProgress || hasStatus)) return true;
  return false;
};

const getSubmissionItems = (record: OrderRecord): NormalizedOrderItem[] => {
  const orderEntries = getOrderEntries(record);
  if (orderEntries.length > 0) {
    return orderEntries.map((item, index) => {
      const itemLocation = item.location || item.village || record.location || record.village || "N/A";
      const itemSubcounty = item.subcounty || record.subcounty || "";
      const officer =
        item.fieldOfficer ||
        item.fieldOfficerName ||
        item.officer ||
        item.officerName ||
        item.createdBy ||
        item.username ||
        record.username ||
        record.createdBy ||
        "N/A";
      return {
        id: item.id || `${record.id}-${index + 1}`,
        date: item.date || record.date || record.completedAt || record.createdAt || record.timestamp || "",
        goats: Number(item.goats || record.goats || 0),
        location: itemLocation,
        village: item.village || itemLocation,
        subcounty: itemSubcounty,
        officer,
        raw: item,
      };
    });
  }

  const goatsValue = Number(record.goats || record.totalGoats || record.goatsBought || 0);
  if (!Number.isFinite(goatsValue) || goatsValue <= 0) return [];
  const dateValue = record.date || record.completedAt || record.createdAt || record.timestamp || "";
  const location = record.location || record.village || "N/A";
  const subcounty = record.subcounty || "";
  const officer = record.username || record.createdBy || "N/A";
  return [
    {
      id: record.id,
      date: dateValue,
      goats: goatsValue,
      location,
      village: location,
      subcounty,
      officer,
    },
  ];
};

const getNormalizedItems = (record: OrderRecord): NormalizedOrderItem[] => {
  const orderEntries = getOrderEntries(record);
  if (orderEntries.length > 0) {
    return orderEntries.map((item, index) => {
      const itemLocation = item.location || item.village || record.location || "N/A";
      const itemSubcounty = item.subcounty || record.subcounty || "";
      const officer =
        item.fieldOfficer ||
        item.fieldOfficerName ||
        item.officer ||
        item.officerName ||
        item.createdBy ||
        item.username ||
        "N/A";
      return {
        id: item.id || `${record.id}-${index + 1}`,
        date: item.date || record.completedAt || record.createdAt || record.timestamp || "",
        goats: Number(item.goats || 0),
        location: itemLocation,
        village: item.village || itemLocation,
        subcounty: itemSubcounty,
        officer,
        raw: item,
      };
    });
  }

  return [];
};

/* ------------------------------------------------------------------
 * Lightweight pre-computation helpers (pure, outside component)
 * ------------------------------------------------------------------ */

interface PrecomputedRecord {
  id: string;
  record: OrderRecord;
  isBatch: boolean;
  isSubmission: boolean;
  refId: string | null;
  identifiers: string[];
  normalizedItems: NormalizedOrderItem[];
  normProgramme: string;
  normCounty: string;
  normLocation: string;
  dateMs: number;
  goatsTotal: number;
  officerTokens: string[];
  sortDate: string | number;
}

/**
 * JSON-stringify a record's key fields for cheap deep equality.
 * Used to skip re-precomputation when a record hasn't changed.
 */
const getRecordFingerprint = (r: OrderRecord): string =>
  `${r.programme}:${r.county}:${r.subcounty}:${r.location}:${r.status}:${r.targetGoats}:${r.totalGoats}:${r.goatsBought}:${r.remainingGoats}:${r.date}:${r.completedAt}:${r.parentOrderId}:${r.orderId}:${r.batchId}:${r.requestId}:${r.targetOrderId}:${r.offtakeOrderId}:${r.goats}:${r.sourcePage}:${JSON.stringify(r.orders)}:${JSON.stringify(r.mobileAppdata)}`;

/**
 * Incremental precompute: reuses cached precomputed records when unchanged.
 * Returns a Map<id, PrecomputedRecord> for O(1) lookup.
 */
const buildPrecomputedMap = (
  records: OrderRecord[],
  prevCache: Map<string, { pc: PrecomputedRecord; fp: string }>
): PrecomputedRecord[] => {
  const result: PrecomputedRecord[] = new Array(records.length);
  const nextCache = new Map<string, { pc: PrecomputedRecord; fp: string }>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const fp = getRecordFingerprint(record);
    const cached = prevCache.get(record.id);
    const pc = cached && cached.fp === fp ? cached.pc : precomputeRecord(record);
    result[i] = pc;
    nextCache.set(record.id, { pc, fp });
  }
  // Update the cache ref in-place so the caller's ref stays current
  prevCache.clear();
  for (const [k, v] of nextCache) prevCache.set(k, v);
  return result;
}

const precomputeRecord = (record: OrderRecord): PrecomputedRecord => {
  const id = record.id;
  const isBatch = isBatchRecord(record);
  const isSubmission = !isBatch && isSubmissionRecord(record);
  const refId = getBatchReferenceId(record);
  const identifiers = isBatch ? getBatchIdentifiers(record) : [];
  const normalizedItems = isBatch ? getNormalizedItems(record) : [];
  const normProgramme = normalizeText(record.programme);
  const normCounty = normalizeText(record.county);
  const normLocation = normalizeText(record.location || record.village || record.subcounty);
  const dateMs = parseDate(record.date || record.completedAt || record.createdAt || record.timestamp)?.getTime() || 0;
  const goatsTotal = Number(record.targetGoats || record.totalGoats || record.goatsBought || record.goats || 0);
  const officerTokens = getRecordOfficerCandidates(record)
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : normalizeText(v)))
    .filter((t) => t.length > 0);
  const sortDate = record.date || record.completedAt || record.createdAt || record.timestamp || "";
  return { id, record, isBatch, isSubmission, refId, identifiers, normalizedItems, normProgramme, normCounty, normLocation, dateMs, goatsTotal, officerTokens, sortDate };
};

const BATCH_REFERENCE_KEYS = new Set(Object.keys({
  parentOrderId: 1, orderId: 1, batchId: 1, requestId: 1,
  targetOrderId: 1, offtakeOrderId: 1,
}));

/* ------------------------------------------------------------------
 * Memoized table row component to prevent unnecessary re-renders
 * when sibling rows change (React renders all children on parent update)
 * ------------------------------------------------------------------ */
interface OrderTableRowProps {
  row: BatchOrderRow;
  idx: number;
  userCanEditOrders: boolean;
  userIsChiefAdmin: boolean;
  onView: (batchId: string) => void;
  onEdit: (batchId: string) => void;
  onDelete: (row: BatchOrderRow) => void;
}

const OrderTableRow = memo(function OrderTableRow({
  row, idx, userCanEditOrders, userIsChiefAdmin, onView, onEdit, onDelete,
}: OrderTableRowProps) {
  return (
    <TableRow
      className={`border-b border-slate-100 transition-colors hover:bg-blue-50/40 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}
    >
      <TableCell className="px-4 py-2.5 text-sm font-medium text-slate-800 whitespace-nowrap">
        {formatDate(row.batchDate)}
      </TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-slate-700">{row.county}</TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-slate-700">{row.subcounty}</TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-slate-700 max-w-[140px] truncate">{row.username}</TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-right font-semibold tabular-nums text-slate-800">
        {row.targetGoats.toLocaleString()}
      </TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-right tabular-nums text-slate-600">
        {row.recordedGoats.toLocaleString()}
      </TableCell>
      <TableCell className="px-4 py-2.5 text-sm text-right font-semibold tabular-nums text-slate-800">
        {row.goatsBought.toLocaleString()}
      </TableCell>
      <TableCell className="px-4 py-2.5">
        <Badge variant="outline" className={getStatusBadgeClass(row.status)}>{row.status}</Badge>
      </TableCell>
      <TableCell className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
            onClick={() => onView(row.batchId)}
            title="View details"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {userCanEditOrders && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50"
              onClick={() => onEdit(row.batchId)}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {userIsChiefAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
              onClick={() => onDelete(row)}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

const OrdersPage = () => {
  const { userRole, userAttribute, allowedProgrammes, userName } = useAuth();
  const { toast } = useToast();

  const [allRecords, setAllRecords] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProgram, setActiveProgram] = useState<string>("");
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [ordersDialogBatchId, setOrdersDialogBatchId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [newOrder, setNewOrder] = useState<NewOrderForm>(() => getDefaultOrderForm(""));
  const [fieldOfficers, setFieldOfficers] = useState<FieldOfficerOption[]>([]);
  const [fieldOfficersLoading, setFieldOfficersLoading] = useState(false);
  const fieldOfficersLoadedRef = useRef(false);
  const [selectedFieldOfficerIds, setSelectedFieldOfficerIds] = useState<string[]>([]);

  const [editingOrderKey, setEditingOrderKey] = useState<string | null>(null);
  const [orderGoatsDraft, setOrderGoatsDraft] = useState<string>("");
  const [orderDateDraft, setOrderDateDraft] = useState<string>("");
  const [orderOfficerDraft, setOrderOfficerDraft] = useState<string>("");
  const [orderLocationDraft, setOrderLocationDraft] = useState<string>("");
  const [orderSubcountyDraft, setOrderSubcountyDraft] = useState<string>("");

  const [dialogGoatsBoughtDraft, setDialogGoatsBoughtDraft] = useState<string>("");

  const monthDates = useMemo(getCurrentMonthDates, []);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: monthDates.startDate,
    endDate: monthDates.endDate,
    status: "all",
  });
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const deferredSearch = useDeferredValue(debouncedSearch);

  const handleSearchChange = useCallback((value: string) => {
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      startTransition(() => setDebouncedSearch(value));
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });

  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userRole, userAttribute]
  );
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const userCanCreateOrders = useMemo(
    () => isChiefAdmin(userRole) || isOfftakeOfficer(userRole) || isOfftakeOfficer(userAttribute),
    [userRole, userAttribute]
  );
  const userCanEditOrders = useMemo(
    () => isChiefAdmin(userRole) || isOfftakeOfficer(userRole) || isOfftakeOfficer(userAttribute),
    [userRole, userAttribute]
  );

  const ensureOrderCreateAccess = useCallback(() => {
    if (userCanCreateOrders) return true;
    toast({ title: "Unauthorized", description: "Only offtake officer or chief admin can create orders.", variant: "destructive" });
    return false;
  }, [userCanCreateOrders]);

  const ensureOrderEditAccess = useCallback(() => {
    if (userCanEditOrders) return true;
    toast({ title: "Unauthorized", description: "Only offtake officer or chief admin can edit orders.", variant: "destructive" });
    return false;
  }, [userCanEditOrders]);

  const ensureBatchDeleteAccess = useCallback(() => {
    if (userIsChiefAdmin) return true;
    toast({ title: "Unauthorized", description: "Only chief admin can delete batches.", variant: "destructive" });
    return false;
  }, [userIsChiefAdmin]);

  useEffect(() => {
    if (userCanViewAllProgrammeData) {
      setAvailablePrograms(PROGRAMME_OPTIONS);
      setActiveProgram((prev) => prev || PROGRAMME_OPTIONS[0]);
      return;
    }
    const assignedPrograms = Object.keys(allowedProgrammes || {}).filter((p) => allowedProgrammes?.[p]);
    setAvailablePrograms(assignedPrograms);
    setActiveProgram((prev) => {
      if (assignedPrograms.length === 0) return "";
      if (prev && assignedPrograms.includes(prev)) return prev;
      return assignedPrograms[0];
    });
  }, [allowedProgrammes, userCanViewAllProgrammeData]);

  /* Delta-aware Firebase listener: compares new snapshot with previous to
     minimize state churn. Only creates new array when records actually change. */
  const prevRecordsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!activeProgram) {
      setAllRecords([]);
      setLoading(false);
      prevRecordsRef.current.clear();
      return;
    }
    setLoading(true);
    const ordersRef = query(ref(db, "orders"), orderByChild("programme"), equalTo(activeProgram));
    const unsubscribe = onValue(
      ordersRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          if (prevRecordsRef.current.size > 0) {
            prevRecordsRef.current.clear();
            startTransition(() => setAllRecords([]));
          }
          setLoading(false);
          return;
        }
        const entries = Object.entries(data as Record<string, Partial<OrderRecord>>);
        const newFingerprints = new Map<string, string>();
        let hasChanges = false;

        for (const [key, val] of entries) {
          const fp = JSON.stringify(val);
          newFingerprints.set(key, fp);
          if (prevRecordsRef.current.get(key) !== fp) hasChanges = true;
        }
        if (prevRecordsRef.current.size !== newFingerprints.size) hasChanges = true;

        if (!hasChanges) {
          setLoading(false);
          return;
        }

        const records: OrderRecord[] = entries.map(([key, val]) => ({
          ...(val as Partial<OrderRecord> & { id?: string }),
          id: key,
          recordId: val?.id || key,
        }));
        records.sort((a, b) => {
          const aDate = parseDate(a.completedAt || a.createdAt || a.timestamp)?.getTime() || 0;
          const bDate = parseDate(b.completedAt || b.createdAt || b.timestamp)?.getTime() || 0;
          return bDate - aDate;
        });
        prevRecordsRef.current = newFingerprints;
        startTransition(() => setAllRecords(records));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, [activeProgram]);

  useEffect(() => { setOrdersDialogBatchId(null); }, [activeProgram]);

  /* Load field officers lazily — only once per session, in parallel with orders */
  useEffect(() => {
    if (!activeProgram) {
      setFieldOfficers([]);
      fieldOfficersLoadedRef.current = false;
      return;
    }
    if (fieldOfficersLoadedRef.current) return;
    let cancelled = false;
    const load = async () => {
      setFieldOfficersLoading(true);
      try {
        const allUsers = await fetchCollection<FieldOfficerRecord>("users");
        if (cancelled) return;
        /* Use requestAnimationFrame to avoid blocking the main thread during filtering */
        const officers = allUsers
          .filter(isMobileUserRecord)
          .map((record) => ({
            id: record.id || getOfficerDisplayName(record),
            name: getOfficerDisplayName(record),
            phone: getOfficerPhone(record),
            counties: parseAssignedCounties(record.county),
            aliases: [record.name, record.userName, record.username, record.displayName, record.email, record.id].filter(
              (v): v is string => typeof v === "string" && v.trim().length > 0,
            ),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) {
          setFieldOfficers(officers);
          fieldOfficersLoadedRef.current = true;
        }
      } catch {
        if (!cancelled) {
          setFieldOfficers([]);
          toast({ title: "Error", description: "Failed to load mobile users.", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setFieldOfficersLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeProgram, toast]);

  /* Memoize the officer token set so batchRows doesn't re-run when fieldOfficers ref changes identity
     but the actual tokens haven't changed. */
  const mobileOfficerTokenSet = useMemo(() => {
    const tokens = new Set<string>();
    for (const officer of fieldOfficers) {
      for (const value of [officer.name, officer.id, officer.phone, ...(officer.aliases || [])]) {
        const t = normalizeText(value);
        if (t) tokens.add(t);
      }
    }
    return tokens;
  }, [fieldOfficers]);

  /* Incremental pre-computation: reuse cached records when unchanged,
     only recompute records whose fingerprint has changed. */
  const precomputedCacheRef = useRef<Map<string, { pc: PrecomputedRecord; fp: string }>>(new Map());
  const precomputed = useMemo(
    () => buildPrecomputedMap(allRecords, precomputedCacheRef.current),
    [allRecords],
  );

  /* Core batch grouping – county-indexed fuzzy matching for O(n) instead of O(n²) */
  const batchRows = useMemo(() => {
    const batchMap = new Map<string, { pr: PrecomputedRecord; items: NormalizedOrderItem[]; itemIds: Set<string> }>();
    const batchAliasMap = new Map<string, string>();
    const consumedRecordIds = new Set<string>();
    /* County index: Map<normCounty, batchIds[]> for O(1) fuzzy lookup */
    const countyBatchIndex = new Map<string, string[]>();

    /* 1. Register batch parents */
    for (const pc of precomputed) {
      if (!pc.isBatch) continue;
      const itemIds = new Set(pc.normalizedItems.map((i) => i.id));
      batchMap.set(pc.id, { pr: pc, items: [...pc.normalizedItems], itemIds });
      for (const id of pc.identifiers) {
        if (!batchAliasMap.has(id)) batchAliasMap.set(id, pc.id);
      }
      /* Build county index */
      if (pc.normCounty) {
        let list = countyBatchIndex.get(pc.normCounty);
        if (!list) { list = []; countyBatchIndex.set(pc.normCounty, list); }
        list.push(pc.id);
      }
    }

    /* 2. Fast resolve for submission records */
    for (const pc of precomputed) {
      if (pc.isBatch) continue;
      if (consumedRecordIds.has(pc.id)) continue;

      let batchId: string | null = null;

      // Explicit reference
      if (pc.refId) {
        batchId = batchAliasMap.get(pc.refId) || (batchMap.has(pc.refId) ? pc.refId : null);
      }

      // Scan known reference keys only (not all Object.entries)
      if (!batchId) {
        const rec = pc.record;
        for (const key of BATCH_REFERENCE_KEYS) {
          const val = (rec as Record<string, unknown>)[key];
          if (val == null) continue;
          const norm = normalizeIdValue(val);
          if (!norm) continue;
          batchId = batchAliasMap.get(norm);
          if (batchId) break;
        }
      }

      // Fuzzy match (submission / mobile officer) — county-indexed for O(k) where k = batches in same county
      if (!batchId && (pc.isSubmission || pc.officerTokens.some((t) => mobileOfficerTokenSet.has(t)))) {
        let bestScore = 0;
        const candidateBatchIds = pc.normCounty ? countyBatchIndex.get(pc.normCounty) : null;
        const batchesToScan = candidateBatchIds || Array.from(batchMap.keys());
        for (const bid of batchesToScan) {
          if (bid === pc.id) continue;
          const entry = batchMap.get(bid);
          if (!entry) continue;
          const bp = entry.pr;
          let score = 0;
          if (pc.normProgramme && bp.normProgramme && pc.normProgramme === bp.normProgramme) score += 3;
          if (pc.normCounty && bp.normCounty && pc.normCounty === bp.normCounty) score += 2;
          if (pc.normLocation && bp.normLocation && pc.normLocation === bp.normLocation) score += 4;
          if (pc.dateMs && bp.dateMs) {
            const dayDiff = Math.abs(pc.dateMs - bp.dateMs) / 86400000;
            if (dayDiff <= 1) score += 4;
            else if (dayDiff <= 7) score += 3;
            else if (dayDiff <= 30) score += 1;
          }
          if (pc.goatsTotal > 0 && bp.goatsTotal > 0 && pc.goatsTotal === bp.goatsTotal) score += 2;
          if (normalizeStatus(bp.record.status) !== "completed") score += 1;
          if (score > bestScore) { bestScore = score; batchId = bid; }
        }
        if (bestScore < 6) batchId = null;
      }

      if (!batchId || batchId === pc.id) continue;

      // Attach submission items
      const parent = batchMap.get(batchId);
      if (!parent) continue;
      const subItems = getSubmissionItems(pc.record);
      if (subItems.length === 0) continue;
      const filtered = subItems.filter((item) => !parent.itemIds.has(item.id));
      if (filtered.length === 0) continue;
      for (const item of filtered) parent.itemIds.add(item.id);
      parent.items.push(...filtered);
      consumedRecordIds.add(pc.id);
    }

    /* 3. Build output rows with pre-computed searchable text */
    const result: BatchOrderRow[] = [];
    for (const [_, entry] of batchMap.entries()) {
      if (consumedRecordIds.has(entry.pr.id)) continue;
      const rec = entry.pr.record;
      const items = entry.items;
      const itemsTotal = items.reduce((s, i) => s + i.goats, 0);
      const totalGoats = getBatchTotalGoats(rec, itemsTotal);
      const goatsBought = clamp(Math.max(Number(rec.goatsBought || 0), itemsTotal), 0, Math.max(totalGoats, 0));
      const remainingGoats = Math.max(totalGoats - goatsBought, 0);
      const createdAt = rec.createdAt || rec.timestamp || "";
      const completedAt = rec.completedAt || "";
      const batchDate = rec.date || completedAt || createdAt || items[0]?.date || "";
      const storedStatus = normalizeStatus(rec.status);
      const isReadyForCompletion = totalGoats > 0 && remainingGoats <= 0 && storedStatus !== "completed";
      const status = storedStatus === "completed"
        ? "completed"
        : goatsBought > 0 || items.length > 0 ? "in-progress" : "pending";
      const county = rec.county || "N/A";
      const subcounty = rec.subcounty || "N/A";
      const location = rec.location || items[0]?.location || items[0]?.village || "N/A";
      const programme = rec.programme || activeProgram || "N/A";
      const username = rec.username || rec.createdBy || items[0]?.officer || "N/A";
      const targetGoats = Number(rec.targetGoats || 0) || totalGoats;
      result.push({
        batchId: rec.id, batchDate, createdAt, completedAt, targetGoats, totalGoats, recordedGoats: itemsTotal,
        goatsBought, remainingGoats, status,
        county, subcounty, location, programme, username,
        sortTimestamp: parseDate(batchDate)?.getTime() || 0, isReadyForCompletion, items,
        searchableText: `${county} ${subcounty} ${location} ${username} ${status} ${programme} ${rec.id} ${totalGoats}`.toLowerCase(),
      });
    }
    result.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
    return result;
  }, [precomputed, activeProgram, mobileOfficerTokenSet]);

  const ordersDialogRow = useMemo(
    () => batchRows.find((r) => r.batchId === ordersDialogBatchId) || null,
    [batchRows, ordersDialogBatchId]
  );

  const ordersDialogHasOfficerColumn = useMemo(
    () => Boolean(ordersDialogRow?.items.some((i) => normalizeText(i.officer) && normalizeText(i.officer) !== "n/a")),
    [ordersDialogRow]
  );

  useEffect(() => {
    if (ordersDialogBatchId && !ordersDialogRow) {
      setOrdersDialogBatchId(null);
      setEditingOrderKey(null);
      setOrderGoatsDraft("");
      setOrderDateDraft("");
    }
  }, [ordersDialogBatchId, ordersDialogRow]);

  /* Pre-parse filter dates once */
  const filterStartDateMs = useMemo(
    () => filters.startDate ? new Date(filters.startDate).setHours(0, 0, 0, 0) : null,
    [filters.startDate],
  );
  const filterEndDateMs = useMemo(
    () => filters.endDate ? new Date(filters.endDate).setHours(23, 59, 59, 999) : null,
    [filters.endDate],
  );

  const filteredBatchRows = useMemo(() => {
    const searchTerm = deferredSearch.toLowerCase().trim();
    const statusFilter = filters.status;
    const hasDateFilter = filterStartDateMs != null || filterEndDateMs != null;
    const needsSearch = searchTerm.length > 0;
    const needsDate = hasDateFilter;
    const rows = batchRows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!needsSearch && !needsDate) return true;
      if (needsDate) {
        const rowMs = row.sortTimestamp;
        if (!rowMs) return false;
        if (filterStartDateMs != null && rowMs < filterStartDateMs) return false;
        if (filterEndDateMs != null && rowMs > filterEndDateMs) return false;
      }
      if (!needsSearch) return true;
      return row.searchableText.includes(searchTerm);
    });
    // Already sorted from batchRows, no need to re-sort
    return rows;
  }, [batchRows, filters.status, filterStartDateMs, filterEndDateMs, deferredSearch]);

  const totalTargetGoats = useMemo(
    () => filteredBatchRows.reduce((sum, row) => sum + (row.targetGoats || row.totalGoats), 0),
    [filteredBatchRows]
  );

  const totalGoatsPurchased = useMemo(
    () => filteredBatchRows.reduce((sum, row) => sum + row.goatsBought, 0),
    [filteredBatchRows]
  );

  const purchasePercentage = useMemo(() => {
    if (totalTargetGoats === 0) return 0;
    return Math.round((totalGoatsPurchased / totalTargetGoats) * 100);
  }, [totalGoatsPurchased, totalTargetGoats]);

  const totalOrdersInBatches = useMemo(
    () => filteredBatchRows.reduce((sum, row) => sum + row.items.length, 0),
    [filteredBatchRows]
  );

  const countiesMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredBatchRows.forEach((row) => {
      const county = row.county || "Unknown";
      map.set(county, (map.get(county) || 0) + row.totalGoats);
    });
    return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
  }, [filteredBatchRows]);

  const uniqueCounties = countiesMap.size;

  useEffect(() => {
    setPagination((prev) => {
      const totalPages = Math.max(1, Math.ceil(filteredBatchRows.length / prev.limit));
      const page = Math.min(prev.page, totalPages);
      return { ...prev, page, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
    });
  }, [filteredBatchRows.length]);

  const pageRows = useMemo(() => {
    const start = (pagination.page - 1) * pagination.limit;
    return filteredBatchRows.slice(start, start + pagination.limit);
  }, [filteredBatchRows, pagination.page, pagination.limit]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    batchRows.forEach((r) => set.add(r.status));
    return Array.from(set).sort();
  }, [batchRows]);

  const countyOptions = useMemo(() => {
    const countyMap = new Map<string, string>();
    fieldOfficers.forEach((officer) => {
      officer.counties.forEach((county) => {
        const token = normalizeText(county);
        if (token && !countyMap.has(token)) countyMap.set(token, county);
      });
    });
    return Array.from(countyMap.values()).sort((a, b) => a.localeCompare(b));
  }, [fieldOfficers]);

  const countyFieldOfficers = useMemo(() => {
    const selectedCounty = normalizeText(newOrder.county);
    if (!selectedCounty) return [];
    return fieldOfficers.filter((officer) =>
      officer.counties.some((county) => normalizeText(county) === selectedCounty)
    );
  }, [fieldOfficers, newOrder.county]);

  const canChooseOrderProgramme = PROGRAMME_OPTIONS.every((programme) => availablePrograms.includes(programme));
  const resolvedOrderProgramme = newOrder.programme || activeProgram || availablePrograms[0] || "";

  const selectedOfficerNames = useMemo(
    () => fieldOfficers.filter((o) => selectedFieldOfficerIds.includes(o.id)).map((o) => o.name),
    [fieldOfficers, selectedFieldOfficerIds]
  );

  const selectedOfficersSummary = useMemo(() => {
    if (!newOrder.county) return "Select county first";
    if (countyFieldOfficers.length === 0) return "No field officers assigned";
    return selectedOfficerNames.length === 0 ? "Select field officers" : `${selectedOfficerNames.length} selected`;
  }, [countyFieldOfficers.length, newOrder.county, selectedOfficerNames.length]);

  const selectedOfficersPreview = useMemo(() => {
    if (!newOrder.county) return "Choose a county to load its assigned field officers.";
    if (countyFieldOfficers.length === 0) return `No field officers are assigned to ${newOrder.county}.`;
    if (selectedOfficerNames.length === 0) {
      return `${countyFieldOfficers.length} field officer${countyFieldOfficers.length === 1 ? "" : "s"} available in ${newOrder.county}.`;
    }
    const preview = selectedOfficerNames.slice(0, 3).join(", ");
    return selectedOfficerNames.length <= 3 ? preview : `${preview} +${selectedOfficerNames.length - 3} more`;
  }, [countyFieldOfficers.length, newOrder.county, selectedOfficerNames]);

  const generatedSmsPreview = useMemo(() => {
    const programmeLabel = resolvedOrderProgramme || "Selected programme";
    const countyLabel = newOrder.county || "selected county";
    const targetGoats = Number(newOrder.goats) || 0;
    const goatsLabel = targetGoats > 0
      ? targetGoats.toLocaleString()
      : "0";
    const dateLabel = newOrder.date ? formatDate(newOrder.date) : "selected date";

    return `Dear Field Officer, a ${programmeLabel} order has been created for ${countyLabel} on ${dateLabel}. Target goats: ${goatsLabel}. Order reference will be attached automatically.`;
  }, [newOrder.county, newOrder.date, newOrder.goats, resolvedOrderProgramme]);

  useEffect(() => {
    const allowedOfficerIds = new Set(countyFieldOfficers.map((officer) => officer.id));
    setSelectedFieldOfficerIds((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((id) => allowedOfficerIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [countyFieldOfficers]);

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setPagination((prev) => ({ ...prev, page: 1 }));
    if (key === "search") {
      handleSearchChange(value);
    } else {
      setFilters((prev) => ({ ...prev, [key]: value }));
    }
  }, [handleSearchChange]);

  const clearFilters = useCallback(() => {
    setFilters({ search: "", startDate: "", endDate: "", status: "all" });
    setPagination((prev) => ({ ...prev, page: 1 }));
    startTransition(() => setDebouncedSearch(""));
  }, []);

  const closeOrdersDialog = useCallback(() => {
    setOrdersDialogBatchId(null);
    setEditingOrderKey(null);
    setOrderGoatsDraft("");
    setOrderDateDraft("");
    setOrderOfficerDraft("");
    setOrderLocationDraft("");
    setOrderSubcountyDraft("");
    setDialogGoatsBoughtDraft("");
  }, []);

  const resetNewOrderForm = useCallback((programme: string) => {
    setNewOrder(getDefaultOrderForm(programme));
    setSelectedFieldOfficerIds([]);
  }, []);

  const openCreateDialog = useCallback(() => {
    if (!ensureOrderCreateAccess()) return;
    if (!activeProgram) {
      toast({ title: "Select programme", description: "Please select a programme before creating an order.", variant: "destructive" });
      return;
    }
    resetNewOrderForm(activeProgram);
    setIsCreateDialogOpen(true);
  }, [activeProgram, userCanCreateOrders]);

  const closeCreateDialog = useCallback(() => { setIsCreateDialogOpen(false); }, []);

  const toggleFieldOfficerSelection = useCallback((officerId: string) => {
    setSelectedFieldOfficerIds((prev) =>
      prev.includes(officerId) ? prev.filter((id) => id !== officerId) : [...prev, officerId]
    );
  }, []);

  const updateBatchOrders = async (row: BatchOrderRow, nextItems: NormalizedOrderItem[], nextGoatsBought?: number) => {
    const sanitizedItems = nextItems.map((item, index) => {
      const orderLocation = item.location || item.village || row.location || "";
      return {
        ...(item.raw ?? {}),
        id: item.id || `${row.batchId}-${index + 1}`,
        goats: Math.max(0, Number(item.goats || 0)),
        date: item.date || row.batchDate || "",
        location: orderLocation,
        subcounty: item.subcounty || row.subcounty || "",
      };
    });
    const itemsTotal = sanitizedItems.reduce((sum, i) => sum + i.goats, 0);
    const targetGoats = row.targetGoats > 0 ? row.targetGoats : row.totalGoats;
    const goatsBought = clamp(
      Math.max(typeof nextGoatsBought === "number" ? nextGoatsBought : Number(row.goatsBought || 0), itemsTotal),
      0, Math.max(targetGoats, 0)
    );
    const remainingGoats = Math.max(targetGoats - goatsBought, 0);
    const storedStatus = normalizeStatus(row.status);
    const nextStatus = storedStatus === "completed" ? "completed" : goatsBought > 0 || itemsTotal > 0 ? "in-progress" : "pending";
    const nextCompletedAt = storedStatus === "completed" ? row.completedAt || new Date().toISOString() : "";
    await update(ref(db, `orders/${row.batchId}`), {
      mobileAppdata: sanitizedItems, totalGoats: itemsTotal, goatsBought, remainingGoats, status: nextStatus, completedAt: nextCompletedAt,
    });
  };

  const saveDialogGoatsBought = async () => {
    if (!ordersDialogRow) return;
    if (!ensureOrderEditAccess()) return;
    const nextValue = Number(dialogGoatsBoughtDraft);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      toast({ title: "Invalid value", description: "Goats bought must be 0 or greater.", variant: "destructive" });
      return;
    }
    if (nextValue > (ordersDialogRow.targetGoats || ordersDialogRow.totalGoats)) {
      toast({ title: "Invalid value", description: "Cannot exceed target goats.", variant: "destructive" });
      return;
    }
    try {
      const target = ordersDialogRow.targetGoats || ordersDialogRow.totalGoats;
      const remainingGoats = Math.max(target - nextValue, 0);
      const storedStatus = normalizeStatus(ordersDialogRow.status);
      const nextStatus = storedStatus === "completed" ? "completed" : nextValue > 0 ? "in-progress" : "pending";
      const nextCompletedAt = storedStatus === "completed" ? ordersDialogRow.completedAt || new Date().toISOString() : "";
      await update(ref(db, `orders/${ordersDialogRow.batchId}`), { goatsBought: nextValue, remainingGoats, status: nextStatus, completedAt: nextCompletedAt });
      toast({ title: "Updated", description: "Goats bought updated." });
      setDialogGoatsBoughtDraft("");
    } catch {
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    }
  };

  const markOrderComplete = async (row: BatchOrderRow) => {
    if (!ensureOrderEditAccess()) return;
    if (row.remainingGoats > 0) {
      toast({ title: "Order not complete", description: `Still ${row.remainingGoats.toLocaleString()} goats remaining.`, variant: "destructive" });
      return;
    }
    if (!window.confirm("Mark this order as complete?")) return;
    try {
      await update(ref(db, `orders/${row.batchId}`), {
        status: "completed",
        completedAt: row.completedAt || new Date().toISOString(),
        goatsBought: Math.max(row.targetGoats, row.totalGoats, row.goatsBought, row.recordedGoats),
        remainingGoats: 0,
      });
      toast({ title: "Completed", description: "Order marked as complete." });
    } catch {
      toast({ title: "Error", description: "Failed to mark complete.", variant: "destructive" });
    }
  };

  const startOrderEdit = (row: BatchOrderRow, item: NormalizedOrderItem, index: number) => {
    if (!ensureOrderEditAccess()) return;
    setEditingOrderKey(`${row.batchId}:${index}`);
    setOrderGoatsDraft(String(item.goats || 0));
    setOrderDateDraft(toInputDate(item.date));
    setOrderOfficerDraft(item.officer === "N/A" ? "" : item.officer || "");
    setOrderLocationDraft(item.location === "N/A" ? "" : item.location || "");
    setOrderSubcountyDraft(item.subcounty === "N/A" ? "" : item.subcounty || "");
  };

  const cancelOrderEdit = () => {
    setEditingOrderKey(null);
    setOrderGoatsDraft("");
    setOrderDateDraft("");
    setOrderOfficerDraft("");
    setOrderLocationDraft("");
    setOrderSubcountyDraft("");
  };

  const saveOrderEdit = async (row: BatchOrderRow, index: number) => {
    if (!ensureOrderEditAccess()) return;
    const nextGoats = Number(orderGoatsDraft);
    if (!Number.isFinite(nextGoats) || nextGoats < 0) {
      toast({ title: "Invalid value", description: "Goats must be 0 or greater.", variant: "destructive" });
      return;
    }
    if (!orderDateDraft) { toast({ title: "Date required", variant: "destructive" }); return; }
    const nextItems = row.items.map((item, i) =>
      i === index
        ? {
            ...item,
            goats: nextGoats,
            date: orderDateDraft,
            location: orderLocationDraft.trim() || item.location,
            subcounty: orderSubcountyDraft.trim() || item.subcounty,
          }
        : item
    );
    try {
      await updateBatchOrders(row, nextItems);
      toast({ title: "Updated", description: "Order item updated." });
      cancelOrderEdit();
    } catch {
      toast({ title: "Error", description: "Failed to update.", variant: "destructive" });
    }
  };

  const deleteOrderItem = async (row: BatchOrderRow, index: number) => {
    if (!ensureOrderEditAccess()) return;
    if (!window.confirm("Delete this order item?")) return;
    try {
      await updateBatchOrders(row, row.items.filter((_, i) => i !== index));
      toast({ title: "Deleted", description: "Order item deleted." });
    } catch {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
  };

  const deleteBatch = async (row: BatchOrderRow) => {
    if (!ensureBatchDeleteAccess()) return;
    if (!window.confirm("Delete this batch and all its orders?")) return;
    try {
      await remove(ref(db, `orders/${row.batchId}`));
      if (ordersDialogBatchId === row.batchId) closeOrdersDialog();
      toast({ title: "Deleted", description: "Batch deleted." });
    } catch {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
  };

  const handleCreateOrder = async () => {
    if (!ensureOrderCreateAccess()) return;
    const selectedProgramme = resolvedOrderProgramme.trim();
    if (!selectedProgramme) { toast({ title: "Select programme", variant: "destructive" }); return; }
    const trimmedCounty = newOrder.county.trim();
    const goatsValue = Number(newOrder.goats);

    if (!newOrder.date) { toast({ title: "Date required", variant: "destructive" }); return; }
    if (!trimmedCounty) { toast({ title: "County required", variant: "destructive" }); return; }
    if (!Number.isFinite(goatsValue) || goatsValue <= 0) { toast({ title: "Invalid goats", description: "Enter the total number of goats to be collected.", variant: "destructive" }); return; }

    const selectedOfficers = countyFieldOfficers.filter((o) => selectedFieldOfficerIds.includes(o.id));
    const recipients = Array.from(new Set(selectedOfficers.map((o) => o.phone).filter(Boolean)));
    if (recipients.length === 0) { toast({ title: "No recipients", variant: "destructive" }); return; }

    setCreatingOrder(true);
    try {
      const now = new Date().toISOString();
      const orderRef = push(ref(db, "orders"));
      const orderId = orderRef.key || null;

      await set(orderRef, {
        id: orderId,
        programme: selectedProgramme,
        county: trimmedCounty,
        username: userName || "Unknown",
        status: "pending",
        createdAt: now,
       
        mobileAppdata: [
          {
            date: "",
            goats: 0,
            location: "",
            subcounty: "",
          },
        ],
        targetGoats: goatsValue,
        totalGoats: 0,
        goatsBought: 0,
        remainingGoats: goatsValue,
      });
      const messageWithGoats = `${generatedSmsPreview} Ref: ${orderId}.`;
      const smsRef = push(ref(db, "smsOutbox"));
      await set(smsRef, {
        status: "pending",
        programme: selectedProgramme,
        createdAt: Date.now(),
        createdBy: userName || "unknown",
        message: messageWithGoats,
        recipients,
        recipientCount: recipients.length,
        orderId,
        batchId: orderId,
        targetOrderId: orderId,
        totalGoats: goatsValue,
      });
      if (selectedProgramme !== activeProgram) setActiveProgram(selectedProgramme);
      toast({ title: "Order created", description: `SMS queued for ${recipients.length} officers. Target: ${goatsValue.toLocaleString()} goats.` });
      closeCreateDialog();
    } catch {
      toast({ title: "Error", description: "Failed to create order.", variant: "destructive" });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-md shadow-blue-200">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Orders</h1>
            <p className="text-sm text-slate-600">Grouped order batches with totals and per-order breakdown.</p>
          </div>
        </div>
        {userCanCreateOrders && (
          <Button
            onClick={openCreateDialog}
            disabled={!activeProgram}
            className="w-fit gap-2 bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Order
          </Button>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Orders Card */}
        <Card className="border-slate-200 border-l-4 border-l-[#0B1F5F] shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
              <ShoppingCart className="h-6 w-6 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-600">Total Orders</p>
              <p className="text-2xl font-bold text-slate-900">{filteredBatchRows.length}</p>
              <p className="text-xs text-slate-500">{totalOrdersInBatches.toLocaleString()} submissions in batches</p>
            </div>
          </CardContent>
        </Card>

        {/* Goats Purchased Card */}
        <Card className="border-slate-200 border-l-4 border-l-orange-500 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100">
                <TrendingUp className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-600">Goats Purchased</p>
                <p className="text-2xl font-bold text-slate-900">{totalGoatsPurchased.toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Target: {totalTargetGoats.toLocaleString()}</span>
                <span className={`font-semibold ${purchasePercentage >= 100 ? "text-emerald-600" : purchasePercentage >= 50 ? "text-amber-600" : "text-red-500"}`}>
                  {purchasePercentage}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${purchasePercentage >= 100 ? "bg-emerald-500" : purchasePercentage >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${Math.min(purchasePercentage, 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {totalTargetGoats - totalGoatsPurchased > 0
                  ? `${(totalTargetGoats - totalGoatsPurchased).toLocaleString()} goats remaining`
                  : "Target fully achieved"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Counties Covered Card */}
        <Card className="border-slate-200 border-l-4 border-l-[#7B1E3A] shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
                <MapPin className="h-6 w-6 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-600">Counties Covered</p>
                <p className="text-2xl font-bold text-slate-900">{uniqueCounties}</p>
              </div>
            </div>
            <div className="mt-3 max-h-[88px] space-y-1 overflow-y-auto pr-1">
              {uniqueCounties === 0 ? (
                <p className="text-xs text-slate-500">No counties yet</p>
              ) : (
                Array.from(countiesMap.entries()).map(([county, goats]) => (
                  <div key={county} className="flex items-center justify-between">
                    <span className="text-xs text-slate-700 truncate mr-2">{county}</span>
                    <span className="text-[11px] font-medium text-slate-500 tabular-nums shrink-0">
                      {formatCompactNumber(goats)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-end lg:flex-row">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Search</Label>
              <Input
                placeholder="County, subcounty, user, status..."
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                className="border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">From</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
                className="border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">To</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                className="border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Status</Label>
              <Select value={filters.status} onValueChange={(v) => handleFilterChange("status", v)}>
                <SelectTrigger className="border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100 w-[140px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {availableStatuses.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {userIsChiefAdmin && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Programme</Label>
                <Select value={activeProgram} onValueChange={setActiveProgram} disabled={availablePrograms.length === 0}>
                  <SelectTrigger className="border-slate-200 bg-white focus:border-blue-400 focus:ring-blue-100 w-[130px]">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePrograms.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button variant="outline" onClick={clearFilters} className="border-slate-200 hover:bg-slate-50 shrink-0">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-5 py-3">
          <CardTitle className="text-sm font-semibold text-slate-700">Order Batches</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading orders...</div>
          ) : pageRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              {activeProgram ? "No orders found for current filters." : "No programme access."}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-slate-200 bg-slate-50/70 hover:bg-slate-50/70">
                      <TableHead className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Date</TableHead>
                      <TableHead className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">County</TableHead>
                      <TableHead className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Sub-county</TableHead>
                      <TableHead className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Ordered By</TableHead>
                      <TableHead className="h-9 px-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Target Goats</TableHead>
                      <TableHead className="h-9 px-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Available Goats</TableHead>
                      <TableHead className="h-9 px-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Purchased</TableHead>
                      <TableHead className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Status</TableHead>
                      <TableHead className="h-9 px-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((row, idx) => (
                      <OrderTableRow
                        key={row.batchId}
                        row={row}
                        idx={idx}
                        userCanEditOrders={userCanEditOrders}
                        userIsChiefAdmin={userIsChiefAdmin}
                        onView={setOrdersDialogBatchId}
                        onEdit={setOrdersDialogBatchId}
                        onDelete={deleteBatch}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3">
                <span className="text-xs text-slate-600">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, filteredBatchRows.length)} of {filteredBatchRows.length} batches
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasPrev}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                    className="border-slate-200 hover:bg-white text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasNext}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                    className="border-slate-200 hover:bg-white text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Order Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
        <DialogContent className="sm:max-w-lg bg-white rounded-2xl border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Create Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {canChooseOrderProgramme && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Programme</Label>
                <Select
                  value={resolvedOrderProgramme}
                  onValueChange={(value) => setNewOrder((prev) => ({ ...prev, programme: value }))}
                >
                  <SelectTrigger className="border-slate-200 bg-white text-sm focus:border-blue-400">
                    <SelectValue placeholder="Select programme" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePrograms.map((programme) => (
                      <SelectItem key={programme} value={programme}>
                        {programme}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Order Date *</Label>
                <Input type="date" value={newOrder.date} onChange={(e) => setNewOrder((p) => ({ ...p, date: e.target.value }))} className="border-slate-200 bg-white text-sm focus:border-blue-400" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Target Goats *</Label>
                <Input type="number" min={1} value={newOrder.goats} onChange={(e) => setNewOrder((p) => ({ ...p, goats: e.target.value }))} placeholder="Total goats to collect" className="border-slate-200 bg-white text-sm focus:border-blue-400" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">County *</Label>
              <Select
                value={newOrder.county}
                onValueChange={(value) => {
                  setNewOrder((prev) => ({ ...prev, county: value }));
                  setSelectedFieldOfficerIds([]);
                }}
                disabled={fieldOfficersLoading || countyOptions.length === 0}
              >
                <SelectTrigger className="border-slate-200 bg-white text-sm focus:border-blue-400">
                  <SelectValue
                    placeholder={
                      fieldOfficersLoading
                        ? "Loading counties..."
                        : countyOptions.length === 0
                          ? "No assigned counties"
                          : "Select county"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {countyOptions.map((county) => (
                    <SelectItem key={county} value={county}>
                      {county}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!fieldOfficersLoading && countyOptions.length === 0 && (
                <p className="text-[11px] text-slate-500">No counties found on mobile users in site management.</p>
              )}
            </div>

            {/* Field Officers */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Field Officers *</Label>
              {fieldOfficersLoading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Loading...</div>
              ) : !newOrder.county ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">Select a county to load field officers.</div>
              ) : countyFieldOfficers.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No field officers assigned to this county.</div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between border-slate-200 bg-white text-sm">
                      <span>{selectedOfficersSummary}</span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="max-h-56 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto" align="start">
                    {countyFieldOfficers.map((officer) => (
                      <DropdownMenuCheckboxItem
                        key={officer.id}
                        disabled={!officer.phone}
                        checked={selectedFieldOfficerIds.includes(officer.id)}
                        onCheckedChange={() => toggleFieldOfficerSelection(officer.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {officer.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {selectedOfficersPreview && <p className="text-[11px] text-slate-500">{selectedOfficersPreview}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={closeCreateDialog} disabled={creatingOrder} className="border-slate-200 text-sm">Cancel</Button>
            <Button onClick={handleCreateOrder} disabled={creatingOrder} className="bg-blue-600 text-white hover:bg-blue-700 text-sm shadow-sm">
              {creatingOrder ? "Creating..." : "Create Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={Boolean(ordersDialogBatchId && ordersDialogRow)} onOpenChange={(open) => { if (!open) closeOrdersDialog(); }}>
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl border-slate-200 shadow-xl max-h-[90vh] overflow-hidden">
          <DialogHeader className="border-b border-slate-100 pb-3">
            <DialogTitle className="text-slate-900">Order Details</DialogTitle>
          </DialogHeader>

          {ordersDialogRow ? (
            <div className="space-y-4 overflow-y-auto pr-1 py-4">
              {/* Summary Grid */}
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "Date", value: formatDate(ordersDialogRow.batchDate)},
                  { label: "County", value: ordersDialogRow.county },
                  { label: "Sub-county", value: ordersDialogRow.subcounty },
                  { label: "Status", badge: ordersDialogRow.status },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-150 bg-slate-50/60 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{item.label}</p>
                    {item.badge ? (
                      <Badge variant="outline" className={`mt-1 ${getStatusBadgeClass(item.badge)}`}>{item.badge}</Badge>
                    ) : (
                      <p className="mt-0.5 text-sm font-semibold text-slate-800">{item.value || "—"}</p>
                    )}
                    {item.sub && <p className="mt-0.5 text-[10px] text-slate-500 font-mono">{item.sub}</p>}
                  </div>
                ))}
              </div>

              {/* Progress Section */}
              <div className="rounded-lg border border-slate-150 bg-slate-50/60 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Progress</p>
                {userCanEditOrders && dialogGoatsBoughtDraft !== "" ? (
                  <div className="mt-1.5 flex items-center gap-2">
                    <Input type="number" min={0} max={ordersDialogRow.targetGoats || ordersDialogRow.totalGoats} value={dialogGoatsBoughtDraft} onChange={(e) => setDialogGoatsBoughtDraft(e.target.value)} className="h-8 max-w-32 text-right text-sm border-slate-200" />
                    <span className="text-xs text-slate-500">/ {(ordersDialogRow.targetGoats || ordersDialogRow.totalGoats).toLocaleString()}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8 border-slate-200" onClick={saveDialogGoatsBought}><Save className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="outline" className="h-8 w-8 border-slate-200" onClick={() => setDialogGoatsBoughtDraft("")}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {ordersDialogRow.goatsBought.toLocaleString()} / {(ordersDialogRow.targetGoats || ordersDialogRow.totalGoats).toLocaleString()}
                    </p>
                    {userCanEditOrders && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400 hover:text-blue-600" onClick={() => setDialogGoatsBoughtDraft(String(ordersDialogRow.goatsBought))} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${ordersDialogRow.status === "completed" ? "bg-emerald-500" : "bg-blue-400"}`}
                    style={{ width: `${Math.min((ordersDialogRow.targetGoats || ordersDialogRow.totalGoats) > 0 ? (ordersDialogRow.goatsBought / (ordersDialogRow.targetGoats || ordersDialogRow.totalGoats)) * 100 : 0, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{ordersDialogRow.remainingGoats.toLocaleString()} remaining</p>
              </div>

              {/* Status Banner */}
              {ordersDialogRow.status === "completed" ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  Target achieved. This order is closed.
                </div>
              ) : (
                <div className={`rounded-lg border p-3 text-sm ${ordersDialogRow.isReadyForCompletion ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-relaxed">
                      {ordersDialogRow.isReadyForCompletion
                        ? "All submissions attached. Review and mark complete."
                        : `${ordersDialogRow.remainingGoats.toLocaleString()} goats remaining.`}
                    </p>
                    {userCanEditOrders && (
                      <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700 text-xs shadow-sm shrink-0" onClick={() => markOrderComplete(ordersDialogRow)}>
                        Mark Complete
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Submissions Table */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Field Officer Submissions ({ordersDialogRow.items.filter((item) => item.goats > 0 || item.date).length})
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-slate-100 bg-slate-50/50 hover:bg-slate-50/50">
                        <TableHead className="h-8 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Date</TableHead>
                        {ordersDialogHasOfficerColumn && (
                          <TableHead className="h-8 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Field Officer</TableHead>
                        )}
                        <TableHead className="h-8 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sub-county</TableHead>
                        <TableHead className="h-8 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Location</TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Goats</TableHead>
                        <TableHead className="h-8 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ordersDialogRow.items.filter((item) => item.goats > 0 || item.date).map((item, filteredIndex) => {
                        const index = ordersDialogRow.items.indexOf(item);
                        const orderKey = `${ordersDialogRow.batchId}:${index}`;
                        const isEditing = userCanEditOrders && editingOrderKey === orderKey;
                        return (
                          <TableRow key={orderKey} className="border-b border-slate-50 hover:bg-blue-50/30">
                            <TableCell className="px-3 py-2">
                              {isEditing ? (
                                <Input type="date" value={orderDateDraft} onChange={(e) => setOrderDateDraft(e.target.value)} className="h-7 max-w-36 text-xs border-slate-200" />
                              ) : (
                                <span className="text-xs text-slate-700">{formatDate(item.date)}</span>
                              )}
                            </TableCell>
                            {ordersDialogHasOfficerColumn && (
                              <TableCell className="px-3 py-2">
                                {isEditing ? (
                                  <Input value={orderOfficerDraft} onChange={(e) => setOrderOfficerDraft(e.target.value)} className="h-7 text-xs border-slate-200" placeholder="Officer" />
                                ) : (
                                  <span className="text-xs text-slate-700 max-w-[120px] truncate block">{item.officer}</span>
                                )}
                              </TableCell>
                            )}
                            <TableCell className="px-3 py-2">
                              {isEditing ? (
                                <Input value={orderSubcountyDraft} onChange={(e) => setOrderSubcountyDraft(e.target.value)} className="h-7 text-xs border-slate-200" placeholder="Sub-county" />
                              ) : (
                                <span className="text-xs text-slate-700">{item.subcounty || "—"}</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              {isEditing ? (
                                <Input value={orderLocationDraft} onChange={(e) => setOrderLocationDraft(e.target.value)} className="h-7 text-xs border-slate-200" placeholder="Location" />
                              ) : (
                                <span className="text-xs text-slate-700">{item.location}</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right">
                              {isEditing ? (
                                <Input type="number" min={0} value={orderGoatsDraft} onChange={(e) => setOrderGoatsDraft(e.target.value)} className="ml-auto h-7 max-w-24 text-right text-xs border-slate-200" />
                              ) : (
                                <span className="text-xs font-semibold tabular-nums text-slate-800">{item.goats.toLocaleString()}</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2 text-right">
                              {isEditing ? (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="outline" className="h-7 text-[11px] border-slate-200" onClick={() => saveOrderEdit(ordersDialogRow, index)}>
                                    <Save className="mr-1 h-3 w-3" />Save
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-[11px] border-slate-200" onClick={cancelOrderEdit}>
                                    <X className="mr-1 h-3 w-3" />Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex justify-end gap-0.5">
                                  {userCanEditOrders && (
                                    <>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-amber-600 hover:bg-amber-50" onClick={() => startOrderEdit(ordersDialogRow, item, index)} title="Edit">
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" onClick={() => deleteOrderItem(ordersDialogRow, index)} title="Delete">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {ordersDialogRow.items.filter((item) => item.goats > 0 || item.date).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={ordersDialogHasOfficerColumn ? 6 : 5} className="py-6 text-center text-xs text-slate-500">
                            No submissions attached yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrdersPage;
