import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'

export function AdminLogin() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.error) setError(friendlyError(result.error))
    else {
      client.setQueryData(['auth'], result.data.session)
      navigate('/admin', { replace: true })
    }
  }

  return <div className="mx-auto max-w-md px-5 py-10 sm:py-14"><div className="rounded-3xl bg-white p-7 shadow-soft sm:p-8"><h1 className="text-2xl font-black text-forest">Owner login</h1><p className="mt-1 text-sm text-slate-500">Manage bookings and GCash settings.</p><form onSubmit={login} className="mt-6 space-y-4"><label className="block text-sm font-semibold">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label><label className="block text-sm font-semibold">Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label>{error && <p className="text-sm text-red-700">{error}</p>}<button className="w-full rounded-xl bg-forest px-4 py-3 font-bold text-white">Sign in</button></form></div></div>
}
