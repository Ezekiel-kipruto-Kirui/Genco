import {
  Wheat,
  Building2,
  GraduationCap,
  TrendingUp,
  Users,
  BarChart3,
  Database,
  ChevronRight,
  Beef,
  Upload,
  Activity,
  UserPlus,
  LineChart,
  HeartPulse
} from "lucide-react";

import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar";

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
// ✅ FIXED: Import from the new helper file instead of the page
import { isChiefAdmin } from "@/contexts/authhelper";

// Base menu items without User Management
const baseMenuItems = [
  {
    title: "Livestock Farmers",
    icon: Beef,
    subItems: [
      { title: "Dashboard", url: "/dashboard/livestock/analytics", icon: BarChart3 },
      { title: "Farmer Data", url: "/dashboard/livestock", icon: Database },
    ]
  },
  {
    title: "Fodder Farmers",
    icon: Wheat,
    url: "/dashboard/fodder",
  },
  {
    title: "Infrastructure",
    icon: Building2,
    subItems: [
      { title: "Hay Storage", url: "/dashboard/hay-storage", icon: Database },
      { title: "Borehole", url: "/dashboard/borehole", icon: Database },
    ]
  },
  {
    title: "Capacity Building",
    icon: GraduationCap,
    url: "/dashboard/capacity",
  },
  { 
    title: "Livestock Offtake",
    icon: TrendingUp,
    url: "/dashboard/livestock-offtake"
  },
  { 
    title: "Fodder Offtake",
    icon: Wheat,
    url: "/dashboard/fodder-offtake"
  },
  { 
    title: "Schedule Activity",
    icon: Activity,
    url: "/dashboard/activities"
  },
  { 
    title: "Onboarding",
    icon: UserPlus,
    url: "/dashboard/onboarding"
  },
   { 
    title: "Animal Health",
    icon: HeartPulse,
    url: "/dashboard/animalhealth"
  },
];

export function DashboardSidebar() {
  const { state } = useSidebar();
  const { userRole } = useAuth();
  const collapsed = state === "collapsed";
  
  const userIsChiefAdmin = isChiefAdmin(userRole);

  // Build menu items dynamically based on user role
  const menuItems = [
    ...baseMenuItems,
    // Conditionally add User Management for chief admin only
     ...(userIsChiefAdmin ? 
    [
    {
      title: "User Management",
      icon: Users,
      url: "/dashboard/users"
    }] : [])
  ];

  return (
    <Sidebar className={collapsed ? "w-14" : "w-64"} collapsible="icon">
      <SidebarContent className="bg-sidebar">
        
        {/* Branding Section */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center gap-2 p-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 shadow flex items-center justify-center">
                <img src="/img/logo.png" className="w-8 h-8 rounded-full object-cover" alt="GenCo Logo" />
              </div>

              {!collapsed && (
                <div className="truncate">
                  <h1 className="text-base font-bold">GenCo Company</h1>
                </div>
              )}
            </div>
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/dashboard"
                    end
                    className="hover:bg-sidebar-accent text-sidebar-foreground mt-4"
                    activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  >
                    <TrendingUp className="h-4 w-4" />
                    {!collapsed && <span>Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
           <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/dashboard/reports"
                    end
                    className="hover:bg-sidebar-accent text-sidebar-foreground"
                    activeClassName="bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  >
                    <LineChart className="h-4 w-4" />
                    {!collapsed && <span>Perfomance report</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Main Menu */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">
            {!collapsed && "Data Management"}
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>

              {menuItems.map((item) => {
                // Render simple link (no subItems)
                if (!item.subItems) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="hover:bg-sidebar-accent text-sidebar-foreground"
                          activeClassName="bg-sidebar-primary/20 text-sidebar-primary font-medium"
                        >
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                // Render collapsible group
                return (
                  <Collapsible key={item.title} defaultOpen className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className="hover:bg-sidebar-accent text-sidebar-foreground">
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
                                    className="hover:bg-sidebar-accent text-sidebar-foreground/80"
                                    activeClassName="bg-sidebar-primary/20 text-sidebar-primary font-medium"
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
    </Sidebar>
  );
}