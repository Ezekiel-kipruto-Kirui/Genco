import type {VercelRequest, VercelResponse} from "@vercel/node";
import {
  initializeAdmin,
  getAuth,
  setCorsHeaders,
  getBearerToken,
} from "./_lib/firebase-admin";
import {AnalysisError, runAnalysisSummary} from "./analysis-core";

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
  setCorsHeaders(res, req.headers.origin, "POST, OPTIONS");

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
      return res.status(200).json({ok: true});
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