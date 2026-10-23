import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { type DatabaseWebhook, escapeHtml, isAuthorizedWebhook, jsonResponse, requiredEnv, sendEmail, siteUrl, timeRange } from '../_shared/email.ts'

type Booking = {
  id: string
  access_token: string
  reference_code: string
  court_id: number
  booking_date: string
  first_name: string | null
  email: string | null
  total_hours: number
  hourly_rate: number
  total_amount: number
  status: string
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    if (!isAuthorizedWebhook(request)) return jsonResponse({ error: 'Unauthorized' }, 401)

    const payload = await request.json() as DatabaseWebhook
    const id = payload.record?.id
    const status = payload.record?.status
    const oldStatus = payload.old_record?.status
    if (payload.type !== 'UPDATE' || oldStatus === status ||
      !['confirmed', 'rejected', 'cancelled'].includes(String(status)) || typeof id !== 'string') {
      return jsonResponse({ skipped: true })
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'))
    const { data: booking, error: bookingError } = await admin.from('bookings')
      .select('id,access_token,reference_code,court_id,booking_date,first_name,email,total_hours,hourly_rate,total_amount,status')
      .eq('id', id)
      .single()
    if (bookingError) throw bookingError
    if (booking.status !== status) return jsonResponse({ skipped: true, reason: 'Booking has since changed status' })
    if (!booking.email) return jsonResponse({ skipped: true, reason: 'Customer email is not available' })

    const [{ data: slots, error: slotsError }, { data: court, error: courtError }] = await Promise.all([
      admin.from('booking_slots').select('slot_hour').eq('booking_id', booking.id).order('slot_hour'),
      admin.from('courts').select('name').eq('id', booking.court_id).single(),
    ])
    if (slotsError) throw slotsError
    if (courtError) throw courtError

    const row = booking as Booking
    const schedule = (slots ?? []).map((slot) => timeRange(slot.slot_hour)).join(', ')
    const bookingLink = siteUrl(`/booking/${encodeURIComponent(row.id)}/${encodeURIComponent(row.access_token)}`)
    const confirmed = status === 'confirmed'
    const subject = confirmed
      ? `Booking confirmed: ${row.reference_code}`
      : `Booking update: ${row.reference_code}`
    const html = confirmed
      ? `
        <h2>Your booking is confirmed</h2>
        <p>Hi ${escapeHtml(row.first_name)}, your payment has been reviewed and your court booking is confirmed.</p>
        <h3>Booking summary</h3>
        <ul>
          <li>Reference: ${escapeHtml(row.reference_code)}</li>
          <li>Court: ${escapeHtml(court.name)}</li>
          <li>Date: ${escapeHtml(row.booking_date)}</li>
          <li>Time: ${escapeHtml(schedule)}</li>
          <li>Duration: ${escapeHtml(row.total_hours)} hour(s)</li>
          <li>Rate: ${escapeHtml(`₱${Number(row.hourly_rate).toFixed(2)}`)} per hour</li>
          <li>Total: ${escapeHtml(`₱${Number(row.total_amount).toFixed(2)}`)}</li>
        </ul>
        <p>Show this email or <a href="${escapeHtml(bookingLink)}">open your booking summary</a> when you arrive.</p>
        <p>Keep this link private. It grants access to your booking details.</p>
      `
      : `
        <h2>Booking update</h2>
        <p>Hi ${escapeHtml(row.first_name)}, your booking ${escapeHtml(row.reference_code)} was ${escapeHtml(status)} by the owner.</p>
        <p><a href="${escapeHtml(bookingLink)}">View your booking details</a> or contact the court if you need help.</p>
      `
    await sendEmail({
      to: row.email,
      subject,
      html,
      idempotencyKey: `booking-${String(status)}-${row.id}`,
    })
    return jsonResponse({ sent: true })
  } catch (error) {
    console.error('notify-customer failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
