import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Clock3, MapPin, RotateCcw } from 'lucide-react'
import { BookingSummary } from '../components/BookingSummary'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StepIndicator } from '../components/StepIndicator'
import { Toast } from '../components/Toast'
import { friendlyError } from '../lib/errors'
import { dateLabel, isPastSlot, money, rateForHour, timeLabel, todayManila, totalForHours } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import type { HoldResult } from '../lib/database.types'

const detailsSchema = z.object({ firstName: z.string().trim().min(1, 'First name is required'), lastName: z.string().trim().min(1, 'Last name is required'), phone: z.string().regex(/^(09|\+639)[0-9]{9}$/, 'Use 09XXXXXXXXX or +639XXXXXXXXX'), email: z.string().email('Enter a valid email') })
type Details = z.infer<typeof detailsSchema>
const hours = Array.from({ length: 24 }, (_, index) => index)
const toDate = (value: string) => new Date(`${value}T12:00:00+08:00`)
const monthTitle = (month: Date) => month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
const dayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(value)

function Calendar({ date, onChange }: { date: Date; onChange: (date: Date) => void }) {
  const [month, setMonth] = useState(new Date(date.getFullYear(), date.getMonth(), 1))
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = (first.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((start + days) / 7) * 7 }, (_, index) => {
    const day = index - start + 1
    return day > 0 && day <= days ? new Date(month.getFullYear(), month.getMonth(), day) : null
  })
  const today = todayManila()
  return <div className="custom-calendar"><div className="mb-5 flex items-center justify-between"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="calendar-nav" aria-label="Previous month">‹</button><h3 className="text-xl font-black text-forest">{monthTitle(month)}</h3><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="calendar-nav" aria-label="Next month">›</button></div><div className="grid grid-cols-7 gap-1 text-center text-xs font-bold uppercase tracking-wider text-slate-400">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => <span key={label} className="py-2">{label}</span>)}{cells.map((cell, index) => { const value = cell ? dayKey(cell) : ''; const disabled = !cell || value < today; const selected = value === dayKey(date); return <button type="button" key={`${value}-${index}`} disabled={disabled} onClick={() => cell && onChange(cell)} className={`calendar-day ${selected ? 'calendar-day-selected' : ''} ${disabled ? 'calendar-day-disabled' : ''}`}>{cell?.getDate() ?? ''}</button> })}</div></div>
}

export function BookingPage() {
  const navigate = useNavigate()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [date, setDate] = useState(toDate(todayManila()))
  const dateValue = dayKey(date)
  const [court, setCourt] = useState(1); const [selected, setSelected] = useState<number[]>([]); const [step, setStep] = useState(1); const [hold, setHold] = useState<HoldResult | null>(null); const [error, setError] = useState(''); const [receipt, setReceipt] = useState<File | null>(null); const [remaining, setRemaining] = useState(0)
  const [paymentConfirmationOpen, setPaymentConfirmationOpen] = useState(false); const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false); const [submitting, setSubmitting] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<Details>({ resolver: zodResolver(detailsSchema) })
  const availability = useQuery({ queryKey: ['availability', dateValue], queryFn: async () => { const result = await supabase.rpc('get_availability', { p_date: dateValue }); if (result.error) throw result.error; return result.data }, refetchInterval: 15000 })
  const availabilityUnavailable = availability.isLoading || availability.isError
  const blocked = useMemo(() => new Map((availability.data ?? []).filter((slot) => slot.court_id === court).map((slot) => [slot.slot_hour, slot.status])), [availability.data, court])
  const isPast = (hour: number) => isPastSlot(dateValue, hour)
  const total = settings ? totalForHours(selected, settings) : 0
  useEffect(() => { if (!hold) return; const tick = () => setRemaining(Math.max(0, new Date(hold.hold_expires_at).getTime() - Date.now())); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer) }, [hold])
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') void availability.refetch() }; document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh); return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) } }, [availability])
  const toggleHour = (hour: number) => { if (availabilityUnavailable || blocked.has(hour) || isPast(hour)) return; setSelected((current) => current.includes(hour) ? current.filter((value) => value !== hour) : [...current, hour].sort((a, b) => a - b)) }
  const startOver = () => { setSelected([]); setHold(null); setReceipt(null); setStep(1); setError('') }
  const continueToDetails = async () => {
    if (availabilityUnavailable) { setError('Availability is not ready. Refresh the available times before continuing.'); void availability.refetch(); return }
    if (!selected.length) { setError('Choose at least one time slot.'); return }
    const result = await supabase.rpc('hold_slots', { p_court_id: court, p_date: dateValue, p_hours: selected })
    if (result.error) {
      console.error('Booking slot hold failed', { code: result.error.code, message: result.error.message })
      const message = friendlyError(result.error)
      setError(message === 'Something went wrong. Please try again.' && result.error.code
        ? `We couldn't reserve those times (service code ${result.error.code}). Refresh and try again; if it continues, share this code with the court.`
        : message)
      const refreshed = await availability.refetch()
      if (refreshed.data) {
        const unavailable = new Set(refreshed.data.filter((slot) => slot.court_id === court).map((slot) => slot.slot_hour))
        setSelected((current) => current.filter((hour) => !unavailable.has(hour)))
      }
      return
    }
    setHold(result.data)
    setStep(3)
  }
  const saveDetails = (details: Details) => { sessionStorage.setItem('pickleball-details', JSON.stringify(details)); setStep(4) }
  const submit = async (details: Details) => {
    if (!hold || remaining === 0) { setError('Your time hold has expired. Choose new times to continue.'); return }
    if (!receipt) { setError('Upload your GCash payment screenshot to continue.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type) || receipt.size > 5 * 1024 * 1024) { setError('Receipt must be a JPG, PNG, or WEBP image up to 5MB.'); return }
    setSubmitting(true); setError('')
    const current = await supabase.rpc('get_my_booking', { p_booking_id: hold.booking_id, p_access_token: hold.access_token })
    if (current.error) { setError(friendlyError(current.error)); setSubmitting(false); return }
    if (current.data.status !== 'held') {
      if (current.data.status === 'expired' && current.data.hold_expires_at) {
        setError('Your time hold has expired. Choose new times to continue.')
      } else {
        sessionStorage.setItem('pickleball-booking', JSON.stringify({ bookingId: current.data.booking_id, accessToken: hold.access_token }))
        navigate(`/booking/${current.data.booking_id}/${hold.access_token}`)
      }
      setSubmitting(false)
      return
    }
    const receiptPath = `${hold.booking_id}/${crypto.randomUUID()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g, '')}`
    const upload = await supabase.storage.from('receipts').upload(receiptPath, receipt, { contentType: receipt.type, upsert: false })
    if (upload.error) { setError(friendlyError(upload.error)); setSubmitting(false); return }
    const saved = sessionStorage.getItem('pickleball-details')
    const customer = saved ? JSON.parse(saved) as Details : details
    const result = await supabase.rpc('submit_payment', { p_booking_id: hold.booking_id, p_access_token: hold.access_token, p_first_name: customer.firstName, p_last_name: customer.lastName, p_phone: customer.phone, p_email: customer.email, p_receipt_path: receiptPath })
    if (result.error) {
      const cleanup = await supabase.storage.from('receipts').remove([receiptPath])
      setError(cleanup.error ? `${friendlyError(result.error)} The uploaded receipt could not be removed: ${friendlyError(cleanup.error)}` : friendlyError(result.error))
      setSubmitting(false)
      return
    }
    sessionStorage.setItem('pickleball-booking', JSON.stringify({ bookingId: result.data.booking_id, accessToken: result.data.access_token }))
    navigate(`/booking/${result.data.booking_id}/${result.data.access_token}`)
  }
  const requestPaymentSubmission = () => {
    if (!hold || remaining === 0) { setError('Your time hold has expired. Choose new times to continue.'); return }
    if (!receipt) { setError('Upload your GCash payment screenshot to continue.'); return }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type) || receipt.size > 5 * 1024 * 1024) { setError('Receipt must be a JPG, PNG, or WEBP image up to 5MB.'); return }
    setError('')
    setPaymentConfirmationOpen(true)
  }
  const cancel = async () => { if (hold) { const result = await supabase.rpc('cancel_hold', { p_booking_id: hold.booking_id, p_access_token: hold.access_token }); if (result.error) { setError(friendlyError(result.error)); return } }; startOver() }
  if (settingsLoading) return <div className="py-20 text-center text-slate-500">Loading court settings…</div>
  if (!settings) return <div className="p-8 text-center">Settings are unavailable. Please try again later.</div>
  if (hold && remaining === 0) return <div className="min-h-[60vh] bg-[#f8faf8] px-4 py-10 sm:grid sm:place-items-center sm:px-6 sm:py-16"><div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#e5eae5] bg-white shadow-[0_12px_32px_rgba(16,59,43,0.08)]"><div className="bg-[#103b2b] px-6 py-7 text-white sm:px-8"><span className="inline-flex items-center gap-2 rounded-full bg-[#fff3d9] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#855b12]"><Clock3 className="h-4 w-4" aria-hidden />Hold expired</span><h1 className="mt-4 text-2xl font-black sm:text-3xl">Your reserved time has run out</h1><p className="mt-2 max-w-lg text-sm leading-relaxed text-white/75">Temporary holds are released automatically when the timer ends. Your payment was not submitted, and these slots may now be available to another player.</p></div><div className="space-y-5 p-6 sm:p-8"><div className="grid gap-4 rounded-xl border border-[#e5eae5] bg-[#f8faf8] p-4 sm:grid-cols-2"><div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-[#2e7d58]" aria-hidden /><div><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Date</p><p className="text-sm font-semibold text-[#103b2b]">{dateLabel(dateValue)}</p></div></div><div className="flex items-center gap-3"><MapPin className="h-5 w-5 text-[#2e7d58]" aria-hidden /><div><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Court</p><p className="text-sm font-semibold text-[#103b2b]">Court {court}</p></div></div></div><p className="text-sm leading-relaxed text-[#526058]">Start again to check current availability and place a new hold. No charge was made through this booking form.</p><button onClick={() => { startOver(); void availability.refetch() }} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#103b2b] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#186b48]"><RotateCcw className="h-4 w-4" aria-hidden />Choose new times</button></div></div></div>
  return <div className="bg-[#f8faf8]">
    <section className="hero-full relative min-h-[465px] overflow-hidden bg-forest"><img src="/assets/basakan-pickle-hero.png" alt="Players enjoying a pickleball game at Basakan Pickle" className="absolute inset-0 h-full w-full object-cover object-center" /><div className="absolute inset-0 bg-gradient-to-r from-[#0b3026]/95 via-[#0b3026]/60 to-transparent" /><div className="relative flex min-h-[420px] flex-col justify-end px-7 pb-10 text-white sm:px-12 sm:pb-14"><p className="text-sm font-black uppercase tracking-[0.3em] text-lime">Find your rally</p><h1 className="mt-3 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">Play more.<br /><span className="text-lime">Rally longer.</span></h1><p className="mt-5 max-w-sm text-base leading-relaxed text-white/80 sm:text-lg">Good games, great people, and one more point you will always want to play.</p><button type="button" onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })} className="mt-7 w-fit rounded-full bg-lime px-6 py-3 text-sm font-black text-ink">Book a court</button></div></section>
    <section id="booking" className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-12">
      <div className="mb-7"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#2e7d58]">Book a court</p><h2 className="mt-2 text-3xl font-bold tracking-tight text-[#0f1e17] sm:text-4xl">Your next rally starts here.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#526058]">Choose your court and time, then submit your booking details and payment screenshot.</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,1fr)]">
        <div className="rounded-2xl border border-[#e5eae5] bg-white p-5 shadow-[0_2px_8px_rgba(16,59,43,0.04)] sm:p-7"><Calendar date={date} onChange={(value) => { setDate(value); setSelected([]) }} /><div className="mt-6 rounded-xl border border-[#e5eae5] bg-[#f8faf8] p-4"><p className="text-[11px] font-bold uppercase tracking-wider text-[#708077]">Selected date</p><p className="mt-1 font-bold text-[#103b2b]">{dateLabel(dateValue)}</p></div></div>
        <div className="overflow-hidden rounded-2xl border border-[#e5eae5] bg-white shadow-[0_2px_8px_rgba(16,59,43,0.04)]"><div className="p-5 sm:p-7"><StepIndicator step={step} />
          {step === 1 && <div><h2 className="text-xl font-bold text-[#103b2b]">Choose a court</h2><p className="mt-1 text-sm text-[#526058]">Pick where you want to play.</p><div className="mt-5 space-y-3">{[1, 2].map((value) => <button key={value} onClick={() => { setCourt(value); setSelected([]) }} className={`w-full rounded-xl border p-4 text-left transition ${court === value ? 'border-[#103b2b] bg-[#103b2b] text-white' : 'border-[#dce3de] bg-white text-[#103b2b] hover:border-[#2e7d58] hover:bg-[#f8faf8]'}`}><span className="font-bold">Court {value}</span><span className="mt-1 block text-xs opacity-75">Outdoor pickleball court</span></button>)}</div><button onClick={() => setStep(2)} className="mt-5 w-full rounded-lg bg-[#103b2b] px-5 py-3 font-bold text-white transition hover:bg-[#186b48]">Choose time slots</button></div>}
          {step === 2 && <div><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold text-[#103b2b]">{dateLabel(dateValue)}</h2><p className="text-sm text-[#526058]">Court {court} · select multiple</p></div><button onClick={() => setStep(1)} className="rounded-md px-3 py-2 text-sm font-bold text-[#186b48] hover:bg-[#eaf6ee]">Change</button></div>{availability.isError && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">Availability could not be checked. Time slots are disabled until it loads successfully.<button onClick={() => void availability.refetch()} className="ml-2 font-bold underline">Retry</button></div>}{availability.isLoading && <p className="mb-3 text-sm text-[#708077]">Checking current availability…</p>}<div className="max-h-80 overflow-y-auto pr-1"><div className="grid grid-cols-2 gap-2">{hours.map((hour) => { const status = blocked.get(hour); const unavailable = availabilityUnavailable || Boolean(status) || isPast(hour); const picked = selected.includes(hour); const rate = rateForHour(hour, settings); return <button key={hour} disabled={unavailable} onClick={() => toggleHour(hour)} aria-label={`${timeLabel(hour)}, ${money(rate)} per hour, ${availabilityUnavailable ? 'availability loading' : status === 'held' ? 'reserved' : status === 'booked' ? 'booked' : isPast(hour) ? 'passed' : 'available'}`} className={`rounded-lg border p-3 text-left transition ${unavailable ? 'cursor-not-allowed border-dashed border-[#e5eae5] bg-[#f2f4f2] text-[#8a9890]' : picked ? 'border-[#103b2b] bg-[#103b2b] text-white' : 'border-[#dce3de] bg-white text-[#103b2b] hover:border-[#2e7d58] hover:bg-[#f8faf8]'}`}><strong className={unavailable ? 'line-through' : ''}>{timeLabel(hour)}</strong><span className="mt-0.5 block text-xs">{availabilityUnavailable ? 'Checking' : status === 'held' ? 'Reserved' : status === 'booked' ? 'Booked' : isPast(hour) ? 'Passed' : picked ? 'Selected' : 'Available'} · {money(rate)}/hr</span></button> })}</div></div><div className="mt-4 rounded-xl bg-[#103b2b] p-4 text-white"><div className="flex justify-between text-sm"><span>{selected.length} hour{selected.length === 1 ? '' : 's'}</span><strong>{money(total)}</strong></div><button disabled={availabilityUnavailable || !selected.length} onClick={() => void continueToDetails()} className="mt-3 w-full rounded-lg bg-[#a1f1c3] px-4 py-3 font-bold text-[#002418] transition hover:bg-[#88d7ab] disabled:cursor-not-allowed disabled:opacity-50">Continue</button></div></div>}
          {step === 3 && hold && <div><div className="mb-5 rounded-lg border border-[#d8ebdf] bg-[#eaf6ee] p-4 text-sm font-semibold text-[#1b633f]">Your selected slots are held for {Math.floor(remaining / 60000)}:{String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}</div><form onSubmit={handleSubmit(saveDetails)} className="space-y-4"><div><h2 className="text-xl font-bold text-[#103b2b]">Your details</h2><p className="mt-1 text-sm text-[#526058]">We’ll use these details to send booking updates.</p></div>{[['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Mobile number'], ['email', 'Email address']].map(([name, label]) => <label key={name} className="block text-xs font-bold text-[#526058]">{label}<input {...register(name as keyof Details)} className="mt-1 w-full rounded-lg border border-[#dce3de] px-3 py-3 text-sm font-normal text-[#191c1b] outline-none focus:border-[#2e7d58] focus:ring-2 focus:ring-[#2e7d58]/15" />{errors[name as keyof Details] && <span className="mt-1 block text-xs font-medium text-red-700">{errors[name as keyof Details]?.message}</span>}</label>)}<div className="flex gap-3 pt-1"><button type="button" onClick={() => setCancelConfirmationOpen(true)} className="flex-1 rounded-lg border border-[#d0dcd4] px-4 py-3 text-sm font-bold text-[#103b2b] hover:bg-[#f8faf8]">Back</button><button className="flex-1 rounded-lg bg-[#103b2b] px-4 py-3 text-sm font-bold text-white hover:bg-[#186b48]">Continue</button></div></form></div>}
          {step === 4 && hold && <div><BookingSummary date={dateValue} court={`Court ${court}`} hours={selected} rate={hold.hourly_rate} rates={hold.slot_rates} total={hold.total_amount} /><div className="mt-6"><h2 className="text-xl font-bold text-[#103b2b]">Pay with GCash</h2><p className="mt-1 text-sm text-[#526058]">Scan the QR code and send the exact amount.</p><img className="mx-auto my-4 h-52 w-52 rounded-xl border border-[#e5eae5] bg-white object-contain p-2" src={settings.gcash_qr_path ? supabase.storage.from('assets').getPublicUrl(settings.gcash_qr_path).data.publicUrl : '/assets/GCASH-QR.jpg'} alt="Scan this GCash QR code to pay" /><p className="text-center text-sm text-[#526058]">Send exactly <strong className="text-lg text-[#103b2b]">{money(hold.total_amount)}</strong><br />to {settings.gcash_account_name || 'GCash account'} · {settings.gcash_number || 'number not set'}</p><label className="mt-5 block text-xs font-bold text-[#526058]">Payment screenshot <span className="font-normal text-[#708077]">(required)</span><input type="file" required accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} className="mt-2 block w-full rounded-lg border border-[#dce3de] bg-[#f8faf8] p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#eaf6ee] file:px-3 file:py-2 file:font-semibold file:text-[#1b633f]" /></label></div><div className="mt-5 flex gap-3"><button onClick={() => setStep(3)} className="flex-1 rounded-lg border border-[#d0dcd4] px-4 py-3 text-sm font-bold text-[#103b2b] hover:bg-[#f8faf8]">Back</button><button type="button" onClick={requestPaymentSubmission} disabled={!receipt || submitting} className="flex-1 rounded-lg bg-[#103b2b] px-4 py-3 text-sm font-bold text-white hover:bg-[#186b48] disabled:opacity-50">{submitting ? 'Submitting…' : "I've Paid"}</button></div></div>}
        </div></div>
      </div>
    </section>
    {error && <Toast message={error} onClose={() => setError('')} />}
    {paymentConfirmationOpen && hold && <ConfirmDialog title="Submit this payment for review?" description="Please confirm the booking details and payment amount before sending your receipt. The owner will review the payment and update the booking status." confirmLabel="Submit payment" details={<div className="rounded-lg border border-[#e5eae5] bg-white p-4 text-sm"><div className="flex justify-between gap-3 text-[#526058]"><span>Date · Court</span><strong className="text-[#103b2b]">{dateLabel(dateValue)} · {court}</strong></div><div className="mt-2 flex justify-between gap-3 text-[#526058]"><span>Time slots</span><strong className="text-right text-[#103b2b]">{selected.map(timeLabel).join(', ')}</strong></div><div className="mt-3 flex justify-between border-t border-[#e5eae5] pt-3 text-[#103b2b]"><span className="font-bold">Total</span><strong>{money(hold.total_amount)}</strong></div><p className="mt-2 text-xs text-[#708077]">Payment receipt: {receipt?.name}</p></div>} onCancel={() => setPaymentConfirmationOpen(false)} onConfirm={() => submit({ firstName: '', lastName: '', phone: '', email: '' })} />}
    {cancelConfirmationOpen && <ConfirmDialog title="Release this time hold?" description="Going back will release your temporarily held court slots. You will need to choose available times again." confirmLabel="Release hold" tone="danger" onCancel={() => setCancelConfirmationOpen(false)} onConfirm={cancel} />}
  </div>
}
