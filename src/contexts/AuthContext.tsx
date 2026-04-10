import { createContext, useContext, useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { equalTo, get, orderByChild, query, ref, serverTimestamp, update } from "firebase/database";
import { auth, db, invalidateCollectionCache, warmAppCaches } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { isMobileUser } from "@/contexts/authhelper";

interface UserProfile {
  recordId: string | null;
  role: string | null;
  allowedProgrammes: Record<string, boolean> | null;
  name: string | null;
  userAttribute: string | null;
}

interface AuthContextType {
  user: User | null;
  userRole: string | null;
  userAttribute: string | null;
  userName: string | null;
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
  const [userAttribute, setUserAttribute] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [allowedProgrammes, setAllowedProgrammes] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const pendingLoginRef = useRef(false);
  const blockedSessionRef = useRef<string | null>(null);
  const { toast } = useToast();

  const clearAuthState = () => {
    setUser(null);
    setUserRole(null);
    setUserAttribute(null);
    setAllowedProgrammes(null);
    setUserName(null);
    localStorage.removeItem(ROLE_STORAGE_KEY);
  };

  const extractUserAttribute = (userData: any): string | null => {
    const directAttribute = userData?.accessControl?.customAttribute;
    if (typeof directAttribute === "string" && directAttribute.trim()) {
      return directAttribute.trim();
    }

    const legacyAttributes = userData?.accessControl?.customAttributes;
    if (legacyAttributes && typeof legacyAttributes === "object") {
      const firstKey = Object.keys(legacyAttributes)[0];
      if (firstKey && firstKey.trim()) {
        return firstKey.trim();
      }
    }

    const fallbackAttribute = userData?.customAttribute;
    if (typeof fallbackAttribute === "string" && fallbackAttribute.trim()) {
      return fallbackAttribute.trim();
    }

    return null;
  };

  const touchLastLogin = async (recordId: string | null) => {
    if (!recordId) return;

    try {
      await update(ref(db, `users/${recordId}`), {
        lastLogin: serverTimestamp(),
      });
      invalidateCollectionCache("users");
    } catch (error) {
      console.error("Error updating last login:", error);
    }
  };

  const fetchUserProfile = async (uid: string): Promise<UserProfile> => {
    try {
      const userRef = ref(db, `users/${uid}`);
      const snapshot = await get(userRef);

      if (snapshot.exists()) {
        const userData = snapshot.val();
        return {
          recordId: uid,
          role: userData.role || null,
          allowedProgrammes: userData.allowedProgrammes || null,
          name: userData.name || null,
          userAttribute: extractUserAttribute(userData),
        };
      }

      console.warn("User not found at direct UID path, falling back to uid query...");
      const usersByUidQuery = query(ref(db, "users"), orderByChild("uid"), equalTo(uid));
      const matchingUsersSnapshot = await get(usersByUidQuery);

      if (matchingUsersSnapshot.exists()) {
        const data = matchingUsersSnapshot.val() as Record<string, any>;
        const matchEntry = Object.entries(data)[0];
        if (matchEntry) {
          const [recordId, match] = matchEntry;
          return {
            recordId,
            role: match.role || null,
            allowedProgrammes: match.allowedProgrammes || null,
            name: match.name || null,
            userAttribute: extractUserAttribute(match),
          };
        }
      }

      return { recordId: null, role: null, allowedProgrammes: null, name: null, userAttribute: null };
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return { recordId: null, role: null, allowedProgrammes: null, name: null, userAttribute: null };
    }
  };

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      setLoading(true);

      if (!firebaseUser) {
        pendingLoginRef.current = false;
        blockedSessionRef.current = null;
        clearAuthState();
        if (isMounted) setLoading(false);
        return;
      }

      setUser(firebaseUser);

      try {
        const profile = await fetchUserProfile(firebaseUser.uid);
        if (!isMounted) return;

        if (pendingLoginRef.current) {
          await touchLastLogin(profile.recordId);
        }

        if (isMobileUser(profile.role, profile.userAttribute)) {
          pendingLoginRef.current = false;
          clearAuthState();

          if (blockedSessionRef.current !== firebaseUser.uid) {
            blockedSessionRef.current = firebaseUser.uid;
            toast({
              title: "Access restricted",
              description: "Mobile users can submit data only and cannot access the web dashboard.",
              variant: "destructive",
            });
          }

          await signOut(auth);
          return;
        }

        blockedSessionRef.current = null;
        setUser(firebaseUser);
        setUserRole(profile.role);
        setUserAttribute(profile.userAttribute);
        setAllowedProgrammes(profile.allowedProgrammes);
        setUserName(profile.name || firebaseUser.displayName || firebaseUser.email || "Admin");

        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            void warmAppCaches().catch((error) => {
              console.error("Error warming application caches:", error);
            });
          }, 0);
        }

        if (profile.role) {
          localStorage.setItem(ROLE_STORAGE_KEY, profile.role);
        } else {
          localStorage.removeItem(ROLE_STORAGE_KEY);
        }

        if (pendingLoginRef.current) {
          pendingLoginRef.current = false;
          toast({
            title: "Welcome back!",
            description: "You have successfully signed in.",
          });
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        pendingLoginRef.current = false;
        clearAuthState();
      } finally {
        if (isMounted) setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [toast]);

  const signIn = async (email: string, password: string) => {
    try {
      pendingLoginRef.current = true;
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      pendingLoginRef.current = false;
      setLoading(false);
      console.error("Sign in error:", error);

      let message = "Invalid credentials. Please try again.";

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password"
      ) {
        message = "Incorrect email or password.";
      } else if (error.code === "auth/too-many-requests") {
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
    <AuthContext.Provider
      value={{ user, userRole, userAttribute, userName, allowedProgrammes, loading, signIn, signOutUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};
