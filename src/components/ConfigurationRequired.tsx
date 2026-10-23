export function ConfigurationRequired() {
  return (
    <div className="min-h-screen bg-[#f5f8f1] px-4 py-10 text-ink">
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-7 shadow-soft sm:p-10">
        <p className="text-sm font-black uppercase tracking-widest text-forest">Basakan Pickle</p>
        <h1 className="mt-3 text-3xl font-black text-forest">Connect Supabase to continue</h1>
        <p className="mt-3 text-slate-600">
          The app is running, but the Supabase environment variables have not been configured yet.
        </p>
        <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm text-slate-700">
          <li>Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to <code className="rounded bg-slate-100 px-1">.env.local</code>.</li>
          <li>Set <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> to your Supabase project URL.</li>
          <li>Set <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code> to the project anon key.</li>
          <li>Restart the Vite server after saving the file.</li>
        </ol>
        <p className="mt-6 rounded-xl bg-lime/40 p-4 text-sm font-semibold text-forest">
          Never put the Supabase service role key in this file or in frontend environment variables.
        </p>
      </div>
    </div>
  )
}
