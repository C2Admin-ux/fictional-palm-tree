'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, propertyColor } from '@/lib/utils'
import { Toaster } from '@/components/ui/toast'
import { GlobalQuickAdd } from '@/components/tasks/global-quick-add'
import { CommandPalette } from '@/components/ui/command-palette'
import { BottomTabBar } from '@/components/ui/bottom-tab-bar'
import {
  LayoutDashboard, CheckSquare, Wrench, TrendingUp,
  FileSignature, Shield, FileBarChart, ClipboardCheck,
  Settings, Building2, LogOut, ChevronRight, Menu, X, Plus,
} from 'lucide-react'

const NAV_PORTFOLIO = [
  { href: '/dashboard',          label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/tasks',              label: 'Tasks',            icon: CheckSquare },
  { href: '/capex',              label: 'CapEx',            icon: Wrench },
  { href: '/performance',        label: 'PM Performance',   icon: TrendingUp },
  { href: '/documents',          label: 'Contracts',        icon: FileSignature },
  { href: '/insurance/policies', label: 'Insurance',        icon: Shield },
  { href: '/reports',            label: 'Reports',          icon: FileBarChart },
  { href: '/inspections',        label: 'Inspections',      icon: ClipboardCheck },
  { href: '/settings',           label: 'Settings',         icon: Settings },
]

const NAV_SOON = [
  { href: '/underwriting', label: 'Underwriting' },
  { href: '/pipeline',     label: 'Pipeline' },
]

type SidebarProperty = { id: string; name: string }

function propertyAbbr(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [properties, setProperties] = useState<SidebarProperty[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('properties').select('id, name').order('name')
      .then(({ data }) => setProperties(data ?? []))
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  // Close the mobile drawer whenever navigation happens
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  // Global `n` → open the capture sheet from any page (desktop). The
  // tasks page owns its own `n` (focuses its inline quick-add bar), so
  // it wins there; everywhere else this light listener takes it.
  const pathnameRef = useRef(pathname); pathnameRef.current = pathname
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (pathnameRef.current.startsWith('/tasks')) return
      if (window.matchMedia('(pointer: coarse)').matches) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      setQuickAddOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: fixed drawer on mobile, static column on md+ */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-56 bg-[#1a2332] flex flex-col overflow-hidden',
        'transition-transform duration-200 ease-out',
        'md:static md:z-auto md:flex-shrink-0 md:translate-x-0 md:transition-none',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
              <Building2 size={14} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="text-white font-semibold text-sm leading-none">C2 Capital</div>
              <div className="text-slate-400 text-xs mt-0.5">Portfolio Platform</div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 -mr-1 text-slate-400 hover:text-white"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
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
          {properties.map(prop => {
            const active = pathname === `/properties/${prop.id}`
            return (
              <Link key={prop.id} href={`/properties/${prop.id}`}
                className={cn('sidebar-item', active && 'sidebar-item-active')}>
                <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: propertyColor(prop.name) }}>
                  {propertyAbbr(prop.name)}
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

      {/* Main column */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#1a2332] flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 -ml-1 text-white"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="w-6 h-6 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Building2 size={12} className="text-white" />
          </div>
          <span className="text-white font-semibold text-sm flex-1">C2 Capital</span>
          <button
            onClick={() => setQuickAddOpen(true)}
            className="p-1.5 -mr-1.5 text-white/90 hover:text-white"
            aria-label="Quick add task"
          >
            <Plus size={20} />
          </button>
        </header>

        {/* Bottom padding below md reserves room for the fixed tab bar,
            so page footers/sticky bars land above it, not behind it */}
        <main className="flex-1 overflow-y-auto pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>

      <BottomTabBar onOpenProperties={() => setSidebarOpen(true)} />

      <GlobalQuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        userId={userId}
        properties={properties}
      />

      <CommandPalette properties={properties} userId={userId} />

      <Toaster />
    </div>
  )
}
