import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ref, onValue, query, orderByChild, equalTo } from "firebase/database";
import { db } from "@/lib/firebase";
import { canViewAllProgrammes } from "@/contexts/authhelper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShoppingCart } from "lucide-react";

interface OrderItem {
  id?: string;
  date?: string | number;
  goats?: number;
}

interface OrderRecord {
  id: string;
  completedAt?: string | number;
  county?: string;
  createdAt?: string | number;
  goatsBought?: number;
  location?: string;
  orders?: OrderItem[];
  programme?: string;
  remainingGoats?: number;
  status?: string;
  subcounty?: string;
  totalGoats?: number;
  username?: string;
}

interface FlattenedOrderRow {
  rowId: string;
  parentOrderId: string;
  orderDate: string | number;
  goats: number;
  status: string;
  county: string;
  subcounty: string;
  location: string;
  programme: string;
  username: string;
  sortTimestamp: number;
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

const OrdersPage = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();

  const [allRecords, setAllRecords] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProgram, setActiveProgram] = useState<string>("");
  const [availablePrograms, setAvailablePrograms] = useState<string[]>([]);

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

        const records: OrderRecord[] = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));

        records.sort((a, b) => {
          const aDate = parseDate(a.completedAt || a.createdAt)?.getTime() || 0;
          const bDate = parseDate(b.completedAt || b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

        setAllRecords(records);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsubscribe();
  }, [activeProgram]);

  const flattenedRows = useMemo(() => {
    const rows: FlattenedOrderRow[] = [];

    allRecords.forEach((record) => {
      const items =
        Array.isArray(record.orders) && record.orders.length > 0
          ? record.orders
          : [
              {
                id: record.id,
                date: record.completedAt || record.createdAt,
                goats: Number(record.goatsBought || 0),
              },
            ];

      items.forEach((item, index) => {
        const rowDate = item.date || record.completedAt || record.createdAt || "";
        rows.push({
          rowId: item.id || `${record.id}-${index + 1}`,
          parentOrderId: record.id,
          orderDate: rowDate,
          goats: Number(item.goats || 0),
          status: normalizeStatus(record.status),
          county: record.county || "N/A",
          subcounty: record.subcounty || "N/A",
          location: record.location || "N/A",
          programme: record.programme || activeProgram || "N/A",
          username: record.username || "N/A",
          sortTimestamp: parseDate(rowDate)?.getTime() || 0,
        });
      });
    });

    return rows;
  }, [allRecords, activeProgram]);

  const filteredRows = useMemo(() => {
    const searchTerm = filters.search.toLowerCase().trim();

    const rows = flattenedRows.filter((row) => {
      if (filters.status !== "all" && row.status !== filters.status) return false;

      const rowDate = parseDate(row.orderDate);
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
        row.rowId,
        row.parentOrderId,
        row.county,
        row.subcounty,
        row.location,
        row.username,
        row.status,
        row.programme,
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });

    rows.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
    return rows;
  }, [flattenedRows, filters]);

  const totalGoats = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.goats, 0),
    [filteredRows]
  );

  useEffect(() => {
    setPagination((prev) => {
      const totalPages = Math.max(1, Math.ceil(filteredRows.length / prev.limit));
      const page = Math.min(prev.page, totalPages);
      return {
        ...prev,
        page,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    });
  }, [filteredRows.length]);

  const pageRows = useMemo(() => {
    const start = (pagination.page - 1) * pagination.limit;
    return filteredRows.slice(start, start + pagination.limit);
  }, [filteredRows, pagination.page, pagination.limit]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    flattenedRows.forEach((row) => set.add(row.status));
    return Array.from(set).sort();
  }, [flattenedRows]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
            <p className="text-sm text-slate-500">All submitted orders in tabular format.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Order Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{allRecords.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">Order Rows</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{filteredRows.length}</p>
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="search" className="font-semibold text-gray-700">
                Search
              </Label>
              <Input
                id="search"
                placeholder="Search order id, county, user..."
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold text-gray-700">From Date</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold text-gray-700">To Date</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                className="border-gray-300 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="font-semibold text-gray-700">Status</Label>
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
              <Label className="font-semibold text-gray-700">Programme</Label>
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
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={clearFilters}>
              Clear Filters
            </Button>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Goats</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>Subcounty</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Officer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow key={`${row.parentOrderId}-${row.rowId}`}>
                      <TableCell className="font-medium">{row.rowId}</TableCell>
                      <TableCell>{formatDate(row.orderDate)}</TableCell>
                      <TableCell className="text-right font-semibold">{row.goats.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge className={getStatusBadgeClass(row.status)}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>{row.county}</TableCell>
                      <TableCell>{row.subcounty}</TableCell>
                      <TableCell>{row.location}</TableCell>
                      <TableCell>{row.username}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                <span>
                  Showing {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(pagination.page * pagination.limit, filteredRows.length)} of {filteredRows.length}
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
    </div>
  );
};

export default OrdersPage;
