export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-xl">{message}<button onClick={onClose} aria-label="Close notification">×</button></div>
}
