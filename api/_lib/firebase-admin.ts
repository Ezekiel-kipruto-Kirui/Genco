/**
 * Shared Firebase Admin SDK initialization for Vercel serverless functions.
 * Lazy, memoized, single-initialization pattern.
 */
import {cert, getApps, initializeApp, type ServiceAccount} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getDatabase} from "firebase-admin/database";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {config as loadDotenv} from "dotenv";

// --- Lazy env loading (skip on Vercel) ---
let _envLoaded = false;
const ensureEnv = () => {
  if (_envLoaded || process.env.VERCEL === "1") return;
  _envLoaded = true;
  [".env.local", ".env"].forEach((fileName) => {
    const envPath = path.join(process.cwd(), fileName);
    if (existsSync(envPath)) loadDotenv({path: envPath, override: false});
  });
};

// --- Memoized service account (parsed once) ---
let _serviceAccount: ServiceAccount | null | undefined;
let _projectId: string | undefined;
let _databaseUrl: string | undefined;

const normalizeServiceAccount = (v: any): ServiceAccount => ({
  projectId: v.projectId || v.project_id,
  clientEmail: v.clientEmail || v.client_email,
  privateKey:
    typeof v.privateKey === "string"
      ? v.privateKey.replace(/\\n/g, "\n")
      : String(v.private_key || "").replace(/\\n/g, "\n"),
});

const readServiceAccountFile = (filePath: string): ServiceAccount | null => {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!existsSync(resolved)) return null;
  return normalizeServiceAccount(JSON.parse(readFileSync(resolved, "utf8")));
};

const getServiceAccount = (): ServiceAccount | null => {
  if (_serviceAccount !== undefined) return _serviceAccount;
  ensureEnv();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) return (_serviceAccount = normalizeServiceAccount(JSON.parse(raw)));

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (filePath) {
    const sa = readServiceAccountFile(filePath);
    if (sa) return (_serviceAccount = sa);
  }

  const localPath = path.join(process.cwd(), "api/genco-company-firebase-adminsdk-fbsvc-f39677b198.json");
  if (process.env.VERCEL !== "1" && existsSync(localPath)) {
    const sa = readServiceAccountFile(localPath);
    if (sa) return (_serviceAccount = sa);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return (_serviceAccount = {projectId, clientEmail, privateKey});
  }

  return (_serviceAccount = null);
};

const getProjectId = (): string | undefined => {
  if (_projectId !== undefined) return _projectId;
  const sa = getServiceAccount();
  return (_projectId =
    process.env.FIREBASE_AUTH_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_PROJECT_ID ||
    sa?.projectId ||
    (sa as any)?.project_id);
};

const getDatabaseUrl = (): string | undefined => {
  if (_databaseUrl !== undefined) return _databaseUrl;
  const projectId = getProjectId();
  return (_databaseUrl =
    process.env.FIREBASE_DATABASE_URL ||
    process.env.VITE_DATABASE_URL ||
    (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined));
};

// --- Admin init (idempotent, lazy) ---
export const initializeAdmin = () => {
  if (getApps().length > 0) return;

  const sa = getServiceAccount();
  if (!sa) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY, " +
      "FIREBASE_SERVICE_ACCOUNT_FILE, or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
    );
  }

  initializeApp({
    credential: cert(sa),
    databaseURL: getDatabaseUrl(),
    projectId: getProjectId(),
  });
};

// --- Convenience getters ---
export {getAuth, getDatabase};
export {getProjectId as getFirebaseProjectId, getDatabaseUrl as getFirebaseDatabaseUrl};

// --- CORS helpers (memoized origin set) ---
const _buildAllowedOrigins = (): ReadonlySet<string> => {
  const origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://gencofarm.com",
    "https://gencofarm.com",
    "http://www.gencofarm.com",
    "https://www.gencofarm.com",
    process.env.SITE_ORIGIN || "",
    process.env.DEV_ORIGIN || "",
  ];
  return new Set(origins.filter(Boolean));
};

let _allowedOrigins: ReadonlySet<string> | undefined;
const getAllowedOrigins = (): ReadonlySet<string> =>
  (_allowedOrigins ??= _buildAllowedOrigins());

export const getAllowedOrigin = (origin?: string): string =>
  origin && getAllowedOrigins().has(origin) ? origin : "https://gencofarm.com";

export const setCorsHeaders = (
  res: {setHeader: (name: string, value: string) => void},
  origin?: string,
  methods = "GET, POST, DELETE, OPTIONS",
) => {
  res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(origin));
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
};

export const getBearerToken = (authorizationHeader: string | undefined): string => {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
};