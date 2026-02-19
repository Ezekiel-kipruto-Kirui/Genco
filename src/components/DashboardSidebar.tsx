import {
  Building2,
  GraduationCap,
  TrendingUp,
  BarChart3,
  Database,
  ChevronRight,
  Beef,
  Upload,
  Activity,
  UserPlus,
  LineChart,
  HeartPulse,
  Settings,
  LogOut,
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { isChiefAdmin } from "@/contexts/authhelper";

const baseMenuItems = [
  {
    title: "Farmers Data",
    icon: Beef,
    subItems: [
      { title: "Dashboard", url: "/dashboard/livestock/analytics", icon: BarChart3 },
      { title: "Livestock Farmer", url: "/dashboard/livestock", icon: Database },
      { title: "Fodder Farmer", url: "/dashboard/fodder", icon: Database },
      { title: "Capacity Building", url: "/dashboard/capacity", icon: GraduationCap },
    ],
  },
  {
    title: "Infrastructure",
    icon: Building2,
    subItems: [
      { title: "Hay Storage", url: "/dashboard/hay-storage", icon: Database },
      { title: "Borehole", url: "/dashboard/borehole", icon: Database },
    ],
  },
  {
    title: "Offtake",
    icon: TrendingUp,
    subItems: [{ title: "Livestock", url: "/dashboard/livestock-offtake", icon: TrendingUp }],
  },
  {
    title: "Schedule Activity",
    icon: Activity,
    url: "/dashboard/activities",
  },
  {
    title: "Onboarding",
    icon: UserPlus,
    url: "/dashboard/onboarding",
  },
  {
    title: "Animal Health",
    icon: HeartPulse,
    url: "/dashboard/animalhealth",
  },
  {
    title: "Requisition",
    icon: Upload,
    url: "/dashboard/requisition",
  },
];

const reportItems = [
  { title: "Performance Report", url: "/dashboard/reports", icon: LineChart },
  { title: "Sales Metrics", url: "/dashboard/salesreport", icon: BarChart3 },
];

export function DashboardSidebar() {
  const { state } = useSidebar();
  const { signOutUser, userRole } = useAuth();
  const collapsed = state === "collapsed";
  const userIsChiefAdmin = isChiefAdmin(userRole);

  return (
    <Sidebar className={`${collapsed ? "w-14" : "w-64"} bg-green-700 text-white`} collapsible="icon">
      <SidebarHeader className="bg-green-700 pb-0">
        <div className="flex items-center gap-2 p-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 shadow backdrop-blur">
            <img src="/img/logo.png" className="h-8 w-8 rounded-full object-cover" alt="GenCo Logo" />
          </div>
          {!collapsed && (
            <div className="truncate">
              <h1 className="text-base font-bold text-white">GENCO L.Export ltd</h1>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarSeparator className="bg-white/20" />

      <SidebarContent className="bg-green-700">
        <SidebarGroup>
          <SidebarGroupLabel className="font-semibold text-green-100/80">{!collapsed && "Dashboard"}</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/dashboard"
                    end
                    className="text-green-50 transition-colors hover:bg-green-600"
                    activeClassName="bg-white font-bold text-green-700 shadow-sm"
                  >
                    <TrendingUp className="h-4 w-4" />
                    {!collapsed && <span>Dashboard Overview</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <Collapsible defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="text-green-50 transition-colors hover:bg-green-600">
                      <LineChart className="h-4 w-4" />
                      {!collapsed && (
                        <>
                          <span>Reports</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </>
                      )}
                    </SidebarMenuButton>
                  </CollapsibleTrigger>

                  {!collapsed && (
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {reportItems.map((sub) => (
                          <SidebarMenuSubItem key={sub.title}>
                            <SidebarMenuSubButton asChild>
                              <NavLink
                                to={sub.url}
                                className="text-green-100/70 transition-colors hover:bg-green-600"
                                activeClassName="bg-white font-bold text-green-700"
                              >
                                <sub.icon className="h-3.5 w-3.5" />
                                <span>{sub.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  )}
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="bg-white/20" />

        <SidebarGroup>
          <SidebarGroupLabel className="font-semibold text-green-100/80">{!collapsed && "Data Management"}</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {baseMenuItems.map((item) => {
                if (!item.subItems) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="text-green-50 transition-colors hover:bg-green-600"
                          activeClassName="bg-white font-bold text-green-700 shadow-sm"
                        >
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <Collapsible key={item.title} defaultOpen className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className="text-green-50 transition-colors hover:bg-green-600">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && (
                            <>
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            </>
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>

                      {!collapsed && (
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map((sub) => (
                              <SidebarMenuSubItem key={sub.title}>
                                <SidebarMenuSubButton asChild>
                                  <NavLink
                                    to={sub.url}
                                    className="text-green-100/70 transition-colors hover:bg-green-600"
                                    activeClassName="bg-white font-bold text-green-700"
                                  >
                                    <sub.icon className="h-3.5 w-3.5" />
                                    <span>{sub.title}</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      )}
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="bg-white/20" />

      <SidebarFooter className="bg-green-700 pt-0">
        <SidebarMenu>
          {userIsChiefAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <NavLink
                  to="/dashboard/users"
                  className="text-green-50 transition-colors hover:bg-green-600"
                  activeClassName="bg-white font-bold text-green-700 shadow-sm"
                >
                  <Settings className="h-4 w-4" />
                  {!collapsed && <span>Site Management</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOutUser} className="text-green-50 transition-colors hover:bg-green-600">
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
