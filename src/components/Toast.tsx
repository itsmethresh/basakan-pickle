type ToastProps = { message: string; onClose: () => void; variant?: 'success' | 'error' }

export function Toast({ message, onClose, variant = 'error' }: ToastProps) {
  const style = variant === 'success' ? 'bg-[#103b2b]' : 'bg-red-700'
  return <div role={variant === 'error' ? 'alert' : 'status'} aria-live={variant === 'error' ? 'assertive' : 'polite'} className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl ${style}`}>{message}<button onClick={onClose} aria-label="Close notification">×</button></div>
}
