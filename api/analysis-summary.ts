import type {VercelRequest, VercelResponse} from "@vercel/node";
import {cert, getApps, initializeApp, type ServiceAccount} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {config as loadDotenv} from "dotenv";
import {AnalysisError, runAnalysisSummary} from "./analysis-core";

const loadLocalEnv = () => {
  if (process.env.VERCEL === "1") return;

  [".env.local", ".env"].forEach((fileName) => {
    const envPath = path.join(process.cwd(), fileName);
    if (existsSync(envPath)) {
      loadDotenv({path: envPath, override: false});
    }
  });
};

loadLocalEnv();

const localServiceAccountFile = "api/genco-company-firebase-adminsdk-fbsvc-f39677b198.json";

const normalizeServiceAccount = (value: any): ServiceAccount => ({
  projectId: value.projectId || value.project_id,
  clientEmail: value.clientEmail || value.client_email,
  privateKey: typeof value.privateKey === "string" ?
    value.privateKey.replace(/\\n/g, "\n") :
    String(value.private_key || "").replace(/\\n/g, "\n"),
});

const readServiceAccountFile = (filePath: string): ServiceAccount | null => {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!existsSync(resolvedPath)) return null;
  return normalizeServiceAccount(JSON.parse(readFileSync(resolvedPath, "utf8")));
};

const getServiceAccount = (): ServiceAccount | null => {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (rawJson) return normalizeServiceAccount(JSON.parse(rawJson));

  const serviceAccountFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (serviceAccountFile) {
    const serviceAccount = readServiceAccountFile(serviceAccountFile);
    if (serviceAccount) return serviceAccount;
  }

  const localServiceAccountPath = path.join(
    process.cwd(),
    localServiceAccountFile,
  );
  if (process.env.VERCEL !== "1" && existsSync(localServiceAccountPath)) {
    return readServiceAccountFile(localServiceAccountPath);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return {projectId, clientEmail, privateKey};
  }

  return null;
};

const initializeAdmin = () => {
  if (getApps().length > 0) return;

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_SERVICE_ACCOUNT_FILE, or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
    );
  }

  const projectId =
    process.env.FIREBASE_AUTH_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_PROJECT_ID ||
    serviceAccount?.projectId ||
    (serviceAccount as any)?.project_id;
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    process.env.VITE_DATABASE_URL ||
    (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);

  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : undefined,
    databaseURL,
    projectId,
  });
};

const getAllowedOrigin = (origin?: string): string => {
  const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://gencofarm.com",
    "https://gencofarm.com",
    "http://www.gencofarm.com",
    "https://www.gencofarm.com",
    process.env.SITE_ORIGIN || "",
    process.env.DEV_ORIGIN || "",
  ].filter(Boolean));

  return origin && allowedOrigins.has(origin) ? origin : "https://gencofarm.com";
};

const getBearerToken = (authorizationHeader: string | undefined): string => {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
};

const toHttpStatus = (error: unknown): number => {
  if (error instanceof AnalysisError) {
    if (error.code === "unauthenticated") return 401;
    if (error.code === "permission-denied") return 403;
    if (error.code === "invalid-argument") return 400;
  }
  if (
    error instanceof Error &&
    (error.message.includes("Firebase ID token") || error.message.includes("verifyIdToken"))
  ) {
    return 401;
  }
  return 500;
};

const getRequestBody = (req: VercelRequest): Record<string, any> => {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return req.body as Record<string, any>;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(req.headers.origin));
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({error: "Method not allowed"});
  }

  try {
    const body = getRequestBody(req);
    initializeAdmin();

    if (body.scope === "__health") {
      return res.status(200).json({
        ok: true,
        projectId:
          process.env.FIREBASE_AUTH_PROJECT_ID ||
          process.env.FIREBASE_PROJECT_ID ||
          process.env.VITE_PROJECT_ID,
      });
    }

    const idToken = getBearerToken(req.headers.authorization);
    if (!idToken) {
      return res.status(401).json({error: "Missing Firebase ID token"});
    }

    const decodedToken = await getAuth().verifyIdToken(idToken);
    const data = await runAnalysisSummary(decodedToken.uid, body);
    return res.status(200).json({data});
  } catch (error) {
    console.error("[analysis-summary] request failed", error);
    const status = toHttpStatus(error);
    const message = error instanceof Error ? error.message : "Analysis request failed";
    return res.status(status).json({error: message});
  }
}
