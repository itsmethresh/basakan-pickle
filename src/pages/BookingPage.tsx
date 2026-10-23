import { useEffect, useMemo, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { BookingSummary } from '../components/BookingSummary'
import { StepIndicator } from '../components/StepIndicator'
import { Toast } from '../components/Toast'
import { friendlyError } from '../lib/errors'
import { dateLabel, money, timeLabel, todayManila } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useSettings } from '../hooks/useSettings'
import type { HoldResult } from '../lib/database.types'
import 'react-day-picker/style.css'

const detailsSchema = z.object({ firstName: z.string().trim().min(1, 'First name is required'), lastName: z.string().trim().min(1, 'Last name is required'), phone: z.string().regex(/^(09|\+639)[0-9]{9}$/, 'Use 09XXXXXXXXX or +639XXXXXXXXX'), email: z.string().email('Enter a valid email') })
type Details = z.infer<typeof detailsSchema>
const hours = Array.from({ length: 19 }, (_, index) => index + 5)
const toDate = (value: string) => new Date(`${value}T12:00:00+08:00`)

export function BookingPage() {
  const navigate = useNavigate()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [date, setDate] = useState<Date>(toDate(todayManila()))
  const dateValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(date)
  const [court, setCourt] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [step, setStep] = useState(1)
  const [hold, setHold] = useState<HoldResult | null>(null)
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [remaining, setRemaining] = useState(0)
  const { register, handleSubmit, formState: { errors } } = useForm<Details>({ resolver: zodResolver(detailsSchema) })
  const availability = useQuery({
    queryKey: ['availability', dateValue],
    queryFn: async () => { const result = await supabase.rpc('get_availability', { p_date: dateValue }); if (result.error) throw result.error; return result.data },
    refetchInterval: 5000
  })
  const blocked = useMemo(() => new Map((availability.data ?? []).filter((slot) => slot.court_id === court).map((slot) => [slot.slot_hour, slot.status])), [availability.data, court])
  const isPast = (hour: number) => dateValue === todayManila() && hour <= Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()))
  const total = (settings?.hourly_rate ?? 0) * selected.length

  useEffect(() => { if (!hold) return; const tick = () => setRemaining(Math.max(0, new Date(hold.hold_expires_at).getTime() - Date.now())); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer) }, [hold])
  useEffect(() => { if (remaining === 0 && hold) setError('Your hold expired. Start over to choose new slots.') }, [remaining, hold])

  const toggleHour = (hour: number) => { if (blocked.has(hour) || isPast(hour)) return; setSelected((current) => current.includes(hour) ? current.filter((value) => value !== hour) : [...current, hour].sort((a, b) => a - b)) }
  const startOver = () => { setSelected([]); setHold(null); setReference(''); setReceipt(null); setStep(1); setError('') }
  const continueToDetails = async () => {
    if (!selected.length) { setError('Choose at least one time slot.'); return }
    const result = await supabase.rpc('hold_slots', { p_court_id: court, p_date: dateValue, p_hours: selected })
    if (result.error) { setError(friendlyError(result.error)); setSelected([]); void availability.refetch(); return }
    setHold(result.data); setStep(3)
  }
  const saveDetails = (details: Details) => { sessionStorage.setItem('pickleball-details', JSON.stringify(details)); setStep(4) }
  const submit = async (details: Details) => {
    if (!hold || remaining === 0) return
    let receiptPath: string | null = null
    if (receipt) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(receipt.type) || receipt.size > 5 * 1024 * 1024) { setError('Receipt must be a JPG, PNG, or WEBP image up to 5MB.'); return }
      receiptPath = `${hold.booking_id}/${crypto.randomUUID()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g, '')}`
      const upload = await supabase.storage.from('receipts').upload(receiptPath, receipt, { contentType: receipt.type, upsert: false })
      if (upload.error) { setError(upload.error.message); return }
    }
    const savedDetails = sessionStorage.getItem('pickleball-details')
    const customer = savedDetails ? JSON.parse(savedDetails) as Details : details
    if (!receiptPath) { setError('Upload your GCash payment screenshot to continue.'); return }
    const result = await supabase.rpc('submit_payment', { p_booking_id: hold.booking_id, p_access_token: hold.access_token, p_first_name: customer.firstName, p_last_name: customer.lastName, p_phone: customer.phone, p_email: customer.email, p_receipt_path: receiptPath })
    if (result.error) { setError(friendlyError(result.error)); return }
    sessionStorage.setItem('pickleball-booking', JSON.stringify({ bookingId: hold.booking_id, accessToken: hold.access_token }))
    navigate(`/booking/${hold.booking_id}/${hold.access_token}`)
  }
  const cancel = async () => { if (hold) await supabase.rpc('cancel_hold', { p_booking_id: hold.booking_id, p_access_token: hold.access_token }); startOver() }

  if (settingsLoading) return <div className="py-20 text-center text-slate-500">Loading court settings…</div>
  if (!settings) return <div className="rounded-2xl bg-white p-8 text-center shadow-soft">Settings are unavailable. Please try again later.</div>
  if (hold && remaining === 0) return <div className="mx-auto max-w-lg rounded-3xl bg-white p-8 text-center shadow-soft"><div className="text-5xl">⏱</div><h1 className="mt-4 text-2xl font-black text-forest">Hold expired</h1><p className="mt-2 text-slate-600">Those slots were released. You can start a fresh booking.</p><button onClick={startOver} className="mt-6 w-full rounded-xl bg-forest px-5 py-3 font-bold text-white">Start over</button></div>
  return <div className="mx-auto max-w-6xl"><section className="relative mx-auto mb-10 min-h-[420px] max-w-5xl overflow-hidden rounded-b-[2rem] bg-forest shadow-soft"><img src="/assets/basakan-pickle-hero.png" alt="Players enjoying a pickleball game at Basakan Pickle" className="absolute inset-0 h-full w-full object-cover object-center" /><div className="absolute inset-0 bg-gradient-to-r from-[#0b3026]/95 via-[#0b3026]/60 to-transparent" /><div className="relative flex min-h-[420px] max-w-xl flex-col justify-end p-7 text-white sm:p-12"><p className="text-sm font-black uppercase tracking-[0.24em] text-lime">Find your rally</p><h1 className="mt-3 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">Play more.<br /><span className="text-lime">Rally longer.</span></h1><p className="mt-5 max-w-sm text-base leading-relaxed text-white/80 sm:text-lg">Good games, great people, and one more point you will always want to play.</p><button type="button" onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })} className="mt-7 w-fit rounded-full bg-lime px-6 py-3 text-sm font-black text-ink transition hover:bg-white">Book a court</button></div></section><div id="booking" className="mx-auto max-w-5xl"><div className="mb-8"><p className="text-sm font-black uppercase tracking-widest text-forest">Book your game</p><h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Your next rally starts here.</h2></div><StepIndicator step={step} />
    {step === 1 && <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]"><div className="rounded-2xl bg-white p-4 shadow-soft sm:p-6"><h2 className="mb-3 font-bold">Choose a date</h2><DayPicker mode="single" selected={date} onSelect={(value) => value && setDate(value)} disabled={{ before: toDate(todayManila()) }} className="mx-auto" /></div><div className="rounded-2xl bg-white p-5 shadow-soft sm:p-6"><h2 className="font-bold">Choose a court</h2><p className="mt-1 text-sm text-slate-500">Pick where you want to play.</p><div className="mt-5 space-y-3">{[1, 2].map((value) => <button key={value} onClick={() => { setCourt(value); setSelected([]) }} className={`w-full rounded-2xl border-2 p-5 text-left font-black ${court === value ? 'border-forest bg-forest text-white' : 'border-slate-100 bg-[#f7f8f2] text-forest'}`}>Court {value}<span className="mt-1 block text-xs font-normal opacity-75">Outdoor pickleball court</span></button>)}</div><button onClick={() => setStep(2)} className="mt-5 w-full rounded-xl bg-forest px-5 py-3 font-bold text-white">Choose time slots</button></div></section>}
    {step === 2 && <section><div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">{dateLabel(dateValue)}</h2><p className="text-sm text-slate-500">Court {court} · tap to select multiple</p></div><button onClick={() => setStep(1)} className="text-sm font-bold text-forest">Change</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{hours.map((hour) => { const status = blocked.get(hour); const unavailable = Boolean(status) || isPast(hour); const picked = selected.includes(hour); return <button key={hour} disabled={unavailable} onClick={() => toggleHour(hour)} className={`rounded-xl border-2 p-4 text-left transition ${picked ? 'border-forest bg-lime text-ink' : status === 'held' ? 'border-amber-200 bg-amber-50 text-amber-800' : status === 'booked' || isPast(hour) ? 'border-slate-100 bg-slate-100 text-slate-400' : 'border-white bg-white shadow-soft hover:border-lime'}`}><strong>{timeLabel(hour)}</strong><span className="mt-1 block text-xs">{status === 'held' ? 'Reserved' : status === 'booked' ? 'Booked' : isPast(hour) ? 'Passed' : picked ? 'Selected' : 'Available'}</span></button> })}</div><div className="sticky bottom-3 mt-5 rounded-2xl bg-forest p-4 text-white shadow-xl"><div className="flex items-center justify-between"><span>{selected.length} hour{selected.length === 1 ? '' : 's'}</span><strong className="text-xl">{money(total)}</strong></div><button onClick={continueToDetails} className="mt-3 w-full rounded-xl bg-lime px-4 py-3 font-bold text-ink">Continue</button></div></section>}
    {step === 3 && hold && <section className="space-y-5"><div className="rounded-2xl bg-lime p-4 font-bold text-forest">Slots held for {Math.floor(remaining / 60000)}:{String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}</div><form onSubmit={handleSubmit(saveDetails)} className="space-y-4 rounded-2xl bg-white p-5 shadow-soft"><h2 className="text-xl font-black">Your details</h2>{[['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Mobile number'], ['email', 'Email address']].map(([name, label]) => <label key={name} className="block text-sm font-semibold">{label}<input {...register(name as keyof Details)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" placeholder={name === 'phone' ? '09XXXXXXXXX' : undefined} />{errors[name as keyof Details] && <span className="text-xs text-red-600">{errors[name as keyof Details]?.message}</span>}</label>)}<div className="flex gap-3"><button type="button" onClick={cancel} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-bold">Back</button><button className="flex-1 rounded-xl bg-forest px-4 py-3 font-bold text-white">Continue to payment</button></div></form></section>}
    {step === 4 && hold && <section className="space-y-5"><BookingSummary date={dateValue} court={`Court ${court}`} hours={selected} rate={hold.hourly_rate} total={hold.total_amount} /><div className="rounded-2xl bg-white p-5 shadow-soft"><h2 className="text-xl font-black">Pay with GCash</h2>{settings.gcash_qr_path ? <img className="mx-auto my-4 h-52 w-52 object-contain" src={supabase.storage.from('assets').getPublicUrl(settings.gcash_qr_path).data.publicUrl} alt="GCash QR code" /> : <p className="my-4 rounded-lg bg-amber-50 p-3 text-sm">The GCash QR has not been configured yet.</p>}<p className="text-center text-sm">Send exactly <strong className="text-lg text-forest">{money(hold.total_amount)}</strong><br />to {settings.gcash_account_name || 'GCash account'} · {settings.gcash_number || 'number not set'}</p><label className="mt-5 block text-sm font-semibold">GCash reference number<input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label><label className="mt-4 block text-sm font-semibold">Receipt screenshot <span className="font-normal text-slate-500">(optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" /></label><div className="mt-5 flex gap-3"><button onClick={() => setStep(3)} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-bold">Back</button><button onClick={() => void submit({ firstName: '', lastName: '', phone: '', email: '' })} disabled={!reference} className="flex-1 rounded-xl bg-forest px-4 py-3 font-bold text-white disabled:opacity-50">I've Paid</button></div></div></section>}
    {error && <Toast message={error} onClose={() => setError('')} />}
  </div></div>
}

