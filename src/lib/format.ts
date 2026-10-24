export const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
export const timeLabel = (hour: number) => {
  const normalizedHour = ((hour % 24) + 24) % 24
  const suffix = normalizedHour >= 12 ? 'PM' : 'AM'
  const display = normalizedHour % 12 || 12
  return `${display}:00 ${suffix}`
}
export type HourlyRates = { day_hourly_rate: number; night_hourly_rate: number }
export const rateForHour = (hour: number, rates: HourlyRates) => hour >= 5 && hour <= 16 ? rates.day_hourly_rate : rates.night_hourly_rate
export const totalForHours = (hours: number[], rates: HourlyRates) => hours.reduce((total, hour) => total + rateForHour(hour, rates), 0)
export const dateLabel = (value: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'Asia/Manila' }).format(new Date(`${value}T12:00:00+08:00`))
export const hourManila = () => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date())) % 24
// A slot is past once its hour has started, matching the customer booking page.
export const isPastSlot = (date: string, hour: number) => date < todayManila() || (date === todayManila() && hour <= hourManila())
export const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
