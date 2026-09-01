// Single source of truth for the portfolio nav. The sidebar renders
// it verbatim, the command palette derives its page rows from it, and
// the mobile bottom tab bar picks its three tabs from it by href — one
// list to edit when a destination is added, renamed, or reordered.

import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, CheckSquare, Wrench,
  FileSignature, Shield, FileBarChart, ClipboardCheck, Phone, Settings,
  CalendarClock, Scale,
} from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon }

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',          label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/tasks',              label: 'Tasks',          icon: CheckSquare },
  { href: '/capex',              label: 'CapEx',          icon: Wrench },
  { href: '/renewals',           label: 'Renewals',       icon: CalendarClock },
  // PM Performance hidden for now (Nick, 2026-09-01) — the /performance
  // page still exists and is directly routable; to restore it, re-add
  // { href: '/performance', label: 'PM Performance', icon: TrendingUp }
  // here (and TrendingUp to the lucide import above).
  { href: '/documents',          label: 'Contracts',      icon: FileSignature },
  { href: '/insurance/policies', label: 'Insurance',      icon: Shield },
  { href: '/litigation',         label: 'Litigation',     icon: Scale },
  { href: '/reports',            label: 'Reports',        icon: FileBarChart },
  { href: '/inspections',        label: 'Inspections',    icon: ClipboardCheck },
  { href: '/calls',              label: 'Calls',          icon: Phone },
  { href: '/settings',           label: 'Settings',       icon: Settings },
]
