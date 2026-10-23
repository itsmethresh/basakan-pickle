# Basakan Pickleball

Mobile-first pickleball booking site for two courts, built with React, TypeScript, Vite, Tailwind, Supabase, and Cloudflare Pages.

## Folder structure

```text
src/
  components/       reusable layout, step indicator, summary, toast
  hooks/            TanStack Query hooks
  lib/              Supabase client, generated-style database types, formatters, errors
  pages/            customer booking, confirmation, admin login/dashboard
  App.tsx           routes
  main.tsx          providers and app entry point
supabase/functions/
  notify-owner/     email alert for a newly submitted booking
  notify-customer/  customer booking status emails
  _shared/          Resend and webhook helpers
supabase/migrations/ additive updates for existing databases
public/_redirects   Cloudflare Pages SPA fallback
```

`src/lib/database.types.ts` mirrors the output shape of `supabase gen types typescript --project-id <project-id> > src/lib/database.types.ts`. After schema changes, regenerate it with that command and preserve the RPC/table types used by the app.

Before writing Supabase migrations, check `supabase/supabase-reference-schema.md` for the deployed table and column names. It is a context-only snapshot, not an executable migration; update it whenever a database change adds or changes tables, columns, or indexes.

## Local setup

1. For a new Supabase project, run the entire contents of [`supabase-schema.md`](./supabase-schema.md) in the SQL Editor. This setup script rebuilds booking tables and deletes existing booking data. For an existing project, apply every unapplied SQL file in `supabase/migrations/` in timestamp order. Do not rerun the full setup script on production.
2. In Supabase **Authentication → Users**, create an owner account using an email address you control and a unique, strong password. Add that account's user ID to `public.admin_users` using the example SQL at the end of `supabase-schema.md`. Keep the password in a password manager; never publish or reuse sample credentials.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put the service role key in frontend variables.
4. Install and run:

```bash
npm install
npm run dev
```

### Booking summary lookup errors

If a customer booking link fails with PostgREST error `PGRST203`, the deployed database has multiple `get_my_booking` RPC overloads. This happens when an older `get_my_booking(uuid, uuid)` function remains beside a newer `get_my_booking(uuid, text)` function: both URL arguments are UUID values, so PostgREST cannot select the intended function. Apply the unapplied additive migrations in `supabase/migrations/` in timestamp order. The first removes the legacy signatures and recreates the single deployed signature `get_my_booking(uuid, uuid)`; the transaction-hardening migration follows it. The migrations request a PostgREST schema-cache reload. Do not run the destructive fresh-install schema against an existing database.

### Transaction security migration

For existing projects, apply `supabase/migrations/20261023211000_transaction_security_and_receipt_cleanup.sql` after the earlier notification/summary migration. It hardens the customer hold/payment RPCs, restricts booking-table writes to admins, caps receipt uploads at 5 MiB and supported image MIME types, and adds an active-slot uniqueness index. If the migration reports duplicate active slots, resolve those existing conflicts before retrying; it intentionally stops rather than deleting booking data automatically.

## Edge Functions and email

The email functions use Resend, read the owner recipient from the private `notification_settings` table, and include a private booking link in customer confirmation messages. Set the Resend API key, a sender address from a verified Resend domain, your deployed site URL, and a unique webhook secret:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase secrets set RESEND_API_KEY=re_... FROM_EMAIL="Basakan Pickleball <bookings@example.com>" SITE_URL=https://your-pages-domain.pages.dev DATABASE_WEBHOOK_SECRET=<long-random-secret>
supabase functions deploy notify-owner
supabase functions deploy notify-customer
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to deployed functions by Supabase. The service role key is used only server-side to read booking, court, slot, and notification settings. Set the owner recipient from **Admin → Settings → Owner notification email**.

Create Database Webhooks in Dashboard > Database > Webhooks. Add the `x-webhook-secret` request header with the same value as `DATABASE_WEBHOOK_SECRET` for each webhook:

* `notify-owner`: table `public.bookings`, events `INSERT` and `UPDATE`, URL `https://<project-ref>.supabase.co/functions/v1/notify-owner`. The function sends once when a booking first enters `pending`.
* `notify-customer`: table `public.bookings`, event `UPDATE`, URL `https://<project-ref>.supabase.co/functions/v1/notify-customer`. It sends status updates when a booking is confirmed, rejected, or cancelled; confirmation emails include the detailed booking link.

The functions verify the webhook secret and re-read booking data before sending. Resend idempotency keys help prevent duplicate emails on webhook retries. No owner email is sent until a recipient is configured in Settings.

Expired holds are deleted every 10 minutes by a scheduled database job. The migration also indexes expiration time and removes expired holds already in the table.
## Cloudflare Pages

### Publish the website

Cloudflare Pages hosts the static React/Vite website. Supabase remains responsible for the database, authentication, file storage, and Edge Functions.

1. **Prepare the production backend.**
   - Apply every unapplied migration in `supabase/migrations/` in timestamp order. Do not run the destructive `supabase-schema.md` setup script against existing booking data.
   - Check the Supabase dashboard for failed migrations and test the customer booking-summary link.
   - Secure the admin account before launch. Use a unique, strong password and verify the account is listed in `public.admin_users`.
   - Configure Supabase Storage and Row Level Security policies for the tables and receipt files. The frontend uses the Supabase anon/publishable key, so database and storage access must be protected by these policies.
2. **Make sure the code is in GitHub.** Cloudflare’s Git integration builds from a pushed branch. Commit and push the project to the GitHub repository you want Cloudflare to watch. Keep `.env` out of Git; use Cloudflare’s project environment variables instead.
3. **Create a Pages project.**
   - In the Cloudflare dashboard, open **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
   - Connect GitHub, authorize Cloudflare, and select this repository.
   - Select the production branch (commonly `main`).
   - Set **Build command** to `npm run build`, **Build output directory** to `dist`, and leave **Root directory** at the repository root.
   - Save and deploy. Wait for the deployment to finish, then open its `*.pages.dev` address and check the site before attaching your domain.
4. **Add the Supabase frontend variables.** In the Pages project, open **Settings** → **Environment variables** and add these for **Production** (and Preview too if you will test preview deployments):
   - `VITE_SUPABASE_URL` — the project URL from Supabase **Project Settings** → **API**.
   - `VITE_SUPABASE_ANON_KEY` — the anon/publishable key from the same Supabase page.

   Redeploy after changing variables because Vite embeds `VITE_*` values during the build. Never add the Supabase service-role key, a Resend API key, or the webhook secret to Cloudflare frontend variables; those are server-only secrets.
5. **Connect your existing domain.** In Cloudflare, open **Workers & Pages** → your Pages project → **Custom domains** → **Set up a domain**. Add the hostname there first and follow the dashboard instructions.
   - **For the root/apex domain** (`example.com`): the domain must be a zone in the same Cloudflare account as the Pages project, and its authoritative nameservers must point to Cloudflare. If the domain is registered elsewhere, keep the registration there and change its nameservers at that registrar to the Cloudflare nameservers shown for the zone.
   - **For a subdomain while keeping DNS elsewhere** (for example, `www.example.com`): add the subdomain in the Pages project, then create the CNAME at your current DNS provider pointing to `<your-project>.pages.dev`. Adding the custom domain in Pages is required; creating only a CNAME can leave the hostname inactive.
   - You can add both the apex and `www` hostnames if you want both to work. Choose one as the canonical address and configure a redirect for the other.

   **Important if you use domain email or other services:** before changing nameservers, review the current DNS zone and make sure all required MX, SPF, DKIM, DMARC, verification, and other service records are present in Cloudflare. A missing mail record can interrupt email delivery. Wait for Cloudflare to show the zone as active and for the custom domain's TLS certificate to become active before treating the domain as live.
6. **Update Supabase Auth URLs.** In Supabase, open **Authentication** → **URL Configuration**. Set **Site URL** to your chosen production origin (for example, `https://example.com`). Add the production origin and the required callback paths to **Redirect URLs**, such as `https://example.com/**`; add `https://www.example.com/**` only if you will use `www`. Keep localhost redirect URLs only for development. This is important for password reset and confirmation links.
7. **Point Resend emails at the live site.** If email functions are enabled, set the Supabase Edge Function secret `SITE_URL` to the production origin, then deploy the functions if needed. Set the owner notification email in **Admin → Settings**, and create/verify the Database Webhooks described in [Edge Functions and email](#edge-functions-and-email). Do not use the temporary `pages.dev` URL in customer emails once the custom domain is live.
8. **Run a production smoke test.**
   - Visit the custom domain over HTTPS and refresh a nested route such as `/booking/<booking-id>/<token>`.
   - Create a test booking, confirm the detailed summary link loads, and verify payment submission/status updates.
   - Sign in to `/admin`, test the admin actions, and verify owner/customer email delivery and the Resend activity log.
   - Check **Workers & Pages → Deployments** and the Supabase/Resend logs if a step fails. Fix the issue and push a new commit; Git integration will build and deploy it.

The included `public/_redirects` file keeps React Router routes working after a direct visit or refresh. Cloudflare Pages uses Git integration to deploy new commits automatically and also provides preview deployments for other branches.

Official references: [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/), [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Cloudflare full DNS setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/), and [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
