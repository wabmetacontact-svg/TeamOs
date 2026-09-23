import {
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Money and company-wide screens: managers only. */
  managerOnly?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/transactions", label: "Transactions", icon: Receipt, managerOnly: true },
  { href: "/clients", label: "Clients", icon: Users, managerOnly: true },
  { href: "/salaries", label: "Salaries", icon: Wallet, managerOnly: true },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/reports", label: "Reports", icon: PieChart, managerOnly: true },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };
