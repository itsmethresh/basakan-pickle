import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { friendlyError } from '../lib/errors'

type ConfirmDialogProps = {
  title: string
  description: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  details?: ReactNode
  onCancel: () => void
  onConfirm: () => Promise<void>
}

export function ConfirmDialog({ title, description, confirmLabel, tone = 'primary', details, onCancel, onConfirm }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const Icon = tone === 'danger' ? AlertTriangle : CheckCircle2
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onCancel()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#002418]/55 p-3 sm:items-center sm:p-5">
    <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e5eae5] bg-[#f8faf8] shadow-[0_20px_40px_-8px_rgba(16,59,43,0.25)]">
      <div className="p-5 sm:p-6">
        <div className={`grid h-11 w-11 place-items-center rounded-xl ${tone === 'danger' ? 'bg-[#fdeeee] text-[#a42a2a]' : 'bg-[#eaf6ee] text-[#1b633f]'}`}><Icon className="h-5 w-5" aria-hidden /></div>
        <h2 id="confirm-dialog-title" className="mt-4 text-lg font-bold text-[#103b2b]">{title}</h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm leading-relaxed text-[#526058]">{description}</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-[#fdeeee] p-3 text-sm text-[#a42a2a]">{error}</p>}
        {details && <div className="mt-4">{details}</div>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-[#e5eae5] bg-white px-5 py-4 sm:px-6">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-[#d0dcd4] px-4 py-2.5 text-sm font-bold text-[#526058] disabled:opacity-50">Go back</button>
        <button type="button" disabled={busy} onClick={() => void confirm()} className={`rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${tone === 'danger' ? 'bg-[#a42a2a] hover:bg-[#872222]' : 'bg-[#103b2b] hover:bg-[#186b48]'}`}>{busy ? 'Please wait…' : confirmLabel}</button>
      </footer>
    </section>
  </div>
}
