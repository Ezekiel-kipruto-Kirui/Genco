import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "@/lib/firebase";
import { cacheKey, readCachedValue, writeCachedValue } from "@/lib/data-cache";

export type AnalysisScope =
  | "overview"
  | "livestock-analytics"
  | "performance-report"
  | "sales-report";

const ANALYSIS_CACHE_VERSION = "v7";

export interface AnalysisRequest {
  scope: AnalysisScope;
  programme?: string | null;
  dateRange?: { startDate?: string; endDate?: string } | null;
  timeFrame?: "weekly" | "monthly" | "yearly" | string | null;
  selectedYear?: number | string | null;
  target?: number | null;
  salesInputs?: { pricePerKg?: number | string | null; expenses?: number | string | null } | null;
}

const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;
const OVERVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

const buildCacheKey = (request: AnalysisRequest): string =>
  cacheKey(
    "analysis",
    ANALYSIS_CACHE_VERSION,
    auth.currentUser?.uid || "anon",
    request.scope,
    request.programme || "all",
    request.dateRange?.startDate || "",
    request.dateRange?.endDate || "",
    request.timeFrame || "",
    request.selectedYear ?? "",
    request.target ?? "",
    request.salesInputs?.pricePerKg ?? "",
    request.salesInputs?.expenses ?? "",
  );

export const fetchAnalysisSummary = async (request: AnalysisRequest): Promise<any> => {
  const key = buildCacheKey(request);
  const ttlMs = request.scope === "overview" ? OVERVIEW_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;
  const cached = readCachedValue<any>(key, ttlMs);
  if (cached) return cached;

  const functions = getFunctions(getApp(), "us-central1");
  const callable = httpsCallable<AnalysisRequest, any>(functions, "getAnalysisSummary");
  const result = await callable(request);
  writeCachedValue(key, result.data);
  return result.data;
};
