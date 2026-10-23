import { Link, Outlet, useLocation } from 'react-router-dom'
export function Layout() {
  const { pathname } = useLocation()
  if (pathname === '/admin') return <Outlet />
  return <div className="public-layout min-h-screen bg-[#f8faf8] text-[#191c1b]"><header className="bg-[#103b2b]"><div className="flex h-[76px] items-center justify-start px-5 sm:px-8"><Link to="/" aria-label="Basakan Pickle home"><img src="/assets/basakan-pickle-logo.png" alt="Basakan Pickle" className="h-20 w-auto object-contain" /></Link></div></header><main className="px-0"><Outlet /></main><footer className="mx-auto max-w-6xl border-t border-[#e5eae5] px-5 py-8 text-xs text-[#708077] sm:px-8">© {new Date().getFullYear()} Basakan Pickleball · Asia/Manila</footer></div>
}
