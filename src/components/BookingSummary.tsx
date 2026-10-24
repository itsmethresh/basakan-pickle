import { money, timeLabel, dateLabel } from '../lib/format'
export function BookingSummary({ date, court, hours, rate, rates, total }: { date: string; court: string; hours: number[]; rate: number; rates?: number[]; total: number }) {
  const breakdown = new Map<number, number>()
  hours.forEach((_, index) => {
    const slotRate = rates?.[index] ?? rate
    breakdown.set(slotRate, (breakdown.get(slotRate) ?? 0) + 1)
  })
  return <div className="rounded-xl border border-[#e5eae5] bg-white p-5 shadow-[0_2px_8px_rgba(16,59,43,0.04)]"><p className="text-xs font-bold uppercase tracking-wider text-[#2e7d58]">Booking summary</p><h3 className="mt-2 font-bold text-[#103b2b]">{court} · {dateLabel(date)}</h3><div className="mt-3 flex flex-wrap gap-2">{hours.map((hour) => <span key={hour} className="rounded-full bg-[#eaf6ee] px-3 py-1.5 text-xs font-semibold text-[#1b633f]">{timeLabel(hour)}</span>)}</div><div className="mt-5 space-y-2 border-t border-[#e5eae5] pt-4 text-sm text-[#526058]">{[...breakdown].map(([slotRate, count]) => <div key={slotRate} className="flex justify-between"><span>{count} hour{count === 1 ? '' : 's'} × {money(slotRate)}</span><strong className="text-[#191c1b]">{money(slotRate * count)}</strong></div>)}<div className="flex justify-between border-t border-[#e5eae5] pt-2 text-lg font-bold text-[#103b2b]"><span>TOTAL</span><span>{money(total)}</span></div></div></div>
}
