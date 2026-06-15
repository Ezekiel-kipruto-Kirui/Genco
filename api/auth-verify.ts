/**
 * /api/auth-verify - Verifies Firebase ID token and returns user profile.
 * Replaces the client-side onAuthStateChanged -> direct RTDB user lookup pattern.
 */
import type {VercelRequest, VercelResponse} from "@vercel/node";
import {
  initializeAdmin,
  getAuth,
  getDatabase,
  setCorsHeaders,
  getBearerToken,
} from "./_lib/firebase-admin";

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
    const idToken = getBearerToken(req.headers.authorization);
    if (!idToken) {
      return res.status(401).json({error: "Missing Firebase ID token"});
    }

    initializeAdmin();

    const decodedToken = await getAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Fetch user profile from RTDB (single read)
    const userRef = getDatabase().ref(`users/${uid}`);
    const snapshot = await userRef.get();

    let profile: any = null;
    if (snapshot.exists()) {
      profile = {recordId: uid, ...snapshot.val()};
    } else {
      // Fallback: query by uid field
      const fallbackSnapshot = await getDatabase()
        .ref("users")
        .orderByChild("uid")
        .equalTo(uid)
        .limitToFirst(1)
        .get();

      if (fallbackSnapshot.exists()) {
        const data = fallbackSnapshot.val() as Record<string, any>;
        const [recordId, userData] = Object.entries(data)[0] || ["", null];
        if (userData) {
          profile = {recordId, ...userData};
        }
      }
    }

    return res.status(200).json({
      uid,
      email: decodedToken.email || null,
      profile,
    });
  } catch (error: any) {
    console.error("[auth-verify] request failed", error);

    if (error?.code === "auth/id-token-expired" || error?.code === "auth/id-token-revoked") {
      return res.status(401).json({error: "Token expired. Please sign in again."});
    }

    const message = error instanceof Error ? error.message : "Auth verification failed";
    return res.status(500).json({error: message});
  }
}