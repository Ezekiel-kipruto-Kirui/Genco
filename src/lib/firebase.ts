import { initializeApp } from "firebase/app";
import { initializeApp as initializeSecondaryApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, get } from "firebase/database";

// Load from .env (must use VITE_ prefix)
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_DATABASE_URL, 
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID,
};

// MAIN APP
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// REALTIME DATABASE
export const db = getDatabase(app);

// SECONDARY APP (creates users without logging out admin)
const secondaryApp = initializeSecondaryApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

// Prevent analytics crash in non-browser environments
export const analytics =
  typeof window !== "undefined" ? getAnalytics(app) : null;

/**
 * Helper function to fetch data from Realtime Database
 * Equivalent to fetching a Firestore collection
 */
export const fetchCollection = async (path: string) => {
  try {
    const snapshot = await get(ref(db, path));

    if (!snapshot.exists()) return [];

    const data = snapshot.val();

    // Convert object → array with id (Firestore-like)
    return Object.entries(data).map(([id, value]) => ({
      id,
      ...(value as object),
    }));
  } catch (err) {
    console.error("Error fetching:", err);
    throw err;
  }
};

// Fetch all your data at once
export const fetchData = async () => {
  try {
    const [
      livestock,
      fodder,
      infrastructure,
      BoreholeStorage,
      capacity,
      lofftake,
      fofftake,
      users,
    ] = await Promise.all([
      fetchCollection("farmers"),
      fetchCollection("fodderFarmers"),
      fetchCollection("Infrastructure Data"),
      fetchCollection("BoreholeStorage"),
      fetchCollection("capacityBuilding"),
      fetchCollection("offtakes"),
      fetchCollection("Fodder Offtake Data"),
      fetchCollection("users"),
    ]);

    return {
      livestock,
      fodder,
      infrastructure,
      BoreholeStorage,
      capacity,
      lofftake,
      fofftake,
      users,
    };
  } catch (error) {
    console.error("Error fetching all data:", error);
    throw error;
  }
};
