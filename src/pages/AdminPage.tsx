import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Clock, LogOut, Search, Settings as SettingsIcon } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Toast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { dateLabel, isPastSlot, money, rateForHour, timeLabel, todayManila, totalForHours } from '../lib/format'
import type { Booking, BookingStatus, Settings } from '../lib/database.types'

type Tab = 'bookings' | 'settings'
const navItems: { key: Tab; label: string; icon: typeof CalendarDays }[] = [{ key: 'bookings', label: 'Bookings', icon: CalendarDays }, { key: 'settings', label: 'Settings', icon: SettingsIcon }]
const navButton = 'flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold transition'
function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  const zone = { timeZone: 'Asia/Manila' } as const
  return <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm"><Clock className="h-5 w-5 text-forest" aria-hidden /><div className="leading-tight"><div className="font-black tabular-nums">{new Intl.DateTimeFormat('en-PH', { ...zone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</div><div className="text-xs text-slate-500">{new Intl.DateTimeFormat('en-PH', { ...zone, dateStyle: 'full' }).format(now)}</div></div></div>
}
const dotStyle: Record<string, string> = { pending: 'bg-amber-400', confirmed: 'bg-emerald-500', rejected: 'bg-red-500', cancelled: 'bg-slate-400', held: 'bg-sky-400', expired: 'bg-slate-300' }
const field = 'w-full rounded-lg border border-[#dce3de] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2e7d58] focus:ring-2 focus:ring-[#2e7d58]/15'
const StatusDot = ({ status }: { status: string }) => <span className="inline-flex items-center gap-2 text-sm capitalize"><span className={`h-2 w-2 rounded-full ${dotStyle[status] ?? 'bg-slate-300'}`} />{status}</span>

export function AdminPage() {
  const navigate = useNavigate(); const client = useQueryClient()
  const [authorized, setAuthorized] = useState(false); const [accessChecked, setAccessChecked] = useState(false); const [accessError, setAccessError] = useState('')
  const [search, setSearch] = useState(''); const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatus>('all')
  const [tab, setTab] = useState<Tab>('bookings'); const [menuOpen, setMenuOpen] = useState(false)
  const auth = useQuery({ queryKey: ['auth'], queryFn: async () => (await supabase.auth.getSession()).data.session })
  useEffect(() => {
    if (auth.isLoading) return
    if (!auth.data) { setAccessChecked(true); navigate('/admin/login'); return }
    void supabase.from('admin_users').select('user_id').eq('user_id', auth.data.user.id).maybeSingle().then(({ data, error }) => {
      if (error) setAccessError(`Admin access could not be checked: ${error.message}`)
      else if (!data) setAccessError(`Signed in as ${auth.data?.user.email ?? 'this account'}, but it is not listed in public.admin_users.`)
      setAuthorized(Boolean(data)); setAccessChecked(true)
    })
  }, [auth.data, auth.isLoading, navigate])
  const bookings = useQuery({ queryKey: ['admin-bookings'], enabled: authorized, queryFn: async () => { const result = await supabase.from('bookings').select('*').order('booking_date', { ascending: false }).order('created_at', { ascending: false }); if (result.error) throw result.error; return result.data as Booking[] } })
  const courts = useQuery({ queryKey: ['admin-courts'], enabled: authorized, queryFn: async () => { const result = await supabase.from('courts').select('id,is_active'); if (result.error) throw result.error; return result.data } })
  const filtered = useMemo(() => { const terms = search.toLowerCase().split(/\s+/).filter(Boolean); return (bookings.data ?? []).filter((booking) => { const haystack = `${booking.first_name ?? ''} ${booking.last_name ?? ''} ${booking.phone ?? ''} ${booking.email ?? ''} ${booking.reference_code} ${booking.booking_date} ${dateLabel(booking.booking_date)} court ${booking.court_id} ${booking.status}`.toLowerCase(); return (statusFilter === 'all' || booking.status === statusFilter) && terms.every((term) => haystack.includes(term)) }) }, [bookings.data, search, statusFilter])
  const selected = (bookings.data ?? []).find((booking) => booking.id === selectedId) ?? null
  const allBookings = bookings.data ?? []
  const today = todayManila()
  const todayBookings = allBookings.filter((booking) => booking.booking_date === today)
  const revenueToday = todayBookings.filter((booking) => booking.status === 'confirmed').reduce((total, booking) => total + Number(booking.total_amount), 0)
  const pendingCount = allBookings.filter((booking) => booking.status === 'pending').length
  const courtCount = courts.data?.filter((court) => court.is_active).length ?? 0
  const courtTotal = courts.data?.length ?? 0
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin-bookings'] })
  const notify = (message: string, variant: 'success' | 'error' = 'success') => setToast({ message, variant })
  const signOut = () => void supabase.auth.signOut().then(() => { client.setQueryData(['auth'], null); navigate('/admin/login') })

  if (auth.isLoading || (auth.data && !accessChecked)) return <div className="py-20 text-center">Checking admin access…</div>
  if (!auth.data) return <Navigate to="/admin/login" replace />
  if (!authorized) return <div className="mx-auto max-w-lg px-5 py-16"><div className="rounded-3xl bg-white p-8 shadow-soft"><h1 className="text-2xl font-black text-forest">Admin access is not enabled</h1><p className="mt-3 text-sm leading-relaxed text-slate-600">{accessError}</p><p className="mt-4 rounded-xl bg-[#f1f6e8] p-4 text-sm text-forest">Add this account to <code>public.admin_users</code> in Supabase, then sign in again.</p><button onClick={signOut} className="mt-5 w-full rounded-xl bg-forest px-4 py-3 font-bold text-white">Back to sign in</button></div></div>

  const sidebar = <div className="flex h-full flex-col bg-[#103b2b] text-white">
  <div className="flex h-24 items-center justify-center px-5 md:max-xl:px-2"><img src="/assets/basakan-pickle-logo.png" alt="Basakan Pickle" className="h-20 max-w-full object-contain md:max-xl:h-10" /></div>
    <div className="mx-4 border-t border-white/10" />
    <nav className="flex-1 space-y-1 px-3 pt-5 md:max-xl:px-2">{navItems.map((item) => { const Icon = item.icon; return <button key={item.key} title={item.label} onClick={() => { setTab(item.key); setMenuOpen(false) }} className={`${navButton} justify-start px-4 md:max-xl:justify-center md:max-xl:px-2 ${tab === item.key ? 'border-l-[3px] border-[#88d7ab] bg-[#1a4d39] text-white' : 'text-[#a3b8ad] hover:bg-white/5 hover:text-white'}`}><Icon className="h-5 w-5 shrink-0" aria-hidden /><span className="md:max-xl:hidden">{item.label}</span>{item.key === 'bookings' && pendingCount > 0 && <span className="ml-auto rounded-full bg-amber-300 px-2 py-0.5 text-xs font-bold text-[#103b2b] md:max-xl:hidden">{pendingCount}</span>}</button> })}</nav>
    <div className="border-t border-white/10 p-3 md:max-xl:p-2"><button onClick={signOut} title="Sign out" className={`${navButton} justify-start px-4 text-[#a3b8ad] hover:bg-white/5 hover:text-white md:max-xl:justify-center md:max-xl:px-2`}><LogOut className="h-5 w-5 shrink-0" aria-hidden /><span className="md:max-xl:hidden">Sign out</span></button></div>
  </div>

  return <div className="min-h-screen bg-[#f8faf8] text-[#191c1b] md:flex">
    <aside className="hidden w-20 shrink-0 md:block xl:w-[260px]"><div className="fixed inset-y-0 w-20 xl:w-[260px]">{sidebar}</div></aside>
    <div className="sticky top-0 z-20 flex items-center justify-between bg-[#103b2b] px-4 py-3 text-white md:hidden"><img src="/assets/basakan-pickle-logo.png" alt="Basakan Pickle" className="h-10 w-auto object-contain" /><button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-lg border border-white/30 px-3 py-2 text-sm font-bold">Menu</button></div>
    {menuOpen && <div className="fixed inset-0 z-30 md:hidden"><button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" /><div className="absolute inset-y-0 left-0 w-[260px]">{sidebar}</div></div>}
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {tab === 'bookings' ? <>
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5eae5] pb-5">
          <div><h1 className="text-3xl font-bold tracking-tight text-[#0f1e17]">Bookings</h1><p className="mt-1 text-sm text-[#526058]">Manage reservations and payment status.</p></div>
          <LiveClock />
        </header>
        {bookings.isError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">Bookings could not be loaded: {bookings.error.message}</p>}
        {courts.isError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">Court totals could not be loaded: {courts.error.message}</p>}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Today's bookings" value={String(todayBookings.length)} note={todayBookings.length ? `Across ${new Set(todayBookings.map((booking) => booking.court_id)).size} court${new Set(todayBookings.map((booking) => booking.court_id)).size === 1 ? '' : 's'}` : 'No reservations today'} icon={<CalendarDays className="h-5 w-5" />} />
          <MetricCard label="Revenue today" value={money(revenueToday)} note="Confirmed bookings" icon={<span className="text-base font-black">₱</span>} />
          <MetricCard label="Active courts" value={courts.isLoading ? '…' : `${courtCount} / ${courtTotal} active`} note="Courts accepting reservations" icon={<span className="text-base font-black">◎</span>} />
          <MetricCard label="Action required" value={`${pendingCount} pending`} note="Awaiting payment review" icon={<Clock className="h-5 w-5" />} accent={pendingCount > 0} onClick={() => setStatusFilter('pending')} />
        </section>
        <section className="mt-6 rounded-xl border border-[#e5eae5] bg-white p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#728279]" aria-hidden /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email, reference, date, court" className="w-full rounded-lg border border-[#dce3de] bg-[#f8faf8] py-2.5 pl-10 pr-3 text-sm outline-none placeholder:text-[#8a9890] focus:border-[#2e7d58] focus:ring-2 focus:ring-[#2e7d58]/15" /></label>
            <div className="flex flex-wrap gap-1 rounded-lg bg-[#f2f4f2] p-1">{(['all', 'confirmed', 'pending', 'expired', 'rejected', 'cancelled'] as const).map((status) => <button key={status} onClick={() => setStatusFilter(status)} className={`rounded-md px-3 py-2 text-xs font-semibold capitalize ${statusFilter === status ? 'bg-white text-[#103b2b] shadow-sm' : 'text-[#526058] hover:text-[#103b2b]'}`}>{status === 'all' ? `All (${allBookings.length})` : `${status} (${allBookings.filter((booking) => booking.status === status).length})`}</button>)}</div>
          </div>
        </section>
        <section className="mt-5 overflow-hidden rounded-xl border border-[#e5eae5] bg-white">
          <div className="max-h-[44rem] overflow-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-[#526058]"><tr><th className="sticky top-0 z-10 bg-[#f1f5f2] px-5 py-4">Customer</th><th className="sticky top-0 z-10 bg-[#f1f5f2] px-5 py-4">Schedule &amp; court</th><th className="sticky top-0 z-10 bg-[#f1f5f2] px-5 py-4">Total</th><th className="sticky top-0 z-10 bg-[#f1f5f2] px-5 py-4">Status</th><th className="sticky top-0 z-10 bg-[#f1f5f2] px-5 py-4 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-[#edf2ee]">{filtered.map((booking) => <tr key={booking.id} onClick={() => setSelectedId(booking.id)} className="h-16 cursor-pointer transition hover:bg-[#f5f9f6]">
                <td className="px-5 py-3"><div className="font-bold text-[#0f1e17]">{booking.first_name || 'No name'} {booking.last_name || ''}</div><div className="font-mono text-xs tabular-nums text-[#708077]">{booking.reference_code}</div></td>
                <td className="px-5 py-3"><div className="font-medium tabular-nums">{dateLabel(booking.booking_date)}</div><div className="text-xs text-[#708077]">Court {booking.court_id} · {booking.total_hours}h</div></td>
                <td className="whitespace-nowrap px-5 py-3 font-bold tabular-nums">{money(booking.total_amount)}</td>
                <td className="px-5 py-3"><StatusBadge status={booking.status} /></td>
                <td className="px-5 py-3 text-right"><button onClick={(event) => { event.stopPropagation(); setSelectedId(booking.id) }} className="rounded-md border border-[#d0dcd4] px-3 py-1.5 text-xs font-bold text-[#103b2b] transition hover:border-[#103b2b] hover:bg-[#103b2b] hover:text-white">View</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="border-t border-[#edf2ee] px-5 py-3 text-xs text-[#708077]">Showing {filtered.length} of {allBookings.length} booking{allBookings.length === 1 ? '' : 's'}</p>
          {!filtered.length && !bookings.isError && <p className="py-10 text-center text-sm text-[#708077]">{bookings.isLoading ? 'Loading bookings…' : 'No bookings match your search.'}</p>}
        </section>
      </> : <>
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5eae5] pb-5"><div><h1 className="text-3xl font-bold tracking-tight text-[#0f1e17]">Settings</h1><p className="mt-1 text-sm text-[#526058]">Manage your booking and payment preferences.</p></div><LiveClock /></header>
        <div className="mt-6"><SettingsPanel onSaved={() => notify('Settings saved.')} onUploaded={() => notify('GCash QR image uploaded.')} /></div>
      </>}
    </main>
    {selected && <BookingModal booking={selected} onClose={() => setSelectedId(null)} onChanged={refresh} notify={notify} />}
    {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}
  </div>
}

function MetricCard({ label, value, note, icon, accent = false, onClick }: { label: string; value: string; note: string; icon: React.ReactNode; accent?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`min-h-32 rounded-xl border border-[#e5eae5] bg-white p-4 text-left shadow-[0_2px_8px_rgba(16,59,43,0.04)] ${onClick ? 'transition hover:border-[#c1c8c2]' : 'cursor-default'}`}><div className="flex items-start justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-[#526058]">{label}</span><span className={`grid h-9 w-9 place-items-center rounded-lg ${accent ? 'bg-[#fff3dc] text-[#976400]' : 'bg-[#f2f4f2] text-[#186b48]'}`}>{icon}</span></div><div className="mt-3 text-2xl font-bold tracking-tight text-[#103b2b] tabular-nums">{value}</div><div className="mt-1 text-xs text-[#708077]">{note}</div></button>
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'confirmed' ? 'bg-[#eaf6ee] text-[#1b633f]' : status === 'pending' ? 'bg-[#fef6e7] text-[#966004]' : status === 'rejected' || status === 'cancelled' ? 'bg-[#fdeeee] text-[#a42a2a]' : 'bg-[#eff3f1] text-[#57665f]'
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold capitalize ${style}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>
}

function BookingModal({ booking, onClose, onChanged, notify }: { booking: Booking; onClose: () => void; onChanged: () => void; notify: (message: string, variant?: 'success' | 'error') => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'move'>('view'); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; confirmLabel: string; tone?: 'primary' | 'danger'; action: () => Promise<void> } | null>(null)
  const [form, setForm] = useState({ first_name: booking.first_name ?? '', last_name: booking.last_name ?? '', phone: booking.phone ?? '', email: booking.email ?? '', admin_notes: booking.admin_notes ?? '' })
  const [move, setMove] = useState({ date: booking.booking_date, court: booking.court_id, hours: [] as number[] })
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  const slots = useQuery({ queryKey: ['booking-slots', booking.id, booking.booking_date, booking.court_id], queryFn: async () => { const result = await supabase.from('booking_slots').select('slot_hour,hourly_rate').eq('booking_id', booking.id).order('slot_hour'); if (result.error) throw result.error; return result.data } })
  const pricing = useQuery({ queryKey: ['admin-booking-pricing'], queryFn: async () => { const result = await supabase.from('settings').select('day_hourly_rate,night_hourly_rate').eq('id', 1).single(); if (result.error) throw result.error; return result.data } })
  const receipt = useQuery({ queryKey: ['receipt', booking.receipt_path], enabled: Boolean(booking.receipt_path), queryFn: async () => { const result = await supabase.storage.from('receipts').createSignedUrl(booking.receipt_path!, 600); if (result.error) throw result.error; return result.data.signedUrl } })
  useEffect(() => { if (slots.data) setMove((old) => ({ ...old, hours: slots.data.map((slot) => slot.slot_hour) })) }, [slots.data])
  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>, success: string, close = false) => { setBusy(true); setError(''); const result = await action(); setBusy(false); if (result.error) { setError(friendlyError(result.error) === 'Something went wrong. Please try again.' ? result.error.message : friendlyError(result.error)); return }; notify(success); onChanged(); if (close) onClose(); else setMode('view') }
  const setStatus = (next: BookingStatus, label: string) => run(() => supabase.from('bookings').update({ status: next }).eq('id', booking.id), `${booking.reference_code} ${label}.`)
  const save = () => run(() => supabase.from('bookings').update({ first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim(), email: form.email.trim(), admin_notes: form.admin_notes }).eq('id', booking.id), 'Booking details updated.')
  const reschedule = async () => { if (movePast) { setError('Past time slots cannot be booked. Choose a future date or time.'); return }; await run(() => supabase.rpc('admin_reschedule_booking', { p_booking_id: booking.id, p_court_id: move.court, p_date: move.date, p_hours: move.hours }), 'Booking rescheduled.') }
  const remove = async () => {
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('admin_delete_booking', { p_booking_id: booking.id })
      if (result.error) { setError(friendlyError(result.error)); return }
      if (result.data) {
        const cleanup = await supabase.storage.from('receipts').remove([result.data])
        if (cleanup.error) notify(`${booking.reference_code} was deleted, but its receipt file could not be removed: ${friendlyError(cleanup.error)}`, 'error')
        else notify(`${booking.reference_code} deleted.`)
      } else notify(`${booking.reference_code} deleted.`)
      onChanged()
      onClose()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }
  const locked = booking.status === 'rejected' || booking.status === 'cancelled'
  const movePast = move.hours.some((hour) => isPastSlot(move.date, hour))
  const rows: [string, string][] = [['Reference', booking.reference_code], ['Date', dateLabel(booking.booking_date)], ['Court', `Court ${booking.court_id}`], ['Total', `${money(booking.total_amount)} · ${booking.total_hours}h`], ['Phone', booking.phone || '—'], ['Email', booking.email || '—'], ['Submitted', booking.submitted_at ? new Date(booking.submitted_at).toLocaleString() : '—'], ['Notes', booking.admin_notes || '—']]
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#002418]/45 sm:items-center sm:p-5">
    <button aria-label="Close" onClick={onClose} className="absolute inset-0" />
    <div role="dialog" aria-modal="true" className="relative flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-[#e5eae5] bg-[#f8faf8] shadow-[0_20px_40px_-8px_rgba(16,59,43,0.2)] sm:rounded-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-[#e5eae5] bg-white px-5 py-4 sm:px-6"><div><h2 className="text-xl font-bold text-[#103b2b]">{booking.first_name || 'No name'} {booking.last_name || ''}</h2><div className="mt-1 flex items-center gap-3 text-xs text-[#526058]"><StatusDot status={booking.status} /><span className="font-mono tabular-nums">{booking.reference_code}</span></div></div><button onClick={onClose} aria-label="Close" className="rounded-md px-3 py-1 text-xl leading-none text-[#708077] hover:bg-[#f2f4f2]">×</button></div>
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">{error}</p>}
        {mode === 'view' && <div className="space-y-5">
          <dl className="grid gap-4 rounded-xl border border-[#e5eae5] bg-white p-4 text-sm sm:grid-cols-2 sm:p-5">{rows.map(([label, value]) => <div key={label}><dt className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">{label}</dt><dd className="mt-1 break-words font-semibold text-[#191c1b]">{value}</dd></div>)}</dl>
          <div className="rounded-xl border border-[#e5eae5] bg-white p-4 sm:p-5"><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Time slots</p><div className="mt-3 flex flex-wrap gap-2">{slots.data?.length ? slots.data.map((slot) => <span key={slot.slot_hour} className="rounded-full bg-[#eaf6ee] px-3 py-1.5 text-xs font-bold text-[#1b633f]">{timeLabel(slot.slot_hour)} · {money(Number(slot.hourly_rate))}</span>) : <span className="text-sm text-[#708077]">{slots.isLoading ? 'Loading…' : slots.isError ? 'Time slots could not be loaded.' : 'No active slots'}</span>}</div></div>
          <div className="rounded-xl border border-[#e5eae5] bg-white p-4 sm:p-5"><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Payment receipt</p>{booking.receipt_path ? receipt.data ? <a href={receipt.data} target="_blank" rel="noreferrer"><img src={receipt.data} alt="Payment receipt" className="mt-3 max-h-80 rounded-lg border border-[#e5eae5] object-contain" /></a> : <p className="mt-2 text-sm text-[#708077]">{receipt.isError ? 'Receipt could not be loaded.' : 'Loading receipt…'}</p> : <p className="mt-2 text-sm text-[#708077]">No receipt uploaded.</p>}</div>
        </div>}
        {mode === 'edit' && <div className="grid gap-4 rounded-xl border border-[#e5eae5] bg-white p-4 sm:grid-cols-2 sm:p-5">{(['first_name', 'last_name', 'phone', 'email'] as const).map((key) => <label key={key} className="text-xs font-bold capitalize text-[#526058]">{key.replace('_', ' ')}<input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className={`${field} mt-1 font-normal text-[#191c1b]`} /></label>)}<label className="text-xs font-bold text-[#526058] sm:col-span-2">Admin notes<textarea rows={3} value={form.admin_notes} onChange={(event) => setForm({ ...form, admin_notes: event.target.value })} className={`${field} mt-1 font-normal text-[#191c1b]`} /></label></div>}
        {mode === 'move' && <div className="space-y-4 rounded-xl border border-[#e5eae5] bg-white p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-[#526058]">Date<input type="date" min={todayManila()} value={move.date} onChange={(event) => setMove({ ...move, date: event.target.value, hours: move.hours.filter((hour) => !isPastSlot(event.target.value, hour)) })} className={`${field} mt-1 font-normal text-[#191c1b]`} /></label><label className="text-xs font-bold text-[#526058]">Court<select value={move.court} onChange={(event) => setMove({ ...move, court: Number(event.target.value) })} className={`${field} mt-1 font-normal text-[#191c1b]`}><option value={1}>Court 1</option><option value={2}>Court 2</option></select></label></div><div><p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#526058]">Time slots · {money(pricing.data ? totalForHours(move.hours, pricing.data) : 0)}</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 24 }, (_, hour) => { const on = move.hours.includes(hour); const past = isPastSlot(move.date, hour); const rate = pricing.data ? rateForHour(hour, pricing.data) : 0; return <button key={hour} type="button" disabled={past} onClick={() => setMove({ ...move, hours: on ? move.hours.filter((value) => value !== hour) : [...move.hours, hour].sort((a, b) => a - b) })} className={`rounded-lg border px-2 py-2 text-xs font-bold ${past ? 'cursor-not-allowed border-dashed border-[#e5eae5] bg-[#f2f4f2] text-[#a0aaa4] line-through' : on ? 'border-[#103b2b] bg-[#103b2b] text-white' : 'border-[#dce3de] text-[#526058] hover:border-[#2e7d58]'}`}>{timeLabel(hour)} · {money(rate)}</button> })}</div></div></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#e5eae5] bg-white px-5 py-4 sm:px-6">
        {mode === 'view' && <>
          {booking.status === 'pending' && <><button disabled={busy} onClick={() => setConfirmation({ title: 'Confirm this booking?', description: `This will mark booking ${booking.reference_code} as confirmed.`, confirmLabel: 'Confirm booking', action: () => setStatus('confirmed', 'confirmed') })} className="rounded-lg bg-[#103b2b] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#186b48] disabled:opacity-50">Confirm</button><button disabled={busy} onClick={() => setConfirmation({ title: 'Reject this booking?', description: `Booking ${booking.reference_code} will be marked as rejected and cannot be edited afterward.`, confirmLabel: 'Reject booking', tone: 'danger', action: () => setStatus('rejected', 'rejected') })} className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-bold text-[#a42a2a] disabled:opacity-50">Reject</button></>}
          {booking.status === 'confirmed' && <button disabled={busy} onClick={() => setConfirmation({ title: 'Cancel this booking?', description: `Booking ${booking.reference_code} will be marked as cancelled.`, confirmLabel: 'Cancel booking', tone: 'danger', action: () => setStatus('cancelled', 'cancelled') })} className="rounded-lg border border-[#d0dcd4] px-5 py-2.5 text-sm font-bold text-[#526058] disabled:opacity-50">Cancel booking</button>}
          {locked ? <span className="text-xs font-semibold capitalize text-[#526058]">This booking is {booking.status} and can no longer be edited.</span> : <><button onClick={() => setMode('edit')} className="rounded-lg border border-[#d0dcd4] px-4 py-2.5 text-sm font-bold text-[#103b2b]">Edit</button><button onClick={() => setMode('move')} className="rounded-lg border border-[#d0dcd4] px-4 py-2.5 text-sm font-bold text-[#103b2b]">Reschedule</button></>}<button onClick={() => setConfirmation({ title: 'Delete this booking?', description: `This permanently deletes booking ${booking.reference_code} and its uploaded receipt. This cannot be undone.`, confirmLabel: 'Delete booking', tone: 'danger', action: remove })} className="ml-auto rounded-lg px-4 py-2.5 text-sm font-bold text-[#a42a2a] hover:bg-[#fdeeee]">Delete</button>
        </>}
        {mode === 'edit' && <><button disabled={busy} onClick={() => setConfirmation({ title: 'Save booking changes?', description: `The updated customer details and notes for ${booking.reference_code} will be saved.`, confirmLabel: 'Save changes', action: save })} className="rounded-lg bg-[#103b2b] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">Save changes</button><button onClick={() => setMode('view')} className="rounded-lg border border-[#d0dcd4] px-4 py-2.5 text-sm font-bold">Cancel</button></>}
        {mode === 'move' && <><button disabled={busy || !move.hours.length || movePast} onClick={() => movePast ? setError('Past time slots cannot be booked. Choose a future date or time.') : setConfirmation({ title: 'Reschedule this booking?', description: `Move booking ${booking.reference_code} to ${dateLabel(move.date)}, Court ${move.court}, at ${move.hours.map(timeLabel).join(', ')}?`, confirmLabel: 'Move booking', action: reschedule })} className="rounded-lg bg-[#103b2b] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">Move booking</button><button onClick={() => setMode('view')} className="rounded-lg border border-[#d0dcd4] px-4 py-2.5 text-sm font-bold">Cancel</button></>}
      </div>
    </div>
    {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} tone={confirmation.tone} onCancel={() => setConfirmation(null)} onConfirm={confirmation.action} />}
  </div>
}

function DayView({ date }: { date: string }) {
  const query = useQuery({ queryKey: ['day-view', date], queryFn: async () => { const result = await supabase.from('booking_slots').select('*').eq('booking_date', date).eq('is_active', true); if (result.error) throw result.error; return result.data } })
  return <div className="rounded-2xl bg-white p-4 shadow-soft sm:p-5"><h2 className="text-lg font-black sm:text-xl">{dateLabel(date)}</h2><div className="mt-4 grid grid-cols-2 gap-3">{[1, 2].map((court) => <div key={court}><h3 className="mb-2 font-bold text-forest">Court {court}</h3>{Array.from({ length: 24 }, (_, hour) => { const occupied = query.data?.some((slot) => slot.court_id === court && slot.slot_hour === hour); return <div key={hour} className={`mb-1 rounded px-2 py-2 text-xs ${occupied ? 'bg-forest text-white' : 'bg-slate-100 text-slate-500'}`}>{timeLabel(hour)} · {occupied ? 'Booked' : 'Open'}</div> })}</div>)}</div></div>
}

function SettingsPanel({ onSaved, onUploaded }: { onSaved: () => void; onUploaded: () => void }) {
  const query = useQuery({ queryKey: ['admin-settings'], queryFn: async () => { const result = await supabase.from('settings').select('*').eq('id', 1).single(); if (result.error) throw result.error; return result.data as Settings } })
  const notifications = useQuery({ queryKey: ['admin-notification-settings'], queryFn: async () => { const result = await supabase.from('notification_settings').select('*').eq('id', 1).single(); if (result.error) throw result.error; return result.data } })
  const [form, setForm] = useState<Partial<Settings>>({})
  const [ownerEmail, setOwnerEmail] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  useEffect(() => { if (query.data) setForm(query.data) }, [query.data])
  useEffect(() => { if (notifications.data) setOwnerEmail(notifications.data.owner_notification_email ?? '') }, [notifications.data])
  if (query.isLoading || notifications.isLoading) return <div className="rounded-xl border border-[#e5eae5] bg-white p-6 text-sm text-[#526058]">Loading settings…</div>
  if (query.isError || notifications.isError) return <p role="alert" className="max-w-2xl rounded-lg border border-red-200 bg-[#fdeeee] p-4 text-sm text-[#a42a2a]">Settings could not be loaded: {query.error?.message ?? notifications.error?.message}</p>
  const save = async (confirmed = false) => {
    const email = ownerEmail.trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter a valid owner notification email address.'); return }
    if (!Number.isFinite(Number(form.day_hourly_rate)) || Number(form.day_hourly_rate) <= 0 || !Number.isFinite(Number(form.night_hourly_rate)) || Number(form.night_hourly_rate) <= 0 || !Number.isFinite(Number(form.hold_minutes)) || Number(form.hold_minutes) <= 0) { setError('Both hourly rates and the hold duration must be positive numbers.'); return }
    if (!confirmed) { setConfirmOpen(true); return }
    setSaving(true); setError('')
    const dayRate = Number(form.day_hourly_rate)
    const nightRate = Number(form.night_hourly_rate)
    const result = await supabase.from('settings').update({ hourly_rate: (dayRate + nightRate) / 2, day_hourly_rate: dayRate, night_hourly_rate: nightRate, open_hour: 0, close_hour: 24, hold_minutes: Number(form.hold_minutes), gcash_account_name: form.gcash_account_name, gcash_number: form.gcash_number, gcash_qr_path: form.gcash_qr_path }).eq('id', 1)
    if (result.error) { setSaving(false); setError(friendlyError(result.error)); return }
    const recipient = await supabase.from('notification_settings').update({ owner_notification_email: email || null }).eq('id', 1)
    setSaving(false)
    if (recipient.error) setError(`Business settings were saved, but the owner email was not updated: ${friendlyError(recipient.error)}`)
    else onSaved()
  }
  const upload = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('QR must be a JPEG, PNG, or WEBP image up to 2MB.'); return }
    setUploading(true); setError('')
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp'
    const path = `gcash-qr-${Date.now()}.${extension}`
    const result = await supabase.storage.from('assets').upload(path, file, { upsert: true, contentType: file.type })
    setUploading(false)
    if (result.error) setError(friendlyError(result.error))
    else { setForm((old) => ({ ...old, gcash_qr_path: path })); onUploaded() }
  }
  return <div className="max-w-3xl overflow-hidden rounded-2xl border border-[#e5eae5] bg-white shadow-[0_2px_8px_rgba(16,59,43,0.04)]">
    <div className="border-b border-[#e5eae5] px-5 py-5 sm:px-6"><h2 className="text-xl font-bold text-[#103b2b]">Business settings</h2><p className="mt-1 text-sm text-[#526058]">Update court pricing, reservation holds, and payment details.</p></div>
    <div className="space-y-5 p-5 sm:p-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {([['gcash_account_name', 'GCash account name', 'text'], ['gcash_number', 'GCash number', 'tel'], ['day_hourly_rate', 'Day rate · slots starting 5:00 AM–4:00 PM (₱)', 'number'], ['night_hourly_rate', 'Night rate · slots starting 5:00 PM–4:00 AM (₱)', 'number'], ['hold_minutes', 'Reservation hold (minutes)', 'number']] as const).map(([key, label, type]) => <label key={key} className="text-xs font-bold text-[#526058]">{label}<input type={type} min={type === 'number' ? 1 : undefined} step={type === 'number' ? 1 : undefined} value={String(form[key] ?? '')} onChange={(event) => setForm((old) => ({ ...old, [key]: type === 'number' ? Number(event.target.value) : event.target.value }))} className={`${field} mt-1`} /></label>)}
      </div>
      <div className="rounded-xl border border-[#e5eae5] bg-[#f8faf8] p-4">
        <label className="block text-xs font-bold text-[#526058]">Owner notification email<input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} placeholder="owner@example.com" className={`${field} mt-1`} /></label>
        <p className="mt-2 text-xs text-[#708077]">New customer bookings will be sent to this address. Leave blank to pause owner notification emails.</p>
      </div>
      <div className="rounded-xl border border-[#e5eae5] bg-[#f8faf8] p-4">
        <label className="block text-xs font-bold text-[#526058]">GCash QR image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#eaf6ee] file:px-3 file:py-2 file:font-semibold file:text-[#1b633f]" /></label>
        <p className="mt-2 text-xs text-[#708077]">{uploading ? 'Uploading QR image…' : form.gcash_qr_path ? `Current QR: ${form.gcash_qr_path}` : 'No QR image uploaded.'} Maximum image size: 2MB.</p>
      </div>
      <div className="flex justify-end"><button onClick={() => void save()} disabled={saving || uploading} className="rounded-lg bg-[#103b2b] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#186b48] disabled:opacity-50">{saving ? 'Saving…' : 'Save settings'}</button></div>
    </div>
    {confirmOpen && <ConfirmDialog title="Save these settings?" description="Your pricing, reservation hold duration, payment details, and owner notification email will be updated." confirmLabel="Save settings" onCancel={() => setConfirmOpen(false)} onConfirm={() => save(true)} />}
  </div>
}
