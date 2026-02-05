import { createContext, useContext, useEffect, useState, type FC, type ReactNode } from "react";
import { User, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, get } from "firebase/database";
import { auth, db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

// --- Types ---

interface UserProfile {
  role: string | null;
  allowedProgrammes: Record<string, boolean> | null;
  name: string | null; // We fetch this from the DB
}

interface AuthContextType {
  user: User | null;
  userRole: string | null;
  userName: string | null; // Exposed to the app
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
  const [userName, setUserName] = useState<string | null>(null); // Added state for user name
  const [allowedProgrammes, setAllowedProgrammes] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Fetches Role, Name, and Allowed Programmes from DB 'users' node
  const fetchUserProfile = async (uid: string): Promise<UserProfile> => {
    try {
      // 1. Attempt direct lookup at users/{uid}
      const userRef = ref(db, `users/${uid}`);
      const snapshot = await get(userRef);

      if (snapshot.exists()) {
        const userData = snapshot.val();
        return {
          role: userData.role || null,
          allowedProgrammes: userData.allowedProgrammes || null,
          name: userData.name || null // Fetch name from DB
        };
      }

      // 2. Fallback scan (Legacy structure)
      console.warn("User not found at direct UID path, falling back to scan...");
      const usersRef = ref(db, "users");
      const allSnapshot = await get(usersRef);

      if (allSnapshot.exists()) {
        const data = allSnapshot.val();
        const match = Object.values(data as Record<string, any>).find((u: any) => u?.uid === uid) as any;
        if (match) {
          return {
            role: match.role || null,
            allowedProgrammes: match.allowedProgrammes || null,
            name: match.name || null // Fetch name from DB
          };
        }
      }
      
      return { role: null, allowedProgrammes: null, name: null };
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return { role: null, allowedProgrammes: null, name: null };
    }
  };

  useEffect(() => {
    let isMounted = true; 

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      setUser(user);

      if (user) {
        try {
          const profile = await fetchUserProfile(user.uid);
          
          if (isMounted) {
            setUserRole(profile.role);
            setAllowedProgrammes(profile.allowedProgrammes);
            
            // Set name from DB, fallback to Firebase Auth displayName, then email, then "Admin"
            setUserName(profile.name || user.displayName || user.email || "Admin");
            
            if (profile.role) {
              localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
            }
          }
        } catch (error) {
          console.error("Auth initialization error:", error);
        } finally {
          if (isMounted) setLoading(false);
        }
      } else {
        if (isMounted) {
          setUserRole(null);
          setAllowedProgrammes(null);
          setUserName(null);
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
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
    } catch (error: any) {
      console.error("Sign in error:", error);
      
      let message = "Invalid credentials. Please try again.";
      
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
    // CRITICAL FIX: Added userName to the context value below
    <AuthContext.Provider value={{ user, userRole, userName, allowedProgrammes, loading, signIn, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
};