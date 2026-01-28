import { createContext, useContext, useEffect, useState, type FC, type ReactNode } from "react";
import { User, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, get, query, orderByChild, equalTo } from "firebase/database";
import { auth, db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

// --- Types ---

// Define the structure for the user profile fetched from DB
interface UserProfile {
  role: string | null;
  allowedProgrammes: Record<string, boolean> | null;
}

interface AuthContextType {
  user: User | null;
  userRole: string | null;
  allowedProgrammes: Record<string, boolean> | null; // NEW: Exposes programmes to the app
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

const ROLE_STORAGE_KEY = "user_role";

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [allowedProgrammes, setAllowedProgrammes] = useState<Record<string, boolean> | null>(null); // NEW State
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // UPDATED: Fetches both Role and Allowed Programmes
  const fetchUserProfile = async (uid: string): Promise<UserProfile> => {
    try {
      // ATTEMPT 1: Direct UID lookup
      const userRef = ref(db, `users/${uid}`);
      const snapshot = await get(userRef);

      if (snapshot.exists()) {
        const userData = snapshot.val();
        return {
          role: userData.role || null,
          allowedProgrammes: userData.allowedProgrammes || {}
        };
      }

      // ATTEMPT 2: Fallback query (if users stored with Push IDs)
      console.warn("User not found at direct UID path, falling back to query...");
      const usersRef = ref(db, "users");
      const q = query(usersRef, orderByChild("uid"), equalTo(uid));
      const querySnapshot = await get(q);

      if (querySnapshot.exists()) {
        const data = querySnapshot.val();
        const userKeys = Object.keys(data);
        if (userKeys.length > 0) {
          const firstUserKey = userKeys[0];
          return {
            role: data[firstUserKey].role || null,
            allowedProgrammes: data[firstUserKey].allowedProgrammes || {}
          };
        }
      }
      
      return { role: null, allowedProgrammes: null };
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return { role: null, allowedProgrammes: null };
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      if (user) {
        // 1. Check Local Storage for Role (Performance optimization)
        const storedRole = localStorage.getItem(ROLE_STORAGE_KEY);
        
        // We set loading to false immediately if we have a cached role to allow UI to render
        // but we will update state once DB fetch completes
        if (storedRole) {
          setUserRole(storedRole);
        }

        // 2. Fetch fresh data from Database (Role + Programmes)
        // We do this regardless to ensure 'allowedProgrammes' is up to date
        const profile = await fetchUserProfile(user.uid);
        
        setUserRole(profile.role);
        setAllowedProgrammes(profile.allowedProgrammes); // Set the programmes signal
        
        if (profile.role) {
          localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
        }
        
        setLoading(false);
      } else {
        setUserRole(null);
        setAllowedProgrammes(null); // Clear programmes on logout
        localStorage.removeItem(ROLE_STORAGE_KEY);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // NOTE: The onAuthStateChanged listener in useEffect will handle 
      // fetching the role and allowedProgrammes automatically.
      
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
    } catch (error: any) {
      console.error("Sign in error:", error);
      
      let message = error.message || "Invalid credentials. Please try again.";
      
      if (error.code === 'auth/user-not-found') {
        message = "No account found with this email.";
      } else if (error.code === 'auth/wrong-password') {
        message = "Incorrect password.";
      }

      toast({
        title: "Sign In Failed",
        description: message,
        variant: "destructive",
      });
      throw error;
    }
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
      
      setUserRole(null);
      setAllowedProgrammes(null);
      localStorage.removeItem(ROLE_STORAGE_KEY);
      
      toast({
        title: "Signed Out",
        description: "You have been successfully signed out.",
      });
    } catch (error: any) {
      console.error("Sign out error:", error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <AuthContext.Provider value={{ user, userRole, allowedProgrammes, loading, signIn, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
};