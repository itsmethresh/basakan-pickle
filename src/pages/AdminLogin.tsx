import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'

export function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.error) setError(friendlyError(result.error))
    else navigate('/admin')
  }

  const sendReset = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/admin/login` })
    if (result.error) setError(friendlyError(result.error))
    else setMessage('Check your email for a password reset link.')
  }

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const result = await supabase.auth.updateUser({ password: newPassword })
    if (result.error) setError(friendlyError(result.error))
    else {
      setMessage('Password updated. You can now sign in.')
      setPassword('')
      setMode('login')
    }
  }

  return <div className="mx-auto max-w-md px-5 py-10 sm:py-14"><div className="rounded-3xl bg-white p-7 shadow-soft sm:p-8"><h1 className="text-2xl font-black text-forest">{mode === 'reset' ? 'Set a new password' : mode === 'forgot' ? 'Reset your password' : 'Owner login'}</h1><p className="mt-1 text-sm text-slate-500">{mode === 'login' ? 'Manage bookings and GCash settings.' : mode === 'forgot' ? 'We will send a secure reset link to your email.' : 'Choose a new password for your admin account.'}</p>{mode === 'reset' ? <form onSubmit={updatePassword} className="mt-6 space-y-4"><label className="block text-sm font-semibold">New password<input type="password" required minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label><button className="w-full rounded-xl bg-forest px-4 py-3 font-bold text-white">Update password</button></form> : <form onSubmit={mode === 'forgot' ? sendReset : login} className="mt-6 space-y-4"><label className="block text-sm font-semibold">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label>{mode === 'login' && <label className="block text-sm font-semibold">Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3" /></label>}{error && <p className="text-sm text-red-700">{error}</p>}{message && <p className="text-sm font-semibold text-forest">{message}</p>}<button className="w-full rounded-xl bg-forest px-4 py-3 font-bold text-white">{mode === 'forgot' ? 'Send reset link' : 'Sign in'}</button></form>}{mode === 'login' && <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }} className="mt-4 w-full text-sm font-bold text-forest">Forgot password?</button>}{mode === 'forgot' && <button type="button" onClick={() => { setMode('login'); setError(''); setMessage('') }} className="mt-4 w-full text-sm font-bold text-forest">Back to sign in</button>}</div></div>
}
