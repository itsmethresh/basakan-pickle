export type DatabaseWebhook = {
  type?: string
  record?: Record<string, unknown> | null
  old_record?: Record<string, unknown> | null
}

export function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required function secret: ${name}`)
  return value
}

export function isAuthorizedWebhook(request: Request) {
  const expected = requiredEnv('DATABASE_WEBHOOK_SECRET')
  const provided = request.headers.get('x-webhook-secret')
  return Boolean(provided && provided === expected)
}

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char] ?? char)
}

export function timeRange(hour: number) {
  const format = (value: number) => {
    const normalized = ((value % 24) + 24) % 24
    return `${normalized % 12 || 12}:00 ${normalized >= 12 ? 'PM' : 'AM'}`
  }
  return `${format(hour)} – ${format(hour + 1)}`
}

export function siteUrl(path: string) {
  return `${requiredEnv('SITE_URL').replace(/\/+$/, '')}${path}`
}

export async function sendEmail(input: { to: string; subject: string; html: string; idempotencyKey: string }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from: requiredEnv('FROM_EMAIL'),
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  })
  if (!response.ok) throw new Error(`Resend API returned ${response.status}: ${await response.text()}`)
  return response.json()
}

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
