import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { CalendarDays, Check, CheckCircle2, Clock, Copy, Hourglass, Mail, MapPin, Phone, Printer, User, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { dateLabel, money, timeLabel } from '../lib/format'

type MyBooking = {
  booking_id: string; status: string; booking_date: string; court_name: string; hours: number[]; hourly_rate: number; total_amount: number
  first_name: string | null; last_name: string | null; reference_code?: string | null; email?: string | null; phone?: string | null; submitted_at?: string | null
}

const statusInfo: Record<string, { title: string; text: string; icon: typeof Clock; tone: string }> = {
  pending: { title: 'Payment submitted', text: 'We received your payment screenshot. The owner will review it and email you once your booking is confirmed.', icon: Hourglass, tone: 'bg-[#fef6e7] text-[#966004]' },
  confirmed: { title: 'Booking confirmed', text: 'Your court is reserved. See you on the court!', icon: CheckCircle2, tone: 'bg-[#eaf6ee] text-[#1b633f]' },
  rejected: { title: 'Booking rejected', text: 'Unfortunately this booking was not approved. Please contact us or book another slot.', icon: XCircle, tone: 'bg-[#fdeeee] text-[#a42a2a]' },
  cancelled: { title: 'Booking cancelled', text: 'This booking has been cancelled.', icon: XCircle, tone: 'bg-[#eff3f1] text-[#57665f]' },
  held: { title: 'Awaiting payment', text: 'Your slots are held while payment is completed.', icon: Clock, tone: 'bg-[#eaf6ee] text-[#1b633f]' },
  expired: { title: 'Hold expired', text: 'This reservation expired before payment was submitted.', icon: XCircle, tone: 'bg-[#eff3f1] text-[#57665f]' },
}

const Row = ({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) => <div className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#2e7d58]" aria-hidden /><div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">{label}</dt><dd className="break-words text-sm font-semibold text-[#191c1b]">{value}</dd></div></div>

export function ConfirmationPage() {
  const params = useParams()
  const saved = params.bookingId && params.token ? null : sessionStorage.getItem('pickleball-booking')
  const stored = saved ? JSON.parse(saved) as { bookingId: string; accessToken: string } : null
  const bookingId = params.bookingId ?? stored?.bookingId
  const accessToken = params.token ?? stored?.accessToken
  const [copied, setCopied] = useState(false)
  const booking = useQuery({
    queryKey: ['my-booking', bookingId, accessToken], enabled: Boolean(bookingId && accessToken), retry: false,
    refetchInterval: (query) => query.state.status === 'error' ? false : 30000,
    queryFn: async () => { const result = await supabase.rpc('get_my_booking', { p_booking_id: bookingId!, p_access_token: accessToken! }); if (result.error) { console.error('Booking summary lookup failed', { code: result.error.code, message: result.error.message }); throw result.error }; return result.data as MyBooking },
  })
  if (!bookingId || !accessToken) return <Navigate to="/" replace />
  if (!params.bookingId) return <Navigate to={`/booking/${bookingId}/${accessToken}`} replace />
  if (booking.isLoading) return <div className="py-20 text-center">Loading booking…</div>
  if (booking.isError) return <div className="mx-auto max-w-lg px-4 py-16"><div className="rounded-xl border border-red-200 bg-white p-6 text-center"><h1 className="text-xl font-bold text-[#a42a2a]">We couldn’t load this booking</h1><p className="mt-2 text-sm text-[#526058]">{friendlyError(booking.error)} If the problem continues, use the original booking link or contact the court.</p><button onClick={() => void booking.refetch()} className="mt-5 rounded-lg bg-[#103b2b] px-5 py-2.5 text-sm font-bold text-white">Try again</button></div></div>
  if (!booking.data) return <div className="mx-auto max-w-lg px-4 py-16"><div className="rounded-xl border border-[#e5eae5] bg-white p-6 text-center"><h1 className="text-xl font-bold text-[#103b2b]">Booking not found</h1><p className="mt-2 text-sm text-[#526058]">This link may be incomplete or the booking may have expired. Check the full link from your booking confirmation.</p></div></div>

  const data = booking.data
  const info = statusInfo[data.status] ?? statusInfo.pending
  const StatusIcon = info.icon
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
  const hours = data.hours ?? []
  const copyLink = async () => { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
    <div className="rounded-2xl bg-[#103b2b] p-6 text-white sm:p-8">
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${info.tone}`}><StatusIcon className="h-4 w-4" aria-hidden />{data.status}</span>
      <h1 className="mt-4 text-3xl font-black">{info.title}</h1>
      <p className="mt-2 text-white/80">{info.text}</p>
      {data.reference_code && <p className="mt-4 text-sm text-white/70">Booking reference <strong className="ml-1 font-mono text-lg tracking-wider text-[#a1f1c3]">{data.reference_code}</strong></p>}
    </div>

    <div className="rounded-xl border border-[#e5eae5] bg-white p-5 shadow-[0_2px_8px_rgba(16,59,43,0.04)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#e5eae5] pb-4"><div><p className="text-xs font-bold uppercase tracking-wider text-[#2e7d58]">Booking details</p><h2 className="mt-1 text-lg font-bold text-[#103b2b]">Present this summary on your booking day</h2></div><span className="rounded-full bg-[#eff3f1] px-3 py-1 text-xs font-bold capitalize text-[#57665f]">{data.status}</span></div>
      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Row icon={CalendarDays} label="Date" value={dateLabel(data.booking_date)} />
        <Row icon={MapPin} label="Court" value={data.court_name} />
        {name && <Row icon={User} label="Name" value={name} />}
        {data.phone && <Row icon={Phone} label="Mobile" value={data.phone} />}
        {data.email && <Row icon={Mail} label="Email" value={data.email} />}
        {data.submitted_at && <Row icon={Clock} label="Submitted" value={new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(data.submitted_at))} />}
      </dl>
      <div className="mt-6 rounded-lg bg-[#f8faf8] p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Reserved time</p><div className="mt-2 flex flex-wrap gap-2">{hours.length ? hours.map((hour) => <span key={hour} className="rounded-full bg-[#eaf6ee] px-3 py-1.5 text-xs font-bold text-[#1b633f]">{timeLabel(hour)} – {timeLabel(hour + 1)}</span>) : <span className="text-sm text-[#708077]">No time slots found for this booking.</span>}</div></div>
      <div className="mt-5 space-y-2 border-t border-[#e5eae5] pt-4 text-sm">
        <div className="flex justify-between text-[#526058]"><span>{hours.length} hour{hours.length === 1 ? '' : 's'} × {money(data.hourly_rate)}</span><strong className="text-[#191c1b]">{money(data.total_amount)}</strong></div>
        <div className="flex justify-between text-lg font-bold text-[#103b2b]"><span>TOTAL</span><span>{money(data.total_amount)}</span></div>
      </div>
    </div>

    <div className="rounded-xl border border-[#dce3de] bg-[#f2f4f2] p-5 text-sm print:hidden">
      <p className="font-bold text-[#103b2b]">Keep this confirmation</p>
      <p className="mt-1 text-[#526058]">Bookmark this private link or print this summary to show the court staff on your booking day.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-lg bg-[#103b2b] px-4 py-2.5 font-bold text-white hover:bg-[#186b48]">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy booking link'}</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-[#d0dcd4] bg-white px-4 py-2.5 font-bold text-[#103b2b]"><Printer className="h-4 w-4" />Print summary</button>
      </div>
    </div>
  </div>
}
