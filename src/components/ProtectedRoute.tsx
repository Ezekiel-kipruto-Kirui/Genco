import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, userRole, loading } = useAuth();

  // 1️⃣ Show loader while waiting for auth/role
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // 2️⃣ If user is not logged in, redirect to login
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // 3️⃣ If allowedRoles is defined and the user role is NOT in it, redirect
  if (allowedRoles && (!userRole || !allowedRoles.includes(userRole))) {
    return <Navigate to="/dashboard" replace />;
  }

  // 4️⃣ Otherwise render children
  return <>{children}</>;
};

export default ProtectedRoute;
