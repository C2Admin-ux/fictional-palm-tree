'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, CheckSquare, HardHat, BarChart2,
  FolderOpen, FileText, Shield, Building2, LogOut,
  Users, ClipboardList, ChevronRight, Settings,
} from 'lucide-react'

const NAV_PORTFOLIO = [
  { href: '/dashboard',          label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/tasks',              label: 'Tasks',            icon: CheckSquare },
  { href: '/capex',              label: 'CapEx',            icon: HardHat },
  { href: '/performance',        label: 'PM Performance',   icon: BarChart2 },
  { href: '/documents',          label: 'Contracts',        icon: FolderOpen },
  { href: '/insurance/policies', label: 'Insurance',        icon: Shield },
  { href: '/reports',            label: 'Reports',          icon: FileText },
  { href: '/inspections',        label: 'Inspections',      icon: ClipboardList },
  { href: '/settings',           label: 'Settings',         icon: Settings },
]

const NAV_SOON = [
  { href: '/underwriting', label: 'Underwriting' },
  { href: '/pipeline',     label: 'Pipeline' },
]

const PROPERTIES = [
  { id: 'b1000000-0000-0000-0000-000000000001', name: 'Fox Hill',         abbr: 'FH', color: '#1D9E75' },
  { id: 'b1000000-0000-0000-0000-000000000002', name: 'Pikes Place',      abbr: 'PP', color: '#D85A30' },
  { id: 'b1000000-0000-0000-0000-000000000003', name: 'Cottages on Vance',abbr: 'CV', color: '#7F77DD' },
  { id: 'b1000000-0000-0000-0000-000000000004', name: 'Main Street',      abbr: 'MS', color: '#BA7517' },
  { id: 'b1000000-0000-0000-0000-000000000005', name: 'Property 5',       abbr: 'P5', color: '#64748b' },
  { id: 'b1000000-0000-0000-0000-000000000006', name: 'Property 6',       abbr: 'P6', color: '#64748b' },
  { id: 'b1000000-0000-0000-0000-000000000007', name: 'Property 7',       abbr: 'P7', color: '#64748b' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[#1a2332] flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
              <Building2 size={14} className="text-white" />
            </div>
            <div>
              <div className="text-white font-semibold text-sm leading-none">C2 Capital</div>
              <div className="text-slate-400 text-xs mt-0.5">Portfolio Platform</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
          {/* Portfolio nav */}
          <div className="px-2 py-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Portfolio</span>
          </div>
          {NAV_PORTFOLIO.map(item => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link key={item.href} href={item.href}
                className={cn('sidebar-item', active && 'sidebar-item-active')}>
                <Icon size={14} className="flex-shrink-0" />
                {item.label}
              </Link>
            )
          })}

          {/* Properties */}
          <div className="px-2 pt-4 pb-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Properties</span>
          </div>
          {PROPERTIES.map(prop => {
            const active = pathname === `/properties/${prop.id}`
            return (
              <Link key={prop.id} href={`/properties/${prop.id}`}
                className={cn('sidebar-item', active && 'sidebar-item-active')}>
                <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: prop.color }}>
                  {prop.abbr.slice(0, 2)}
                </span>
                <span className="truncate text-xs">{prop.name}</span>
              </Link>
            )
          })}

          {/* Coming soon */}
          <div className="px-2 pt-4 pb-1">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wider">Coming Soon</span>
          </div>
          {NAV_SOON.map(item => (
            <div key={item.href}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-slate-600 cursor-default">
              <ChevronRight size={14} className="flex-shrink-0" />
              {item.label}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-white/10 flex-shrink-0">
          <button onClick={signOut}
            className="sidebar-item w-full">
            <LogOut size={14} className="flex-shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
