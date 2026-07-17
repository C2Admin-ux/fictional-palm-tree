'use client'

// Mobile bottom tab bar (below md): the four everyday destinations one
// thumb-tap away — Dashboard, Tasks, Inspections, and Properties.
// "Properties" is a list, not a single page, so its tab TOGGLES the
// existing drawer (scrolling the sidebar reveals the property links;
// a second tap closes it); the hamburger stays for the long tail
// (CapEx, Insurance, …).
// Fixed to the viewport bottom with safe-area padding; the shell gives
// <main> matching bottom padding so content never hides behind it.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/lib/nav'
import { Building2 } from 'lucide-react'

// The three everyday destinations, picked from the shared nav list by
// href (NAV_ITEMS order already matches: Dashboard, Tasks, Inspections).
const TAB_HREFS = ['/dashboard', '/tasks', '/inspections']
const TABS = NAV_ITEMS.filter(n => TAB_HREFS.includes(n.href))

export function BottomTabBar({ onToggleProperties }: {
  onToggleProperties: () => void
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#1a2332] border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4">
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              )}>
              <Icon size={18} />
              {tab.label}
            </Link>
          )
        })}
        <button
          onClick={onToggleProperties}
          className={cn(
            'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
            pathname.startsWith('/properties') ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
          )}>
          <Building2 size={18} />
          Properties
        </button>
      </div>
    </nav>
  )
}
