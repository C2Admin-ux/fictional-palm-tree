// Single source of truth for the portfolio nav. The sidebar renders
// it verbatim, the command palette derives its page rows from it, and
// the mobile bottom tab bar picks its three tabs from it by href — one
// list to edit when a destination is added, renamed, or reordered.

import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, CheckSquare, Wrench, TrendingUp,
  FileSignature, Shield, FileBarChart, ClipboardCheck, Phone, Settings,
} from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',          label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/tasks',              label: 'Tasks',          icon: CheckSquare },
  { href: '/capex',              label: 'CapEx',          icon: Wrench },
  { href: '/performance',        label: 'PM Performance', icon: TrendingUp },
  { href: '/documents',          label: 'Contracts',      icon: FileSignature },
  { href: '/insurance/policies', label: 'Insurance',      icon: Shield },
  { href: '/reports',            label: 'Reports',        icon: FileBarChart },
  { href: '/inspections',        label: 'Inspections',    icon: ClipboardCheck },
  { href: '/calls',              label: 'Calls',          icon: Phone },
  { href: '/settings',           label: 'Settings',       icon: Settings },
]
