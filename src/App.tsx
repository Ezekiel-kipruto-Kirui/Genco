import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "./components/DashboardLayout";

// Lazy load page components to split code
const Auth = lazy(() => import("./pages/Auth"));
const DashboardOverview = lazy(() => import("./pages/DashboardOverview"));
const PerformanceReport = lazy(() => import("./pages/reportspage"));
const LivestockFarmersPage = lazy(() => import("./pages/LivestockFarmersPage"));
const LivestockFarmersAnalytics = lazy(() => import("./pages/LivestockFarmersAnalytics"));
const FodderFarmersPage = lazy(() => import("./pages/FodderFarmersPage"));
const InfrastructurePage = lazy(() => import("./pages/BoreHole"));
const HayStoragepage = lazy(() => import("./pages/HayStoragepage"));
const CapacityBuildingPage = lazy(() => import("./pages/CapacityBuildingPage"));
const LivestockOfftakePage = lazy(() => import("./pages/LivestockOfftakePage"));
const ActivitiesPage = lazy(() => import("./pages/ActivitiesPage"));
const OnboardingPage = lazy(() => import("./pages/onboardingpage"));
const AnimalHealthPage = lazy(() => import("./pages/Animalhealth"));
const FodderOfftakePage = lazy(() => import("./pages/FodderOfftakePage"));
const UserManagementPage = lazy(() => import("./pages/UserManagementPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// A simple loading component to show while chunks are loading
const PageLoader = () => (
  <div className="flex h-screen w-screen items-center justify-center">
    <div className="text-lg font-semibold text-muted-foreground">Loading page...</div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="/auth" element={<Auth />} />
              
              {/* Protected Dashboard Routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute allowedRoles={["admin", "chief-admin"]}>
                    <DashboardLayout />
                  </ProtectedRoute>
                }
              >
                {/* Nested routes under DashboardLayout */}
                <Route index element={<DashboardOverview />} />
                
                {/* Report route */}
                <Route
                  path="reports"
                  element={
                    <ProtectedRoute allowedRoles={["admin", "chief-admin"]}>
                      <PerformanceReport/>
                    </ProtectedRoute>
                  }
                />
                
                <Route path="livestock">
                  <Route index element={<LivestockFarmersPage />} />
                  <Route path="analytics" element={<LivestockFarmersAnalytics />} />
                </Route>
                
                <Route path="fodder" element={<FodderFarmersPage />} />
                
                {/* Infrastructure Routes */}
                <Route path="hay-storage" element={<HayStoragepage />} />
                <Route path="borehole" element={<InfrastructurePage />} />
                
                <Route path="capacity" element={<CapacityBuildingPage />} />
                
                {/* Offtake Routes */}
                <Route path="livestock-offtake">
                  <Route index element={<LivestockOfftakePage />} />
                </Route>
                <Route path="fodder-offtake" element={<FodderOfftakePage />} />
                
                <Route path="activities" element={<ActivitiesPage />} />
                <Route path="onboarding" element={<OnboardingPage />} />
                <Route path="animalhealth" element={<AnimalHealthPage />} />

                {/* Admin Only Routes */}
                <Route 
                  path="users" 
                  element={
                    <ProtectedRoute allowedRoles={["chief-admin", "admin"]}>
                      <UserManagementPage />
                    </ProtectedRoute>
                  } 
                />
              </Route>

              {/* Catch-all route for 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;