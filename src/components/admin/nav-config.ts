import type { LucideIcon } from "lucide-react"
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Crown,
  Database,
  FileDown,
  FileText,
  FolderOpen,
  MapPin,
  MessageSquare,
  Network,
  ScrollText,
  Shield,
  Snowflake,
  Thermometer,
  Users,
  Wind,
  Wrench,
} from "lucide-react"

export interface AdminNavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

export const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Setup",
    items: [
      { label: "Facility", href: "/admin/facility", icon: Building2 },
      { label: "People", href: "/admin/employees", icon: Users },
      { label: "Departments", href: "/admin/departments", icon: Network },
      { label: "Facility Spaces", href: "/admin/spaces", icon: MapPin },
      { label: "Permissions", href: "/admin/permissions", icon: Shield },
    ],
  },
  {
    label: "Module Admin",
    items: [
      {
        label: "Daily Reports Admin",
        href: "/admin/daily-reports",
        icon: FileText,
      },
      { label: "Ice Depth Admin", href: "/admin/ice-depth", icon: Snowflake },
      {
        label: "Ice Operations Admin",
        href: "/admin/ice-operations",
        icon: Wrench,
      },
      {
        label: "Incident Reports Admin",
        href: "/admin/incident-reports",
        icon: AlertCircle,
      },
      {
        label: "Accident Reports Admin",
        href: "/admin/accident-reports",
        icon: AlertTriangle,
      },
      {
        label: "Refrigeration Admin",
        href: "/admin/refrigeration",
        icon: Thermometer,
      },
      { label: "Air Quality Admin", href: "/admin/air-quality", icon: Wind },
      { label: "Scheduling Admin", href: "/admin/scheduling", icon: Calendar },
      {
        label: "Communications Admin",
        href: "/admin/communications",
        icon: MessageSquare,
      },
      {
        label: "Facility Paperwork",
        href: "/admin/facility-documents",
        icon: FolderOpen,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "PDF/Export Settings",
        href: "/admin/exports",
        icon: FileDown,
      },
      { label: "Data Retention", href: "/admin/retention", icon: Database },
      { label: "Audit Log", href: "/admin/audit-log", icon: ScrollText },
      { label: "Super Admin", href: "/admin/super-admin", icon: Crown },
    ],
  },
]

export function findActiveNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null
  for (const group of adminNavGroups) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.href.length) best = item
      }
    }
  }
  return best
}
