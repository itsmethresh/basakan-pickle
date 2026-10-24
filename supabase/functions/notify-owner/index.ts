import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { type DatabaseWebhook, escapeHtml, isAuthorizedWebhook, jsonResponse, requiredEnv, sendEmail, siteUrl, timeRange } from '../_shared/email.ts'

type Booking = {
  id: string
  reference_code: string
  court_id: number
  booking_date: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  total_amount: number
  status: string
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    if (!isAuthorizedWebhook(request)) return jsonResponse({ error: 'Unauthorized' }, 401)

    const payload = await request.json() as DatabaseWebhook
    const id = payload.record?.id
    const newStatus = payload.record?.status
    const oldStatus = payload.old_record?.status
    const isNewPendingBooking = newStatus === 'pending' &&
      ((payload.type === 'INSERT' && !oldStatus) || (payload.type === 'UPDATE' && oldStatus !== 'pending'))
    if (!isNewPendingBooking || typeof id !== 'string') return jsonResponse({ skipped: true })

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'))
    const [{ data: booking, error: bookingError }, { data: config, error: configError }] = await Promise.all([
      admin.from('bookings')
        .select('id,reference_code,court_id,booking_date,first_name,last_name,phone,email,total_amount,status')
        .eq('id', id)
        .single(),
      admin.from('notification_settings')
        .select('owner_notification_email')
        .eq('id', 1)
        .single(),
    ])
    if (bookingError) throw bookingError
    if (configError) throw configError
    if (booking.status !== 'pending') return jsonResponse({ skipped: true, reason: 'Booking is no longer pending' })
    const ownerEmail = config.owner_notification_email
    if (!ownerEmail) return jsonResponse({ skipped: true, reason: 'Owner notification email is not configured' })

    const [{ data: slots, error: slotsError }, { data: court, error: courtError }] = await Promise.all([
      admin.from('booking_slots').select('slot_hour,hourly_rate').eq('booking_id', booking.id).order('slot_hour'),
      admin.from('courts').select('name').eq('id', booking.court_id).single(),
    ])
    if (slotsError) throw slotsError
    if (courtError) throw courtError

    const row = booking as Booking
    const schedule = (slots ?? []).map((slot) => timeRange(slot.slot_hour)).join(', ')
    const priceBreakdown = new Map<number, number>()
    for (const slot of slots ?? []) priceBreakdown.set(Number(slot.hourly_rate), (priceBreakdown.get(Number(slot.hourly_rate)) ?? 0) + 1)
    const priceLines = [...priceBreakdown].map(([rate, count]) =>
      `<li>${escapeHtml(count)} hour(s) × ${escapeHtml(`₱${rate.toFixed(2)}`)}: ${escapeHtml(`₱${(rate * count).toFixed(2)}`)}</li>`,
    ).join('')
    const html = `
      <h2>New booking received</h2>
      <p><strong>${escapeHtml(row.reference_code)}</strong> is awaiting payment review.</p>
      <ul>
        <li>Customer: ${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</li>
        <li>Phone: ${escapeHtml(row.phone)}</li>
        <li>Email: ${escapeHtml(row.email)}</li>
        <li>Court: ${escapeHtml(court.name)}</li>
        <li>Date: ${escapeHtml(row.booking_date)}</li>
        <li>Time: ${escapeHtml(schedule)}</li>
        ${priceLines}
        <li>Total: ${escapeHtml(`₱${Number(row.total_amount).toFixed(2)}`)}</li>
      </ul>
      <p><a href="${escapeHtml(siteUrl('/admin'))}">Open the admin dashboard</a></p>
    `
    await sendEmail({
      to: ownerEmail,
      subject: `New booking ${row.reference_code}`,
      html,
      idempotencyKey: `booking-received-${row.id}`,
    })
    return jsonResponse({ sent: true })
  } catch (error) {
    console.error('notify-owner failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
