import { useEffect, useMemo, useState } from "react";
import { equalTo, get, orderByChild, push, query, ref, serverTimestamp, set } from "firebase/database";
import { Loader2, Mail, MapPin, Phone, Plus, Search, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { isChiefAdmin, isHummanResourceManager, resolvePermissionPrincipal } from "@/contexts/authhelper";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type StaffRecord = {
  id: string;
  name?: string;
  displayName?: string;
  userName?: string;
  username?: string;
  email?: string;
  phoneNumber?: string;
  phone?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  county?: string;
  subcounty?: string;
  role?: string;
  customAttribute?: string;
  allowedProgrammes?: Record<string, boolean> | null;
  accessControl?: {
    customAttribute?: string;
    customAttributes?: Record<string, boolean>;
  } | null;
  createdAt?: unknown;
  status?: string;
};

type AddStaffForm = {
  name: string;
  email: string;
  phoneNumber: string;
  county: string;
  subcounty: string;
};

const getTimestampMs = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { seconds?: number; _seconds?: number; toDate?: () => Date };
    if (typeof candidate.toDate === "function") return candidate.toDate().getTime();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
    if (typeof candidate._seconds === "number") return candidate._seconds * 1000;
  }
  return 0;
};

const formatDate = (value: unknown): string => {
  if (!value) return "N/A";
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toLocaleDateString();
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds?: number }).seconds || 0);
    if (seconds > 0) return new Date(seconds * 1000).toLocaleDateString();
  }
  return "N/A";
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase().trim().replace(/\s+/g, " ") : "";

const normalizeProgramme = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const getRoleTokens = (record: StaffRecord): string[] => {
  const tokens = new Set<string>();
  const roleToken = normalizeText(record.role);
  if (roleToken) tokens.add(roleToken);

  const customAttribute = normalizeText(record.accessControl?.customAttribute || record.customAttribute);
  if (customAttribute) tokens.add(customAttribute);

  const legacyAttributes = record.accessControl?.customAttributes;
  if (legacyAttributes && typeof legacyAttributes === "object") {
    Object.keys(legacyAttributes).forEach((key) => {
      const token = normalizeText(key);
      if (token) tokens.add(token);
    });
  }

  return Array.from(tokens);
};

const isMobileUserRecord = (record: StaffRecord): boolean =>
  getRoleTokens(record).some(
    (token) =>
      token === "mobile" ||
      token === "mobile user" ||
      token === "field officer" ||
      token === "fieldofficer"
  );

const getStaffDisplayName = (record: StaffRecord): string => {
  const candidates = [record.name, record.displayName, record.userName, record.username, record.email];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "N/A";
};

const getStaffPhone = (record: StaffRecord): string => {
  const candidates = [record.phoneNumber, record.phone, record.mobile, record.telephone, record.contact];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "N/A";
};

const getEnabledProgrammes = (
  allowedProgrammes?: Record<string, boolean> | null
): string[] =>
  Object.entries(allowedProgrammes || {})
    .filter(([, allowed]) => allowed === true)
    .map(([programme]) => normalizeProgramme(programme))
    .filter(Boolean);

const hasManagedProgramme = (record: StaffRecord, managedProgrammes: string[]): boolean => {
  if (managedProgrammes.length === 0) return false;

  const recordProgrammes = getEnabledProgrammes(record.allowedProgrammes);
  if (recordProgrammes.length === 0) return false;

  return recordProgrammes.some((programme) => managedProgrammes.includes(programme));
};

const buildAllowedProgrammesPayload = (
  allowedProgrammes?: Record<string, boolean> | null
): Record<string, boolean> | undefined => {
  const enabledEntries = Object.entries(allowedProgrammes || {}).filter(([, allowed]) => allowed === true);
  if (enabledEntries.length === 0) return undefined;

  return enabledEntries.reduce<Record<string, boolean>>((accumulator, [programme]) => {
    accumulator[programme] = true;
    return accumulator;
  }, {});
};

const fetchManagedMobileUsers = async (
  principal: string,
  allowedProgrammes: Record<string, boolean> | null
): Promise<StaffRecord[]> => {
  const managedProgrammes = getEnabledProgrammes(allowedProgrammes);
  if (isHummanResourceManager(principal) && managedProgrammes.length === 0) return [];

  const mobileUsersSnapshot = await get(query(ref(db, "users"), orderByChild("role"), equalTo("mobile")));
  const data = mobileUsersSnapshot.val() as Record<string, StaffRecord> | null;
  if (!data) return [];

  return Object.entries(data)
    .map(([id, record]) => ({
      id,
      ...(record as StaffRecord),
    }))
    .filter(isMobileUserRecord)
    .filter((record) => !isHummanResourceManager(principal) || hasManagedProgramme(record, managedProgrammes))
    .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
};

const StaffPage = () => {
  const { userRole, userAttribute, allowedProgrammes } = useAuth();
  const { toast } = useToast();
  const principal = useMemo(() => resolvePermissionPrincipal(userRole, userAttribute), [userRole, userAttribute]);
  const userCanAddStaff = isChiefAdmin(principal) || isHummanResourceManager(principal);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<StaffRecord[]>([]);
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<AddStaffForm>({
    name: "",
    email: "",
    phoneNumber: "",
    county: "",
    subcounty: "",
  });

  useEffect(() => {
    let isMounted = true;

    const loadStaff = async () => {
      try {
        setLoading(true);
        const data = await fetchManagedMobileUsers(principal, allowedProgrammes);
        if (isMounted) setRecords(data);
      } catch (error) {
        console.error("Failed to load mobile users:", error);
        if (isMounted) {
          toast({
            title: "Error",
            description: "Failed to load mobile users.",
            variant: "destructive",
          });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadStaff();

    return () => {
      isMounted = false;
    };
  }, [allowedProgrammes, principal, toast]);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return records;
    return records.filter((record) =>
      [
        getStaffDisplayName(record),
        record.email,
        getStaffPhone(record),
        record.county,
        record.subcounty,
        record.role,
        record.displayName,
        record.userName,
        record.username,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [records, search]);

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      phoneNumber: "",
      county: "",
      subcounty: "",
    });
  };

  const handleAddStaff = async () => {
    if (!userCanAddStaff) {
      toast({
        title: "Access denied",
        description: "You do not have permission to add staff.",
        variant: "destructive",
      });
      return;
    }

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();
    const trimmedPhone = form.phoneNumber.trim();
    const trimmedCounty = form.county.trim();
    const trimmedSubcounty = form.subcounty.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone || !trimmedCounty || !trimmedSubcounty) {
      toast({
        title: "Missing information",
        description: "Please fill in name, email, phone number, county, and subcounty.",
        variant: "destructive",
      });
      return;
    }

    if (records.some((record) => String(record.email || "").toLowerCase() === trimmedEmail.toLowerCase())) {
      toast({
        title: "Duplicate staff",
        description: "A staff record with this email already exists.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      const staffRef = push(ref(db, "users"));
      const staffId = staffRef.key || "";
      const allowedProgrammesPayload = buildAllowedProgrammesPayload(allowedProgrammes);
      await set(staffRef, {
        id: staffId,
        name: trimmedName,
        email: trimmedEmail,
        phoneNumber: trimmedPhone,
        county: trimmedCounty,
        subcounty: trimmedSubcounty,
        role: "mobile",
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(allowedProgrammesPayload ? { allowedProgrammes: allowedProgrammesPayload } : {}),
        source: "hr-mobile-directory",
      });

      toast({
        title: "Mobile user added",
        description: `${trimmedName} has been added to the mobile staff list.`,
      });

      setIsAddOpen(false);
      resetForm();
      const refreshedRecords = await fetchManagedMobileUsers(principal, allowedProgrammes);
      setRecords(refreshedRecords);
    } catch (error) {
      console.error("Failed to add mobile user:", error);
      toast({
        title: "Error",
        description: "Failed to add mobile user.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-700">HR</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Mobile Staff</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Mobile staff profiles are read from the `users` collection. Human resource managers only see the mobile users assigned to their programmes.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mobile users..."
              className="pl-9"
            />
          </div>
          {userCanAddStaff && (
            <Button onClick={() => setIsAddOpen(true)} className="bg-green-600 text-white hover:bg-green-700">
              <Plus className="mr-2 h-4 w-4" />
              Add Mobile User
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Total Mobile Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-green-600" />
              <div className="text-3xl font-bold text-slate-900">{records.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Filtered View</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{filteredRecords.length}</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">Add Access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{userCanAddStaff ? "Enabled for HR and chief admin." : "Read-only access."}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading mobile users...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              {records.length === 0 ? "No mobile users found." : "No mobile users match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Email</th>
                    <th className="px-4 py-3 text-left font-semibold">Phone</th>
                    <th className="px-4 py-3 text-left font-semibold">County</th>
                    <th className="px-4 py-3 text-left font-semibold">Subcounty</th>
                    <th className="px-4 py-3 text-left font-semibold">Role</th>
                    <th className="px-4 py-3 text-left font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{getStaffDisplayName(record)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="inline-flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          {record.email || "N/A"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="inline-flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {getStaffPhone(record)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" />
                          {record.county || "N/A"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{record.subcounty || "N/A"}</td>
                      <td className="px-4 py-3 text-slate-600">{record.role || "mobile"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(record.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Mobile User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Name</Label>
                <Input id="staff-name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">Email</Label>
                <Input id="staff-email" type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-phone">Phone Number</Label>
                <Input id="staff-phone" value={form.phoneNumber} onChange={(event) => setForm((prev) => ({ ...prev, phoneNumber: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-county">County</Label>
                <Input id="staff-county" value={form.county} onChange={(event) => setForm((prev) => ({ ...prev, county: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-subcounty">Subcounty</Label>
              <Input id="staff-subcounty" value={form.subcounty} onChange={(event) => setForm((prev) => ({ ...prev, subcounty: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleAddStaff} disabled={saving} className="bg-green-600 text-white hover:bg-green-700">
              {saving ? "Saving..." : "Save Mobile User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StaffPage;
