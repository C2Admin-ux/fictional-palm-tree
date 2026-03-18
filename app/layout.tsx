import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'C2 Capital | Portfolio Management',
  description: 'Internal portfolio management platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
