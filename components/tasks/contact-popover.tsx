'use client'

// Tap a contact avatar (task rows) or chip (task modal) and get a
// small action menu: name, role, and one-tap Call / Text / Email links
// for whichever of phone/email the contact has. Pure interaction layer
// — the avatar stack and chip layouts stay exactly as they were; this
// wraps the existing markup as the trigger.

import { useCallback, useRef, useState } from 'react'
import type { Contact } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/components/ui/inline-edit'
import { Phone, MessageSquare, Mail } from 'lucide-react'

export function ContactActionMenu({ contact, children, align = 'left', action }: {
  contact: Contact
  // Trigger markup (avatar span, chip …) — rendered inside a button
  children: React.ReactNode
  align?: 'left' | 'right'
  // Optional context action rendered above the links (the task modal
  // uses it for its add-to/remove-from-task toggle). Closes the menu.
  action?: { label: string; onClick: () => void }
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Listener only while open — no idle document listener per avatar.
  useClickOutside(ref, close, open)

  const phone = contact.phone?.trim() || null
  const email = contact.email?.trim() || null

  const links = [
    ...(phone ? [
      { key: 'call', label: 'Call',  href: `tel:${phone}`,    detail: phone, Icon: Phone },
      { key: 'text', label: 'Text',  href: `sms:${phone}`,    detail: phone, Icon: MessageSquare },
    ] : []),
    ...(email ? [
      { key: 'email', label: 'Email', href: `mailto:${email}`, detail: email, Icon: Mail },
    ] : []),
  ]

  return (
    <div ref={ref} className="relative inline-flex" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={contact.full_name}
        className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-full">
        {children}
      </button>

      {open && (
        <div className={cn(
          'absolute top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[200px]',
          align === 'right' ? 'right-0' : 'left-0'
        )}>
          <div className="px-3 py-1.5 border-b border-slate-100">
            <div className="text-sm font-medium text-slate-800 truncate">{contact.full_name}</div>
            {contact.role && <div className="text-xs text-slate-400 truncate">{contact.role}</div>}
          </div>
          {action && (
            <button
              type="button"
              onClick={() => { close(); action.onClick() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
              {action.label}
            </button>
          )}
          {links.map(({ key, label, href, detail, Icon }) => (
            <a
              key={key}
              href={href}
              onClick={close}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
              <Icon size={13} className="text-slate-400 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              <span className="text-xs text-slate-400 truncate max-w-[130px]">{detail}</span>
            </a>
          ))}
          {links.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">No phone or email on file</div>
          )}
        </div>
      )}
    </div>
  )
}
