import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { onValue, orderByChild, equalTo, query, ref, remove, update, push, get, set } from "firebase/database";
import { db } from "@/lib/firebase";
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
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Eye, Pencil, Plus, Save, ShoppingCart, Trash2, X } from "lucide-react";

interface OrderItem {
  id?: string;
  date?: string | number;
  goats?: number;
  location?: string;
  village?: string;
  fieldOfficer?: string;
  fieldOfficerName?: string;
  officer?: string;
  officerName?: string;
  createdBy?: string;
  username?: string;
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
  orderId?: string;
  officer?: string;
  officerName?: string;
  orders?: OrderItem[] | Record<string, OrderItem>;
  offtakeOrderId?: string;
  parentOrderId?: string;
  programme?: string;
  requestId?: string;
  remainingGoats?: number;
  sourcePage?: string;
  status?: string;
  subcounty?: string;
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
  officer: string;
  raw?: OrderItem;
}

interface BatchOrderRow {
  batchId: string;
  batchDate: string | number;
  createdAt: string | number;
  completedAt: string | number;
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
  if (status === "completed") return "bg-green-100 text-green-700 border-green-200";
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

const normalizeText = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")
    : "";

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

const getOrderEntries = (orders: OrderRecord["orders"]): OrderItem[] => {
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
  const hasOrders = getOrderEntries(record.orders).length > 0;
  const hasTarget = Number.isFinite(Number(record.totalGoats)) && Number(record.totalGoats) > 0;
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

  const ordersCount = getOrderEntries(record.orders).length;
  const hasTarget = Number.isFinite(Number(record.totalGoats)) && Number(record.totalGoats) > 0;
  const hasProgress =
    Number.isFinite(Number(record.remainingGoats)) || Number.isFinite(Number(record.goatsBought));
  const hasStatus = typeof record.status === "string" && record.status.trim().length > 0;
  const sourcePage = normalizeText(record.sourcePage);

  if (sourcePage && sourcePage !== "orders") return true;
  if (hasTopLevelGoats(record) && ordersCount === 0) return true;
  if (ordersCount > 0 && !hasProgress && !hasStatus && sourcePage !== "orders") return true;

  return false;
};

const isBatchRecord = (record: OrderRecord): boolean => {
  if (isSubmissionRecord(record)) return false;

  const hasOrders = getOrderEntries(record.orders).length > 0;
  const total = Number(record.totalGoats);
  const hasTarget = Number.isFinite(total) && total > 0;
  const hasProgress =
    Number.isFinite(Number(record.remainingGoats)) || Number.isFinite(Number(record.goatsBought));
  const hasStatus = typeof record.status === "string" && record.status.trim().length > 0;

  if (hasOrders) return true;
  if (hasTarget && (hasProgress || hasStatus)) return true;
  return false;
};

const getSubmissionItems = (record: OrderRecord): NormalizedOrderItem[] => {
  const orderEntries = getOrderEntries(record.orders);
  if (orderEntries.length > 0) {
    return orderEntries.map((item, index) => {
      const itemLocation = item.location || item.village || record.location || record.village || "N/A";
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
        officer,
        raw: item,
      };
    });
  }

  const goatsValue = Number(record.goats || record.totalGoats || record.goatsBought || 0);
  if (!Number.isFinite(goatsValue) || goatsValue <= 0) return [];
  const dateValue = record.date || record.completedAt || record.createdAt || record.timestamp || "";
  const location = record.location || record.village || "N/A";
  const officer = record.username || record.createdBy || "N/A";
  return [
    {
      id: record.id,
      date: dateValue,
      goats: goatsValue,
      location,
      village: location,
      officer,
    },
  ];
};

const getNormalizedItems = (record: OrderRecord): NormalizedOrderItem[] => {
  const orderEntries = getOrderEntries(record.orders);
  if (orderEntries.length > 0) {
    return orderEntries.map((item, index) => {
        const itemLocation = item.location || item.village || record.location || "N/A";
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
          officer,
          raw: item,
        };
      });
    }

  return [];
};

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
  const [selectedFieldOfficerIds, setSelectedFieldOfficerIds] = useState<string[]>([]);
  const [smsMessage, setSmsMessage] = useState("");

  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [goatsBoughtDraft, setGoatsBoughtDraft] = useState<string>("");

  const [editingOrderKey, setEditingOrderKey] = useState<string | null>(null);
  const [orderGoatsDraft, setOrderGoatsDraft] = useState<string>("");
  const [orderDateDraft, setOrderDateDraft] = useState<string>("");
  const [orderOfficerDraft, setOrderOfficerDraft] = useState<string>("");
  const [orderLocationDraft, setOrderLocationDraft] = useState<string>("");

  const monthDates = useMemo(getCurrentMonthDates, []);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    startDate: monthDates.startDate,
    endDate: monthDates.endDate,
    status: "all",
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });

  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const userIsChiefAdmin = useMemo(() => isChiefAdmin(userRole), [userRole]);
  const permissionPrincipal = useMemo(
    () => resolvePermissionPrincipal(userRole, userAttribute),
    [userRole, userAttribute]
  );
  const userCanEditOrders = useMemo(
    () => isChiefAdmin(permissionPrincipal) || isOfftakeOfficer(permissionPrincipal),
    [permissionPrincipal]
  );

  const ensureOrderEditAccess = () => {
    if (userCanEditOrders) return true;
    toast({
      title: "Unauthorized",
      description: "Only offtake officer or chief admin can edit orders.",
      variant: "destructive",
    });
    return false;
  };

  const ensureBatchDeleteAccess = () => {
    if (userIsChiefAdmin) return true;
    toast({
      title: "Unauthorized",
      description: "Only chief admin can delete batches.",
      variant: "destructive",
    });
    return false;
  };

  useEffect(() => {
    if (userCanViewAllProgrammeData) {
      setAvailablePrograms(PROGRAMME_OPTIONS);
      setActiveProgram((prev) => prev || PROGRAMME_OPTIONS[0]);
      return;
    }

    const assignedPrograms = Object.keys(allowedProgrammes || {}).filter((programme) => allowedProgrammes?.[programme]);
    setAvailablePrograms(assignedPrograms);
    setActiveProgram((prev) => {
      if (assignedPrograms.length === 0) return "";
      if (prev && assignedPrograms.includes(prev)) return prev;
      return assignedPrograms[0];
    });
  }, [allowedProgrammes, userCanViewAllProgrammeData]);

  useEffect(() => {
    if (!activeProgram) {
      setAllRecords([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ordersRef = query(ref(db, "orders"), orderByChild("programme"), equalTo(activeProgram));

    const unsubscribe = onValue(
      ordersRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          setAllRecords([]);
          setLoading(false);
          return;
        }

        const records: OrderRecord[] = Object.keys(data).map((key) => {
          const recordData = data[key] as Partial<OrderRecord> & { id?: string };
          return {
            ...recordData,
            id: key,
            recordId: recordData?.id || key,
          };
        });

        records.sort((a, b) => {
          const aDate = parseDate(a.completedAt || a.createdAt || a.timestamp)?.getTime() || 0;
          const bDate = parseDate(b.completedAt || b.createdAt || b.timestamp)?.getTime() || 0;
          return bDate - aDate;
        });

        setAllRecords(records);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsubscribe();
  }, [activeProgram]);

  useEffect(() => {
    setOrdersDialogBatchId(null);
  }, [activeProgram]);

  useEffect(() => {
    let isActive = true;

    const loadFieldOfficers = async () => {
      setFieldOfficersLoading(true);
      try {
        const snapshot = await get(ref(db, "users"));
        const data = snapshot.val() as Record<string, FieldOfficerRecord> | null;
        if (!data) {
          if (isActive) setFieldOfficers([]);
          return;
        }

        const officers = Object.entries(data)
          .map(([id, record]) => {
            if (!isMobileUserRecord(record)) return null;

            return {
              id,
              name: getOfficerDisplayName(record),
              phone: getOfficerPhone(record),
              aliases: [
                record.name,
                record.userName,
                record.username,
                record.displayName,
                record.email,
                id,
              ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
            };
          })
          .filter((officer): officer is FieldOfficerOption => Boolean(officer))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (isActive) setFieldOfficers(officers);
      } catch (error) {
        console.error("Failed to load field officers:", error);
        if (isActive) {
          setFieldOfficers([]);
          toast({
            title: "Error",
            description: "Failed to load mobile users.",
            variant: "destructive",
          });
        }
      } finally {
        if (isActive) setFieldOfficersLoading(false);
      }
    };

    loadFieldOfficers();

    return () => {
      isActive = false;
    };
  }, [activeProgram, toast]);

  const batchRows = useMemo(() => {
    const batchMap = new Map<string, { record: OrderRecord; items: NormalizedOrderItem[]; itemIds: Set<string> }>();
    const batchAliasMap = new Map<string, string>();
    const consumedRecordIds = new Set<string>();
    const mobileOfficerTokens = new Set<string>();

    fieldOfficers.forEach((officer) => {
      const candidates = [officer.name, officer.id, officer.phone, ...(officer.aliases || [])];
      candidates.forEach((value) => {
        const token = normalizeText(value);
        if (token) mobileOfficerTokens.add(token);
      });
    });

    const registerAlias = (value: unknown, batchId: string) => {
      const normalized = normalizeIdValue(value);
      if (!normalized) return;
      if (!batchAliasMap.has(normalized)) batchAliasMap.set(normalized, batchId);
    };

    const isMobileOfficerRecord = (record: OrderRecord): boolean => {
      const toToken = (value: unknown) => {
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        return normalizeText(value);
      };
      const candidates = getRecordOfficerCandidates(record);
      return candidates.some((value) => {
        const token = toToken(value);
        return token.length > 0 && mobileOfficerTokens.has(token);
      });
    };

    const attachRecordToBatch = (record: OrderRecord, batchId: string): boolean => {
      const parent = batchMap.get(batchId);
      if (!parent) return false;

      const submissionItems = getSubmissionItems(record);
      if (submissionItems.length === 0) return false;

      const filteredItems = submissionItems.filter((item) => !parent.itemIds.has(item.id));
      if (filteredItems.length === 0) return false;

      filteredItems.forEach((item) => parent.itemIds.add(item.id));
      parent.items = [...parent.items, ...filteredItems];
      return true;
    };

    const findBestBatchMatch = (record: OrderRecord): string | null => {
      const recordId = normalizeIdValue(record.id);
      const recordProgramme = normalizeText(record.programme);
      const recordCounty = normalizeText(record.county);
      const recordLocation = normalizeText(record.location || record.village || record.subcounty);
      const recordDate = parseDate(record.date || record.completedAt || record.createdAt || record.timestamp);
      const recordTotal = Number(record.totalGoats || record.goatsBought || record.goats || 0);

      let bestBatchId: string | null = null;
      let bestScore = 0;

      for (const [batchId, parent] of batchMap.entries()) {
        if (batchId === recordId) continue;

        const parentRecord = parent.record;
        const parentProgramme = normalizeText(parentRecord.programme);
        const parentCounty = normalizeText(parentRecord.county);
        const parentLocation = normalizeText(parentRecord.location || parentRecord.village || parentRecord.subcounty);
        const parentDate = parseDate(
          parentRecord.date || parentRecord.completedAt || parentRecord.createdAt || parentRecord.timestamp
        );
        const parentTotal = Number(parentRecord.totalGoats || parentRecord.goatsBought || parentRecord.goats || 0);

        let score = 0;

        if (recordProgramme && parentProgramme && recordProgramme === parentProgramme) score += 3;
        if (recordCounty && parentCounty && recordCounty === parentCounty) score += 2;
        if (recordLocation && parentLocation && recordLocation === parentLocation) score += 4;

        if (recordDate && parentDate) {
          const dayDiff = Math.abs(recordDate.getTime() - parentDate.getTime()) / (1000 * 60 * 60 * 24);
          if (dayDiff <= 1) score += 4;
          else if (dayDiff <= 7) score += 3;
          else if (dayDiff <= 30) score += 1;
        }

        if (recordTotal > 0 && parentTotal > 0 && recordTotal === parentTotal) score += 2;
        if (normalizeStatus(parentRecord.status) !== "completed") score += 1;

        if (score > bestScore) {
          bestScore = score;
          bestBatchId = batchId;
        }
      }

      return bestScore >= 6 ? bestBatchId : null;
    };

    allRecords.forEach((record) => {
      if (!isBatchRecord(record)) return;
      const batchId = record.id;
      const items = getNormalizedItems(record);
      batchMap.set(batchId, {
        record,
        items,
        itemIds: new Set(items.map((item) => item.id)),
      });
      getBatchIdentifiers(record).forEach((identifier) => registerAlias(identifier, batchId));
    });

    const resolveBatchId = (record: OrderRecord): string | null => {
      const explicitRef = getBatchReferenceId(record);
      if (explicitRef) {
        const mapped = batchAliasMap.get(explicitRef);
        if (mapped) return mapped;
        if (batchMap.has(explicitRef)) return explicitRef;
      }

      for (const [key, value] of Object.entries(record)) {
        if (!looksLikeReferenceKey(key)) continue;
        const normalized = normalizeIdValue(value);
        if (!normalized) continue;
        const mapped = batchAliasMap.get(normalized);
        if (mapped) return mapped;
      }

      if (isSubmissionRecord(record) || isMobileOfficerRecord(record)) {
        return findBestBatchMatch(record);
      }

      return null;
    };

    allRecords.forEach((record) => {
      if (isBatchRecord(record)) return;

      const recordId = normalizeIdValue(record.id);
      if (recordId && consumedRecordIds.has(recordId)) return;

      const batchId = resolveBatchId(record);
      if (!batchId || batchId === record.id) return;

      const parent = batchMap.get(batchId);
      if (!parent) return;

      if (attachRecordToBatch(record, batchId) && recordId) {
        consumedRecordIds.add(recordId);
      }
    });

    return Array.from(batchMap.values())
      .filter(({ record }) => {
        const recordId = normalizeIdValue(record.id);
        return !recordId || !consumedRecordIds.has(recordId);
      })
      .map(({ record, items }) => {
      const itemsTotal = items.reduce((sum, item) => sum + Number(item.goats || 0), 0);
      const totalGoats = getBatchTotalGoats(record, itemsTotal);
      const goatsBought = clamp(Math.max(Number(record.goatsBought || 0), itemsTotal), 0, Math.max(totalGoats, 0));
      const remainingGoats = Math.max(totalGoats - goatsBought, 0);
      const createdAt = record.createdAt || record.timestamp || "";
      const completedAt = record.completedAt || "";
      const batchDate = record.date || completedAt || createdAt || items[0]?.date || "";
      const storedStatus = normalizeStatus(record.status);
      const isReadyForCompletion = totalGoats > 0 && remainingGoats <= 0 && storedStatus !== "completed";
      const status = storedStatus === "completed"
        ? "completed"
        : goatsBought > 0 || items.length > 0
          ? "in-progress"
          : "pending";

      return {
        batchId: record.id,
        batchDate,
        createdAt,
        completedAt,
        totalGoats,
        recordedGoats: itemsTotal,
        goatsBought,
        remainingGoats,
        status,
        county: record.county || "N/A",
        subcounty: record.subcounty || "N/A",
        location: record.location || items[0]?.location || items[0]?.village || "N/A",
        programme: record.programme || activeProgram || "N/A",
        username: record.username || record.createdBy || items[0]?.officer || "N/A",
        sortTimestamp: parseDate(batchDate)?.getTime() || 0,
        isReadyForCompletion,
        items,
      };
    });
  }, [allRecords, activeProgram, fieldOfficers]);

  const ordersDialogRow = useMemo(
    () => batchRows.find((row) => row.batchId === ordersDialogBatchId) || null,
    [batchRows, ordersDialogBatchId]
  );

  const ordersDialogHasOfficerColumn = useMemo(
    () =>
      Boolean(
        ordersDialogRow?.items.some(
          (item) => normalizeText(item.officer) && normalizeText(item.officer) !== "n/a"
        )
      ),
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

  const filteredBatchRows = useMemo(() => {
    const searchTerm = filters.search.toLowerCase().trim();

    const rows = batchRows.filter((row) => {
      if (filters.status !== "all" && row.status !== filters.status) return false;

      const rowDate = parseDate(row.batchDate);
      if (filters.startDate || filters.endDate) {
        if (!rowDate) return false;
        const start = filters.startDate ? new Date(filters.startDate) : null;
        const end = filters.endDate ? new Date(filters.endDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        if (end) end.setHours(23, 59, 59, 999);
        if (start && rowDate < start) return false;
        if (end && rowDate > end) return false;
      }

      if (!searchTerm) return true;

      return [
        row.county,
        row.location,
        row.username,
        row.status,
        row.programme,
        row.batchId,
        row.totalGoats.toString(),
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });

    rows.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
    return rows;
  }, [batchRows, filters]);

  const totalGoats = useMemo(
    () => filteredBatchRows.reduce((sum, row) => sum + row.totalGoats, 0),
    [filteredBatchRows]
  );

  const totalOrdersInBatches = useMemo(
    () => filteredBatchRows.reduce((sum, row) => sum + row.items.length, 0),
    [filteredBatchRows]
  );

  useEffect(() => {
    setPagination((prev) => {
      const totalPages = Math.max(1, Math.ceil(filteredBatchRows.length / prev.limit));
      const page = Math.min(prev.page, totalPages);
      return {
        ...prev,
        page,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    });
  }, [filteredBatchRows.length]);

  const pageRows = useMemo(() => {
    const start = (pagination.page - 1) * pagination.limit;
    return filteredBatchRows.slice(start, start + pagination.limit);
  }, [filteredBatchRows, pagination.page, pagination.limit]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    batchRows.forEach((row) => set.add(row.status));
    return Array.from(set).sort();
  }, [batchRows]);

  const selectedOfficerNames = useMemo(
    () => fieldOfficers.filter((officer) => selectedFieldOfficerIds.includes(officer.id)).map((officer) => officer.name),
    [fieldOfficers, selectedFieldOfficerIds]
  );

  const selectedOfficersSummary = useMemo(() => {
    if (selectedOfficerNames.length === 0) return "Select field officers";
    return `${selectedOfficerNames.length} selected`;
  }, [selectedOfficerNames.length]);

  const selectedOfficersPreview = useMemo(() => {
    if (selectedOfficerNames.length === 0) return "";
    const preview = selectedOfficerNames.slice(0, 3).join(", ");
    if (selectedOfficerNames.length <= 3) return preview;
    return `${preview} +${selectedOfficerNames.length - 3} more`;
  }, [selectedOfficerNames]);

  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      search: "",
      startDate: "",
      endDate: "",
      status: "all",
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const closeOrdersDialog = () => {
    setOrdersDialogBatchId(null);
    setEditingOrderKey(null);
    setOrderGoatsDraft("");
    setOrderDateDraft("");
    setOrderOfficerDraft("");
    setOrderLocationDraft("");
  };

  const resetNewOrderForm = (programme: string) => {
    setNewOrder(getDefaultOrderForm(programme));
    setSelectedFieldOfficerIds([]);
    setSmsMessage("");
  };

  const openCreateDialog = () => {
    if (!activeProgram) {
      toast({
        title: "Select programme",
        description: "Please select a programme before creating an order.",
        variant: "destructive",
      });
      return;
    }
    resetNewOrderForm(activeProgram);
    setIsCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false);
  };

  const toggleFieldOfficerSelection = (officerId: string) => {
    setSelectedFieldOfficerIds((prev) =>
      prev.includes(officerId) ? prev.filter((id) => id !== officerId) : [...prev, officerId]
    );
  };

  const updateBatchOrders = async (
    row: BatchOrderRow,
    nextItems: NormalizedOrderItem[],
    nextGoatsBought?: number
  ) => {
    const sanitizedItems = nextItems.map((item, index) => {
      const orderLocation = item.location || item.village || row.location || "";
      const officerName = item.officer || "";
      return {
        ...(item.raw ?? {}),
        id: item.id || `${row.batchId}-${index + 1}`,
        goats: Math.max(0, Number(item.goats || 0)),
        date: item.date || row.batchDate || "",
        location: orderLocation,
        village: item.village || orderLocation,
        fieldOfficer: officerName,
        officer: officerName,
      };
    });

    const itemsTotal = sanitizedItems.reduce((sum, item) => sum + item.goats, 0);
    const targetGoats = row.totalGoats > 0 ? row.totalGoats : itemsTotal;
    const goatsBought = clamp(
      Math.max(typeof nextGoatsBought === "number" ? nextGoatsBought : Number(row.goatsBought || 0), itemsTotal),
      0,
      Math.max(targetGoats, 0)
    );
    const remainingGoats = Math.max(targetGoats - goatsBought, 0);
    const storedStatus = normalizeStatus(row.status);
    const nextStatus =
      storedStatus === "completed"
        ? "completed"
        : goatsBought > 0 || itemsTotal > 0
          ? "in-progress"
          : "pending";
    const nextCompletedAt = storedStatus === "completed" ? row.completedAt || new Date().toISOString() : "";

    await update(ref(db, `orders/${row.batchId}`), {
      orders: sanitizedItems,
      totalGoats: targetGoats,
      goatsBought,
      remainingGoats,
      status: nextStatus,
      completedAt: nextCompletedAt,
    });
  };

  const startGoatsBoughtEdit = (row: BatchOrderRow) => {
    if (!ensureOrderEditAccess()) return;
    setEditingBatchId(row.batchId);
    setGoatsBoughtDraft(String(row.goatsBought || 0));
  };

  const cancelGoatsBoughtEdit = () => {
    setEditingBatchId(null);
    setGoatsBoughtDraft("");
  };

  const saveGoatsBoughtEdit = async (row: BatchOrderRow) => {
    if (!ensureOrderEditAccess()) return;
    const nextValue = Number(goatsBoughtDraft);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      toast({ title: "Invalid value", description: "Goats bought must be a number 0 or greater.", variant: "destructive" });
      return;
    }
    if (nextValue > row.totalGoats) {
      toast({
        title: "Invalid value",
        description: "Goats bought cannot be greater than total goats in the batch.",
        variant: "destructive",
      });
      return;
    }

    try {
      const remainingGoats = Math.max(row.totalGoats - nextValue, 0);
      const storedStatus = normalizeStatus(row.status);
      const nextStatus =
        storedStatus === "completed"
          ? "completed"
          : nextValue > 0
            ? "in-progress"
            : "pending";
      const nextCompletedAt = storedStatus === "completed" ? row.completedAt || new Date().toISOString() : "";

      await update(ref(db, `orders/${row.batchId}`), {
        goatsBought: nextValue,
        remainingGoats,
        status: nextStatus,
        completedAt: nextCompletedAt,
      });
      toast({ title: "Updated", description: "Goats bought updated successfully." });
      cancelGoatsBoughtEdit();
    } catch {
      toast({ title: "Error", description: "Failed to update goats bought.", variant: "destructive" });
    }
  };

  const markOrderComplete = async (row: BatchOrderRow) => {
    if (!ensureOrderEditAccess()) return;

    const confirmMessage =
      row.remainingGoats > 0
        ? `This order still has ${row.remainingGoats.toLocaleString()} goats remaining. Mark it complete anyway?`
        : "Mark this parent order as complete?";

    if (!window.confirm(confirmMessage)) return;

    try {
      await update(ref(db, `orders/${row.batchId}`), {
        status: "completed",
        completedAt: row.completedAt || new Date().toISOString(),
        goatsBought: Math.max(row.totalGoats, row.goatsBought, row.recordedGoats),
        remainingGoats: 0,
      });
      toast({ title: "Completed", description: "Order marked as complete." });
    } catch {
      toast({ title: "Error", description: "Failed to mark order complete.", variant: "destructive" });
    }
  };

  const startOrderEdit = (row: BatchOrderRow, item: NormalizedOrderItem, index: number) => {
    if (!ensureOrderEditAccess()) return;
    setEditingOrderKey(`${row.batchId}:${index}`);
    setOrderGoatsDraft(String(item.goats || 0));
    setOrderDateDraft(toInputDate(item.date));
    setOrderOfficerDraft(item.officer === "N/A" ? "" : item.officer || "");
    setOrderLocationDraft(item.location === "N/A" ? "" : item.location || "");
  };

  const cancelOrderEdit = () => {
    setEditingOrderKey(null);
    setOrderGoatsDraft("");
    setOrderDateDraft("");
    setOrderOfficerDraft("");
    setOrderLocationDraft("");
  };

  const saveOrderEdit = async (row: BatchOrderRow, index: number) => {
    if (!ensureOrderEditAccess()) return;
    const nextGoats = Number(orderGoatsDraft);
    if (!Number.isFinite(nextGoats) || nextGoats < 0) {
      toast({ title: "Invalid value", description: "Order goats must be a number 0 or greater.", variant: "destructive" });
      return;
    }
    if (!orderDateDraft) {
      toast({ title: "Date required", description: "Please provide an order date.", variant: "destructive" });
      return;
    }
    if (!orderOfficerDraft.trim()) {
      toast({ title: "Field officer required", description: "Please provide the field officer name.", variant: "destructive" });
      return;
    }

    const nextItems = row.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            goats: nextGoats,
            date: orderDateDraft,
            officer: orderOfficerDraft.trim(),
            location: orderLocationDraft.trim() || item.location,
          }
        : item
    );

    try {
      await updateBatchOrders(row, nextItems);
      toast({ title: "Updated", description: "Order item updated successfully." });
      cancelOrderEdit();
    } catch {
      toast({ title: "Error", description: "Failed to update order item.", variant: "destructive" });
    }
  };

  const deleteOrderItem = async (row: BatchOrderRow, index: number) => {
    if (!ensureOrderEditAccess()) return;
    const confirmed = window.confirm("Delete this order item from the batch?");
    if (!confirmed) return;

    const nextItems = row.items.filter((_, itemIndex) => itemIndex !== index);

    try {
      await updateBatchOrders(row, nextItems);
      toast({ title: "Deleted", description: "Order item deleted successfully." });
    } catch {
      toast({ title: "Error", description: "Failed to delete order item.", variant: "destructive" });
    }
  };

  const deleteBatch = async (row: BatchOrderRow) => {
    if (!ensureBatchDeleteAccess()) return;
    const confirmed = window.confirm("Delete this batch and all its orders?");
    if (!confirmed) return;

    try {
      await remove(ref(db, `orders/${row.batchId}`));
      if (ordersDialogBatchId === row.batchId) closeOrdersDialog();
      if (editingBatchId === row.batchId) cancelGoatsBoughtEdit();
      toast({ title: "Deleted", description: "Batch deleted successfully." });
    } catch {
      toast({ title: "Error", description: "Failed to delete batch.", variant: "destructive" });
    }
  };

  const handleCreateOrder = async () => {
    if (!activeProgram) {
      toast({
        title: "Select programme",
        description: "Please select a programme before creating an order.",
        variant: "destructive",
      });
      return;
    }

    const trimmedCounty = newOrder.county.trim();
    const goatsValue = Number(newOrder.goats);
    const messageText = smsMessage.trim();
    const selectedOfficers = fieldOfficers.filter((officer) => selectedFieldOfficerIds.includes(officer.id));
    const recipients = Array.from(new Set(selectedOfficers.map((officer) => officer.phone).filter(Boolean)));

    if (!newOrder.date) {
      toast({ title: "Date required", description: "Please select the order date.", variant: "destructive" });
      return;
    }

    if (!trimmedCounty) {
      toast({
        title: "Missing details",
        description: "County is required.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(goatsValue) || goatsValue <= 0) {
      toast({
        title: "Invalid goats",
        description: "Goats must be a number greater than 0.",
        variant: "destructive",
      });
      return;
    }

    if (!messageText) {
      toast({
        title: "Message required",
        description: "Please type the SMS message to send.",
        variant: "destructive",
      });
      return;
    }

    if (recipients.length === 0) {
      toast({
        title: "No recipients",
        description: "Select at least one field officer with a phone number.",
        variant: "destructive",
      });
      return;
    }

    setCreatingOrder(true);
    try {
      const now = new Date().toISOString();
      const orderRef = push(ref(db, "orders"));
      const orderId = orderRef.key || null;
      await set(orderRef, {
        id: orderId,
        programme: newOrder.programme || activeProgram,
        county: trimmedCounty,
        username: userName || "Unknown",
        status: "pending",
        createdAt: now,
        sourcePage: "orders",
        orders: [],
        totalGoats: goatsValue,
        goatsBought: 0,
        remainingGoats: goatsValue,
      });

      const messageWithGoats = `${messageText} | Ref: ${orderId} | Goats: ${goatsValue.toLocaleString()}`;
      const smsRef = push(ref(db, "smsOutbox"));
      await set(smsRef, {
        status: "pending",
        sourcePage: "orders",
        programme: newOrder.programme || activeProgram,
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

      toast({
        title: "Order created",
        description: `Order created and SMS queued for ${recipients.length} field officers.`,
      });
      closeCreateDialog();
    } catch {
      toast({ title: "Error", description: "Failed to create order or queue SMS.", variant: "destructive" });
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
              <p className="text-sm text-slate-500">Grouped order batches with totals and per-order breakdown.</p>
            </div>
          </div>
          <Button
            onClick={openCreateDialog}
            disabled={!activeProgram}
            className="w-fit gap-2 bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Order
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Order Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{filteredBatchRows.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Orders In Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{totalOrdersInBatches.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Total Goats</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{totalGoats.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col md:flex-row lg:flex-row md:items-center gap-2 ">
            <div className="space-y-2 lg:col-span-2">
             
              <Input
                id="search"
                placeholder="Search county, user..."
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
             
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
             
              <Select value={filters.status} onValueChange={(value) => handleFilterChange("status", value)}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {availableStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Select value={activeProgram} onValueChange={setActiveProgram} disabled={availablePrograms.length === 0}>
                <SelectTrigger className="border-gray-300 focus:border-blue-500 bg-white">
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
             <div className="space-y-2">
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
          </div>

         
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders Table</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-500">Loading orders...</div>
          ) : pageRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {activeProgram ? "No orders found for current filters." : "You do not have access to any programme data."}
            </div>
          ) : (
            <>
              <Table className="min-w-[980px] [&_th]:h-8 [&_th]:px-3 [&_th]:py-1.5 [&_th]:align-middle [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32 text-left whitespace-nowrap">Date</TableHead>
                    <TableHead className="text-left">County</TableHead>
                    <TableHead className="text-left">Programme</TableHead>
                    <TableHead className="text-left">Offtake Officer</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Goats So Far</TableHead>
                    <TableHead className="text-right">Goats Bought</TableHead>
                    
                    <TableHead className="text-left">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow key={row.batchId} className="h-9">
                      <TableCell className="text-left whitespace-nowrap font-medium">{formatDate(row.batchDate)}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.county}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.programme}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.username}</TableCell>
                      <TableCell className="text-[12px] text-right font-semibold tabular-nums">{row.totalGoats.toLocaleString()}</TableCell>
                      <TableCell className="text-[12px] text-right font-semibold tabular-nums">{row.recordedGoats.toLocaleString()}</TableCell>
                      <TableCell className="text-[12px] text-right">
                        {userCanEditOrders && editingBatchId === row.batchId ? (
                          <div className="ml-auto flex w-44 items-center justify-end gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={row.totalGoats}
                              value={goatsBoughtDraft}
                              onChange={(e) => setGoatsBoughtDraft(e.target.value)}
                              className="h-7 text-right"
                            />
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => saveGoatsBoughtEdit(row)}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={cancelGoatsBoughtEdit}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="ml-auto flex items-center justify-end gap-2">
                            <span className="font-semibold tabular-nums">{row.goatsBought.toLocaleString()}</span>
                            {userCanEditOrders && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startGoatsBoughtEdit(row)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    
                      <TableCell className="text-left">
                        <Badge className={getStatusBadgeClass(row.status)}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-2"
                            onClick={() => setOrdersDialogBatchId(row.batchId)}
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </Button>
                          {userCanEditOrders && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-2"
                              onClick={() => setOrdersDialogBatchId(row.batchId)}
                            >
                              <Pencil className="h-4 w-4" />
                              Update
                            </Button>
                          )}
                          {userIsChiefAdmin && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7"
                              onClick={() => deleteBatch(row)}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                <span>
                  Showing {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(pagination.page * pagination.limit, filteredBatchRows.length)} of {filteredBatchRows.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasPrev}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pagination.hasNext}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeCreateDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg bg-white rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Create Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-order-programme" className="text-sm font-medium text-slate-700">
                Programme
              </Label>
              <Input
                id="create-order-programme"
                value={newOrder.programme || activeProgram || ""}
                disabled
                className="border-gray-300 bg-slate-50"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create-order-date" className="text-sm font-medium text-slate-700">
                  Order Date *
                </Label>
                <Input
                  id="create-order-date"
                  type="date"
                  value={newOrder.date}
                  onChange={(e) => setNewOrder((prev) => ({ ...prev, date: e.target.value }))}
                  className="border-gray-300 focus:border-blue-500 bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-order-goats" className="text-sm font-medium text-slate-700">
                  Goats *
                </Label>
                <Input
                  id="create-order-goats"
                  type="number"
                  min={1}
                  value={newOrder.goats}
                  onChange={(e) => setNewOrder((prev) => ({ ...prev, goats: e.target.value }))}
                  className="border-gray-300 focus:border-blue-500 bg-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-order-county" className="text-sm font-medium text-slate-700">
                County *
              </Label>
              <Input
                id="create-order-county"
                value={newOrder.county}
                onChange={(e) => setNewOrder((prev) => ({ ...prev, county: e.target.value }))}
                placeholder="Enter county"
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Field Officers (Mobile Users) *</Label>
              {fieldOfficersLoading ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                  Loading mobile users...
                </div>
              ) : fieldOfficers.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                  No mobile users found.
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between border-gray-300 bg-white text-left"
                    >
                      <span>{selectedOfficersSummary}</span>
                      <ChevronDown className="h-4 w-4 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="max-h-56 w-[--radix-dropdown-menu-trigger-width] overflow-y-auto"
                    align="start"
                  >
                    {fieldOfficers.map((officer) => (
                      <DropdownMenuCheckboxItem
                        key={officer.id}
                        disabled={!officer.phone}
                        checked={selectedFieldOfficerIds.includes(officer.id)}
                        onCheckedChange={() => toggleFieldOfficerSelection(officer.id)}
                        onSelect={(event) => event.preventDefault()}
                      >
                        {officer.name}{" "}
                        <span className="ml-2 text-xs text-slate-500">{officer.phone || "No phone on record"}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {selectedOfficersPreview && (
                <p className="text-xs text-slate-500">Selected: {selectedOfficersPreview}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="order-sms-message" className="text-sm font-medium text-slate-700">
                SMS Message *
              </Label>
              <Textarea
                id="order-sms-message"
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                placeholder="Write the SMS to send..."
                className="min-h-[110px] border-gray-300 focus:border-blue-500 bg-white"
              />
              <p className="text-xs text-slate-500">
                We will append: Goats: {Number(newOrder.goats || 0).toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Submitted By</Label>
              <Input value={userName || "Unknown"} disabled className="border-gray-300 bg-slate-50" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={closeCreateDialog} disabled={creatingOrder}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateOrder}
              disabled={creatingOrder}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {creatingOrder ? "Creating..." : "Create Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(ordersDialogBatchId && ordersDialogRow)}
        onOpenChange={(open) => {
          if (!open) closeOrdersDialog();
        }}
      >
        <DialogContent className="sm:max-w-2xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Parent Order Details</DialogTitle>
          </DialogHeader>

          {ordersDialogRow ? (
            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Date</p>
                  <p className="font-semibold text-slate-900">{formatDate(ordersDialogRow.batchDate)}</p>
                  <p className="text-xs text-slate-500">Ref: {ordersDialogRow.batchId}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">County</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.county}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Location</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.location}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Offtake Officer</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.username}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Status</p>
                  <Badge className={getStatusBadgeClass(ordersDialogRow.status)}>{ordersDialogRow.status}</Badge>
                </div>
                <div className="rounded-md border bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500">Progress</p>
                  <p className="font-semibold text-slate-900">
                    {ordersDialogRow.goatsBought.toLocaleString()} / {ordersDialogRow.totalGoats.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    Remaining {ordersDialogRow.remainingGoats.toLocaleString()}
                  </p>
                </div>
              </div>

              {ordersDialogRow.status === "completed" ? (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  Target achieved. This order is closed and the field-officer submissions are listed below.
                </div>
              ) : (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    ordersDialogRow.isReadyForCompletion
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {ordersDialogRow.isReadyForCompletion
                          ? "All field-officer submissions are attached. Review them, then mark this parent order complete."
                          : `This parent order is still open with ${ordersDialogRow.remainingGoats.toLocaleString()} goats remaining.`}
                      </p>
                      <p className="text-xs opacity-80">
                        The field-officer submissions stay under this view until the offtake officer closes the order.
                      </p>
                    </div>
                    {userCanEditOrders && (
                      <Button
                        type="button"
                        size="sm"
                        className="bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => markOrderComplete(ordersDialogRow)}
                      >
                        Mark Complete
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-md border overflow-x-auto">
                <div className="border-b bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  Field Officer Submissions
                </div>
                <Table className="[&_th]:h-8 [&_th]:px-3 [&_th]:py-1.5 [&_th]:align-middle [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Date</TableHead>
                      {ordersDialogHasOfficerColumn && (
                        <TableHead className="text-left">Field Officer</TableHead>
                      )}
                      <TableHead className="text-left">Village</TableHead>
                      <TableHead className="text-right">Goats</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersDialogRow.items.map((item, index) => {
                      const orderKey = `${ordersDialogRow.batchId}:${index}`;
                      const isEditingOrder = userCanEditOrders && editingOrderKey === orderKey;

                      return (
                        <TableRow key={orderKey} className="h-9">
                          <TableCell className="text-left">
                            {isEditingOrder ? (
                              <Input
                                type="date"
                                value={orderDateDraft}
                                onChange={(e) => setOrderDateDraft(e.target.value)}
                                className="h-7 max-w-40"
                              />
                            ) : (
                              formatDate(item.date)
                            )}
                          </TableCell>
                          {ordersDialogHasOfficerColumn && (
                            <TableCell className="text-left">
                              {isEditingOrder ? (
                                <Input
                                  value={orderOfficerDraft}
                                  onChange={(e) => setOrderOfficerDraft(e.target.value)}
                                  className="h-7"
                                  placeholder="Field officer"
                                />
                              ) : (
                                <span className="text-sm text-slate-700">{item.officer}</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-left">
                            {isEditingOrder ? (
                              <Input
                                value={orderLocationDraft}
                                onChange={(e) => setOrderLocationDraft(e.target.value)}
                                className="h-7"
                                placeholder="Village"
                              />
                            ) : (
                              <span className="text-sm text-slate-700">{item.location}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditingOrder ? (
                              <Input
                                type="number"
                                min={0}
                                value={orderGoatsDraft}
                                onChange={(e) => setOrderGoatsDraft(e.target.value)}
                                className="ml-auto h-7 max-w-28 text-right"
                              />
                            ) : (
                              <span className="font-semibold tabular-nums">{item.goats.toLocaleString()}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isEditingOrder ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  onClick={() => saveOrderEdit(ordersDialogRow, index)}
                                >
                                  <Save className="mr-1 h-4 w-4" />
                                  Save
                                </Button>
                                <Button size="sm" variant="outline" className="h-7" onClick={cancelOrderEdit}>
                                  <X className="mr-1 h-4 w-4" />
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                {userCanEditOrders && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7"
                                      onClick={() => startOrderEdit(ordersDialogRow, item, index)}
                                    >
                                      <Pencil className="mr-1 h-4 w-4" />
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-7"
                                      onClick={() => deleteOrderItem(ordersDialogRow, index)}
                                    >
                                      <Trash2 className="mr-1 h-4 w-4" />
                                      Delete
                                    </Button>
                                  </>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrdersPage;
