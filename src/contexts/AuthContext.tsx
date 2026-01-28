import { createContext, useContext, useEffect, useState, type FC, type ReactNode } from "react";
import { User, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, get, query, orderByChild, equalTo } from "firebase/database";
import { auth, db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

// --- Types ---

interface UserProfile {
  role: string | null;
  allowedProgrammes: Record<string, boolean> | null;
}

interface AuthContextType {
  user: User | null;
  userRole: string | null;
  allowedProgrammes: Record<string, boolean> | null;
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
  const [allowedProgrammes, setAllowedProgrammes] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Fetches Role and Allowed Programmes from DB
  const fetchUserProfile = async (uid: string): Promise<UserProfile> => {
    try {
      // ATTEMPT 1: Direct UID lookup (Optimal structure)
      const userRef = ref(db, `users/${uid}`);
      const snapshot = await get(userRef);

      if (snapshot.exists()) {
        const userData = snapshot.val();
        return {
          role: userData.role || null,
          allowedProgrammes: userData.allowedProgrammes || null
        };
      }

      // ATTEMPT 2: Fallback query (Legacy structure: users stored with Push IDs)
      // Note: This requires an index on 'uid' in Firebase Database rules for performance on large datasets.
      console.warn("User not found at direct UID path, falling back to query...");
      const usersRef = ref(db, "users");
      const q = query(usersRef, orderByChild("uid"), equalTo(uid));
      const querySnapshot = await get(q);

      if (querySnapshot.exists()) {
        const data = querySnapshot.val();
        // Get the first matching key
        const firstUserKey = Object.keys(data)[0];
        if (firstUserKey) {
          return {
            role: data[firstUserKey].role || null,
            allowedProgrammes: data[firstUserKey].allowedProgrammes || null
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
    let isMounted = true; // 1. Prevents state updates on unmounted components

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      setUser(user);

      if (user) {
        try {
          // We need to fetch profile data before setting loading to false
          // to ensure the app doesn't render without permissions (role/programmes).
          const profile = await fetchUserProfile(user.uid);
          
          if (isMounted) {
            setUserRole(profile.role);
            setAllowedProgrammes(profile.allowedProgrammes);
            
            if (profile.role) {
              localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
            }
          }
        } catch (error) {
          console.error("Auth initialization error:", error);
          // Optionally keep cached role if DB fails, depending on strictness requirements
        } finally {
          if (isMounted) setLoading(false);
        }
      } else {
        // User is logged out
        if (isMounted) {
          setUserRole(null);
          setAllowedProgrammes(null);
          localStorage.removeItem(ROLE_STORAGE_KEY);
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      
      // The onAuthStateChanged listener will handle state updates automatically.
      
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
    } catch (error: any) {
      console.error("Sign in error:", error);
      
      let message = "Invalid credentials. Please try again.";
      
      // 2. Updated error handling for newer Firebase Auth behaviors
      // Firebase often masks specific errors (wrong-password/user-not-found) 
      // into 'auth/invalid-credential' for security.
      if (error.code === 'auth/invalid-credential' || 
          error.code === 'auth/user-not-found' || 
          error.code === 'auth/wrong-password') {
        message = "Incorrect email or password.";
      } else if (error.code === 'auth/too-many-requests') {
        message = "Too many failed attempts. Please try again later.";
      } else if (error.message) {
        message = error.message;
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
      // 3. Removed manual state clearing. 
      // Relying solely on onAuthStateChanged prevents race conditions 
      // where the UI updates twice (once here, once in the listener).
      await signOut(auth);
      
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