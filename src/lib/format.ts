export const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
export const timeLabel = (hour: number) => {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 || 12
  return `${display}:00 ${suffix}`
}
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'Asia/Manila' }).format(new Date(`${value}T12:00:00+08:00`))
export const hourManila = () => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date())) % 24
// A slot is past once its hour has started, matching the customer booking page.
export const isPastSlot = (date: string, hour: number) => date < todayManila() || (date === todayManila() && hour <= hourManila())
export const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
