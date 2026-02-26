import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { onValue, orderByChild, equalTo, query, ref, remove, update } from "firebase/database";
import { db } from "@/lib/firebase";
import { canViewAllProgrammes } from "@/contexts/authhelper";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, Pencil, Save, ShoppingCart, Trash2, X } from "lucide-react";

interface OrderItem {
  id?: string;
  date?: string | number;
  goats?: number;
  location?: string;
  village?: string;
}

interface OrderRecord {
  id: string;
  recordId?: string;
  completedAt?: string | number;
  county?: string;
  createdAt?: string | number;
  goatsBought?: number;
  location?: string;
  orders?: OrderItem[] | Record<string, OrderItem>;
  programme?: string;
  remainingGoats?: number;
  status?: string;
  subcounty?: string;
  timestamp?: number;
  totalGoats?: number;
  username?: string;
}

interface NormalizedOrderItem {
  id: string;
  date: string | number;
  goats: number;
  location: string;
  village: string;
}

interface BatchOrderRow {
  batchId: string;
  batchDate: string | number;
  createdAt: string | number;
  completedAt: string | number;
  totalGoats: number;
  goatsBought: number;
  remainingGoats: number;
  status: string;
  county: string;
  subcounty: string;
  location: string;
  programme: string;
  username: string;
  sortTimestamp: number;
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getBatchTotalGoats = (record: OrderRecord, itemsTotal: number): number => {
  const storedTotal = Number(record.totalGoats || 0);
  const bought = Number(record.goatsBought || 0);
  const remaining = Number(record.remainingGoats || 0);
  return Math.max(itemsTotal, storedTotal, bought + remaining, 0);
};

const getOrderEntries = (orders: OrderRecord["orders"]): OrderItem[] => {
  if (Array.isArray(orders)) return orders.filter(Boolean);
  if (orders && typeof orders === "object") return Object.values(orders).filter(Boolean);
  return [];
};

const getNormalizedItems = (record: OrderRecord): NormalizedOrderItem[] => {
  const orderEntries = getOrderEntries(record.orders);
  if (orderEntries.length > 0) {
    return orderEntries.map((item, index) => {
      const itemLocation = item.location || item.village || record.location || "N/A";
      return {
        id: item.id || `${record.id}-${index + 1}`,
        date: item.date || record.completedAt || record.createdAt || record.timestamp || "",
        goats: Number(item.goats || 0),
        location: itemLocation,
        village: item.village || itemLocation,
      };
    });
  }

  const fallbackGoats = Number(record.totalGoats || record.goatsBought || 0);
  return [
    {
      id: `${record.id}-1`,
      date: record.completedAt || record.createdAt || record.timestamp || "",
      goats: fallbackGoats,
      location: record.location || "N/A",
      village: record.location || "N/A",
    },
  ];
};

const OrdersPage = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();
  const { toast } = useToast();

  const [allRecords, setAllRecords] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProgram, setActiveProgram] = useState<string>("");
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);
  const [ordersDialogBatchId, setOrdersDialogBatchId] = useState<string | null>(null);

  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [goatsBoughtDraft, setGoatsBoughtDraft] = useState<string>("");

  const [editingOrderKey, setEditingOrderKey] = useState<string | null>(null);
  const [orderGoatsDraft, setOrderGoatsDraft] = useState<string>("");
  const [orderDateDraft, setOrderDateDraft] = useState<string>("");

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

  const batchRows = useMemo(() => {
    return allRecords.map((record) => {
      const items = getNormalizedItems(record);
      const itemsTotal = items.reduce((sum, item) => sum + Number(item.goats || 0), 0);
      const totalGoats = getBatchTotalGoats(record, itemsTotal);
      const goatsBought = clamp(Number(record.goatsBought || 0), 0, Math.max(totalGoats, 0));
      const storedRemaining = Number(record.remainingGoats);
      const remainingGoats = Number.isFinite(storedRemaining)
        ? clamp(storedRemaining, 0, Math.max(totalGoats, 0))
        : Math.max(totalGoats - goatsBought, 0);
      const createdAt = record.createdAt || record.timestamp || "";
      const completedAt = record.completedAt || "";
      const batchDate = completedAt || createdAt || items[0]?.date || "";

      return {
        batchId: record.id,
        batchDate,
        createdAt,
        completedAt,
        totalGoats,
        goatsBought,
        remainingGoats,
        status: normalizeStatus(record.status),
        county: record.county || "N/A",
        subcounty: record.subcounty || "N/A",
        location: record.location || "N/A",
        programme: record.programme || activeProgram || "N/A",
        username: record.username || "N/A",
        sortTimestamp: parseDate(batchDate)?.getTime() || 0,
        items,
      };
    });
  }, [allRecords, activeProgram]);

  const ordersDialogRow = useMemo(
    () => batchRows.find((row) => row.batchId === ordersDialogBatchId) || null,
    [batchRows, ordersDialogBatchId]
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
        row.subcounty,
        row.location,
        row.username,
        row.status,
        row.programme,
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
  };

  const updateBatchOrders = async (
    row: BatchOrderRow,
    nextItems: NormalizedOrderItem[],
    nextGoatsBought?: number
  ) => {
    const sanitizedItems = nextItems.map((item, index) => {
      const orderLocation = item.location || item.village || row.location || "";
      return {
        id: item.id || `${row.batchId}-${index + 1}`,
        goats: Math.max(0, Number(item.goats || 0)),
        date: item.date || row.batchDate || "",
        location: orderLocation,
        village: item.village || orderLocation,
      };
    });

    const total = sanitizedItems.reduce((sum, item) => sum + item.goats, 0);
    const goatsBought = clamp(
      typeof nextGoatsBought === "number" ? nextGoatsBought : Number(row.goatsBought || 0),
      0,
      Math.max(total, 0)
    );

    await update(ref(db, `orders/${row.batchId}`), {
      orders: sanitizedItems,
      totalGoats: total,
      goatsBought,
      remainingGoats: Math.max(total - goatsBought, 0),
    });
  };

  const startGoatsBoughtEdit = (row: BatchOrderRow) => {
    setEditingBatchId(row.batchId);
    setGoatsBoughtDraft(String(row.goatsBought || 0));
  };

  const cancelGoatsBoughtEdit = () => {
    setEditingBatchId(null);
    setGoatsBoughtDraft("");
  };

  const saveGoatsBoughtEdit = async (row: BatchOrderRow) => {
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
      await update(ref(db, `orders/${row.batchId}`), {
        goatsBought: nextValue,
        remainingGoats: Math.max(row.totalGoats - nextValue, 0),
      });
      toast({ title: "Updated", description: "Goats bought updated successfully." });
      cancelGoatsBoughtEdit();
    } catch {
      toast({ title: "Error", description: "Failed to update goats bought.", variant: "destructive" });
    }
  };

  const startOrderEdit = (row: BatchOrderRow, item: NormalizedOrderItem, index: number) => {
    setEditingOrderKey(`${row.batchId}:${index}`);
    setOrderGoatsDraft(String(item.goats || 0));
    setOrderDateDraft(toInputDate(item.date));
  };

  const cancelOrderEdit = () => {
    setEditingOrderKey(null);
    setOrderGoatsDraft("");
    setOrderDateDraft("");
  };

  const saveOrderEdit = async (row: BatchOrderRow, index: number) => {
    const nextGoats = Number(orderGoatsDraft);
    if (!Number.isFinite(nextGoats) || nextGoats < 0) {
      toast({ title: "Invalid value", description: "Order goats must be a number 0 or greater.", variant: "destructive" });
      return;
    }
    if (!orderDateDraft) {
      toast({ title: "Date required", description: "Please provide an order date.", variant: "destructive" });
      return;
    }

    const nextItems = row.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            goats: nextGoats,
            date: orderDateDraft,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
            <p className="text-sm text-slate-500">Grouped order batches with totals and per-order breakdown.</p>
          </div>
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
                placeholder="Search county, subcounty, user..."
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
                    <TableHead className="text-left">Subcounty</TableHead>
                    <TableHead className="text-left">Programme</TableHead>
                    <TableHead className="text-left">User</TableHead>
                    <TableHead className="text-right">Total Goats</TableHead>
                    <TableHead className="text-right">Goats Bought</TableHead>
                    <TableHead className="text-right">Remaining Goats</TableHead>
                    <TableHead className="text-left">Status</TableHead>
                    <TableHead className="text-right">Batch Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow key={row.batchId} className="h-9">
                      <TableCell className="text-left whitespace-nowrap font-medium">{formatDate(row.batchDate)}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.county}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.subcounty}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.programme}</TableCell>
                      <TableCell className="text-[12px] text-left">{row.username}</TableCell>
                      <TableCell className="text-[12px] text-right font-semibold tabular-nums">{row.totalGoats.toLocaleString()}</TableCell>
                      <TableCell className="text-[12px] text-right">
                        {editingBatchId === row.batchId ? (
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
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startGoatsBoughtEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{row.remainingGoats.toLocaleString()}</TableCell>
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
                            {row.items.length} Orders
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7"
                            onClick={() => deleteBatch(row)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Delete
                          </Button>
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
        open={Boolean(ordersDialogBatchId && ordersDialogRow)}
        onOpenChange={(open) => {
          if (!open) closeOrdersDialog();
        }}
      >
        <DialogContent className="sm:max-w-5xl bg-white rounded-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-slate-900">Orders Breakdown</DialogTitle>
          </DialogHeader>

          {ordersDialogRow ? (
            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Date</p>
                  <p className="font-semibold text-slate-900">{formatDate(ordersDialogRow.batchDate)}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">County / Subcounty</p>
                  <p className="font-semibold text-slate-900">
                    {ordersDialogRow.county} / {ordersDialogRow.subcounty}
                  </p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Location</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.location}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Programme</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.programme}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Submitted By</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.username}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Status</p>
                  <Badge className={getStatusBadgeClass(ordersDialogRow.status)}>{ordersDialogRow.status}</Badge>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Goats Bought</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.goatsBought.toLocaleString()}</p>
                </div>
                <div className="rounded-md border bg-slate-50 p-3">
                  <p className="text-slate-500">Remaining Goats</p>
                  <p className="font-semibold text-slate-900">{ordersDialogRow.remainingGoats.toLocaleString()}</p>
                </div>
              </div>

              <div className="rounded-md border">
                <Table className="[&_th]:h-8 [&_th]:px-3 [&_th]:py-1.5 [&_th]:align-middle [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Date</TableHead>
                      <TableHead className="text-left">Location</TableHead>
                      <TableHead className="text-right">Goats</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersDialogRow.items.map((item, index) => {
                      const orderKey = `${ordersDialogRow.batchId}:${index}`;
                      const isEditingOrder = editingOrderKey === orderKey;

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
                          <TableCell className="text-left">{item.location}</TableCell>
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
