import { useCallback, useEffect, useMemo, useState } from "react";
import { onValue, ref, type DataSnapshot } from "firebase/database";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  canViewAllProgrammes,
  isAdmin,
  isChiefAdmin,
  isFinance,
  isFullAccessAttribute,
  isMonitoringAndEvaluationOfficer,
  isProjectManager,
  isHummanResourceManager,
  resolvePermissionPrincipal,
} from "@/contexts/authhelper";
import { cacheKey } from "@/lib/data-cache";
import { filterByAccessibleProgrammes, normalizeProgramme, resolveAccessibleProgrammes } from "@/lib/programme-access";

type NotificationModuleKey =
  | "activities"
  | "farmers"
  | "fodder"
  | "capacity"
  | "hayStorage"
  | "borehole";

type TimedProgrammeRecord = {
  id: string;
  programme: string;
  timestamp: number;
  status: string;
  authorizedBy: string;
  transactionCompletedBy: string;
};

type NotificationCount = {
  count: number;
  latestTimestamp: number;
};

type RequisitionSummary = {
  count: number;
  label: string;
  description: string;
  href: string;
};

type DashboardNotificationState = {
  activities: NotificationCount;
  farmers: NotificationCount;
  fodder: NotificationCount;
  capacity: NotificationCount;
  hayStorage: NotificationCount;
  borehole: NotificationCount;
  requisitions: RequisitionSummary;
  totalCount: number;
  markSeen: (module: NotificationModuleKey) => void;
};

const parseDate = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;

  if (value instanceof Date) return value.getTime();

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  return 0;
};

const getTimestampFromFields = (record: Record<string, any>, fields: string[]): number => {
  for (const field of fields) {
    const timestamp = parseDate(record?.[field]);
    if (timestamp > 0) return timestamp;
  }
  return 0;
};

const getRecordProgramme = (record: Record<string, any>): string =>
  normalizeProgramme(record?.programme ?? record?.Programme);

const normalizeStatus = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseProgrammeRecord = (
  id: string,
  record: Record<string, any>,
  timestampFields: string[]
): TimedProgrammeRecord => ({
  id,
  programme: getRecordProgramme(record),
  timestamp: getTimestampFromFields(record, timestampFields),
  status: normalizeStatus(record?.status),
  authorizedBy: typeof record?.authorizedBy === "string" ? record.authorizedBy.trim() : "",
  transactionCompletedBy:
    typeof record?.transactionCompletedBy === "string" ? record.transactionCompletedBy.trim() : "",
});

const readCollectionSnapshot = (
  snapshot: DataSnapshot,
  parser: (id: string, record: Record<string, any>) => TimedProgrammeRecord
): TimedProgrammeRecord[] => {
  if (!snapshot.exists()) return [];

  const data = snapshot.val();
  if (!data || typeof data !== "object") return [];

  return Object.entries(data).map(([id, record]) => parser(id, record as Record<string, any>));
};

const getLatestTimestamp = (records: TimedProgrammeRecord[]): number =>
  records.reduce((latest, record) => Math.max(latest, record.timestamp), 0);

const buildUnreadSummary = (
  records: TimedProgrammeRecord[],
  seenAt: number | undefined
): NotificationCount => {
  const latestTimestamp = getLatestTimestamp(records);
  const baseline = typeof seenAt === "number" && Number.isFinite(seenAt) && seenAt > 0 ? seenAt : latestTimestamp;
  const count = records.filter((record) => record.timestamp > baseline).length;

  return { count, latestTimestamp };
};

export const useDashboardNotifications = (): DashboardNotificationState => {
  const { user, userRole, userAttribute, allowedProgrammes } = useAuth();
  const principal = useMemo(() => resolvePermissionPrincipal(userRole, userAttribute), [userAttribute, userRole]);
  const userCanViewAllProgrammeData = useMemo(
    () => canViewAllProgrammes(userRole, userAttribute, allowedProgrammes),
    [allowedProgrammes, userAttribute, userRole]
  );
  const accessibleProgrammes = useMemo(
    () => resolveAccessibleProgrammes(userCanViewAllProgrammeData, allowedProgrammes),
    [allowedProgrammes, userCanViewAllProgrammeData]
  );

  const [activities, setActivities] = useState<TimedProgrammeRecord[]>([]);
  const [farmers, setFarmers] = useState<TimedProgrammeRecord[]>([]);
  const [fodder, setFodder] = useState<TimedProgrammeRecord[]>([]);
  const [capacity, setCapacity] = useState<TimedProgrammeRecord[]>([]);
  const [hayStorage, setHayStorage] = useState<TimedProgrammeRecord[]>([]);
  const [borehole, setBorehole] = useState<TimedProgrammeRecord[]>([]);
  const [requisitions, setRequisitions] = useState<TimedProgrammeRecord[]>([]);
  const [seenMap, setSeenMap] = useState<Record<string, number>>({});

  const storageKey = useMemo(
    () => cacheKey("dashboard-notifications-seen", user?.uid || "anonymous"),
    [user?.uid]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      setSeenMap(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      setSeenMap({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(seenMap));
    } catch {
      // Ignore storage failures. Notifications still work for this session.
    }
  }, [seenMap, storageKey]);

  useEffect(() => {
    if (!user?.uid) {
      setActivities([]);
      setFarmers([]);
      setFodder([]);
      setCapacity([]);
      setHayStorage([]);
      setBorehole([]);
      setRequisitions([]);
      return;
    }

    const unsubscribers: Array<() => void> = [];

    const attachListener = (
      path: string,
      setter: (records: TimedProgrammeRecord[]) => void,
      parser: (id: string, record: Record<string, any>) => TimedProgrammeRecord
    ) => {
      const unsubscribe = onValue(
        ref(db, path),
        (snapshot) => setter(readCollectionSnapshot(snapshot, parser)),
        (error) => {
          console.error(`Failed to load notification data from ${path}:`, error);
          setter([]);
        }
      );

      unsubscribers.push(unsubscribe);
    };

    attachListener("Recent Activities", setActivities, (id, record) =>
      parseProgrammeRecord(id, record, ["createdAt", "date"])
    );
    attachListener("farmers", setFarmers, (id, record) =>
      parseProgrammeRecord(id, record, ["createdAt", "registrationDate", "created_at"])
    );
    attachListener("fodderFarmers", setFodder, (id, record) =>
      parseProgrammeRecord(id, record, ["date", "createdAt", "created_at"])
    );
    attachListener("capacityBuilding", setCapacity, (id, record) =>
      parseProgrammeRecord(id, record, ["startDate", "createdAt", "rawTimestamp"])
    );
    attachListener("HayStorage", setHayStorage, (id, record) =>
      parseProgrammeRecord(id, record, ["date_planted", "created_at", "createdAt"])
    );
    attachListener("BoreholeStorage", setBorehole, (id, record) =>
      parseProgrammeRecord(id, record, ["date", "createdAt", "created_at"])
    );
    attachListener("requisitions", setRequisitions, (id, record) =>
      parseProgrammeRecord(id, record, [
        "submittedAt",
        "createdAt",
        "approvedAt",
        "authorizedAt",
        "transactionCompletedAt",
        "completedAt",
        "rejectedAt",
      ])
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        if (typeof unsubscribe === "function") unsubscribe();
      });
    };
  }, [user?.uid]);

  const visibleActivities = useMemo(
    () =>
      filterByAccessibleProgrammes(
        activities,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ).filter((record) => record.status === "pending"),
    [activities, accessibleProgrammes, userCanViewAllProgrammeData]
  );
  const visibleFarmers = useMemo(
    () =>
      filterByAccessibleProgrammes(
        farmers,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, farmers, userCanViewAllProgrammeData]
  );
  const visibleFodder = useMemo(
    () =>
      filterByAccessibleProgrammes(
        fodder,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, fodder, userCanViewAllProgrammeData]
  );
  const visibleCapacity = useMemo(
    () =>
      filterByAccessibleProgrammes(
        capacity,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, capacity, userCanViewAllProgrammeData]
  );
  const visibleHayStorage = useMemo(
    () =>
      filterByAccessibleProgrammes(
        hayStorage,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, hayStorage, userCanViewAllProgrammeData]
  );
  const visibleBorehole = useMemo(
    () =>
      filterByAccessibleProgrammes(
        borehole,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, borehole, userCanViewAllProgrammeData]
  );
  const visibleRequisitions = useMemo(
    () =>
      filterByAccessibleProgrammes(
        requisitions,
        (record) => record.programme,
        accessibleProgrammes,
        userCanViewAllProgrammeData
      ),
    [accessibleProgrammes, requisitions, userCanViewAllProgrammeData]
  );

  const activitiesSummary = useMemo(
    () => buildUnreadSummary(visibleActivities, seenMap.activities),
    [seenMap.activities, visibleActivities]
  );
  const farmersSummary = useMemo(
    () => buildUnreadSummary(visibleFarmers, seenMap.farmers),
    [seenMap.farmers, visibleFarmers]
  );
  const fodderSummary = useMemo(
    () => buildUnreadSummary(visibleFodder, seenMap.fodder),
    [seenMap.fodder, visibleFodder]
  );
  const capacitySummary = useMemo(
    () => buildUnreadSummary(visibleCapacity, seenMap.capacity),
    [seenMap.capacity, visibleCapacity]
  );
  const hayStorageSummary = useMemo(
    () => buildUnreadSummary(visibleHayStorage, seenMap.hayStorage),
    [seenMap.hayStorage, visibleHayStorage]
  );
  const boreholeSummary = useMemo(
    () => buildUnreadSummary(visibleBorehole, seenMap.borehole),
    [seenMap.borehole, visibleBorehole]
  );

  const requisitionSummary = useMemo<RequisitionSummary>(() => {
    const pendingCount = visibleRequisitions.filter((record) => record.status === "pending").length;
    const awaitingHrCount = visibleRequisitions.filter(
      (record) => record.status === "approved" && !record.authorizedBy
    ).length;
    const awaitingFinanceCount = visibleRequisitions.filter(
      (record) =>
        record.status === "approved" &&
        Boolean(record.authorizedBy) &&
        !record.transactionCompletedBy
    ).length;
    const openCount = pendingCount + awaitingHrCount + awaitingFinanceCount;

    if (isFinance(principal)) {
      return {
        count: awaitingFinanceCount,
        label: "Requisitions",
        description: "Awaiting finance completion",
        href: "/dashboard/requisition",
      };
    }

    if (isHummanResourceManager(principal)) {
      return {
        count: awaitingHrCount,
        label: "Requisitions",
        description: "Awaiting HR authorization",
        href: "/dashboard/requisition",
      };
    }

    if (isProjectManager(principal) || isMonitoringAndEvaluationOfficer(principal)) {
      return {
        count: pendingCount,
        label: "Requisitions",
        description: "Pending approvals",
        href: "/dashboard/requisition",
      };
    }

    if (isAdmin(principal) || isChiefAdmin(principal) || isFullAccessAttribute(principal)) {
      return {
        count: openCount,
        label: "Requisitions",
        description: "Open requisitions",
        href: "/dashboard/requisition",
      };
    }

    return {
      count: 0,
      label: "Requisitions",
      description: "No access",
      href: "/dashboard/requisition",
    };
  }, [principal, visibleRequisitions]);

  const latestTimestamps = useMemo(
    () => ({
      activities: activitiesSummary.latestTimestamp,
      farmers: farmersSummary.latestTimestamp,
      fodder: fodderSummary.latestTimestamp,
      capacity: capacitySummary.latestTimestamp,
      hayStorage: hayStorageSummary.latestTimestamp,
      borehole: boreholeSummary.latestTimestamp,
    }),
    [
      activitiesSummary.latestTimestamp,
      boreholeSummary.latestTimestamp,
      capacitySummary.latestTimestamp,
      farmersSummary.latestTimestamp,
      fodderSummary.latestTimestamp,
      hayStorageSummary.latestTimestamp,
    ]
  );

  const markSeen = useCallback(
    (module: NotificationModuleKey) => {
      const latestTimestamp = latestTimestamps[module];
      if (!latestTimestamp) return;

      setSeenMap((prev) => ({
        ...prev,
        [module]: latestTimestamp,
      }));
    },
    [latestTimestamps]
  );

  const totalCount =
    activitiesSummary.count +
    farmersSummary.count +
    fodderSummary.count +
    capacitySummary.count +
    hayStorageSummary.count +
    boreholeSummary.count +
    requisitionSummary.count;

  return {
    activities: activitiesSummary,
    farmers: farmersSummary,
    fodder: fodderSummary,
    capacity: capacitySummary,
    hayStorage: hayStorageSummary,
    borehole: boreholeSummary,
    requisitions: requisitionSummary,
    totalCount,
    markSeen,
  };
};
