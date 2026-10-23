import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { BookingPage } from './pages/BookingPageRedesigned'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { AdminLogin } from './pages/AdminLogin'
import { AdminPage } from './pages/AdminPage'
import { ConfigurationRequired } from './components/ConfigurationRequired'
import { isSupabaseConfigured } from './lib/supabase'

export function App() {
  if (!isSupabaseConfigured) return <ConfigurationRequired />
  return <Routes><Route element={<Layout />}><Route path="/" element={<BookingPage />} /><Route path="/confirmation" element={<ConfirmationPage />} /><Route path="/booking/:bookingId/:token" element={<ConfirmationPage />} /><Route path="/admin/login" element={<AdminLogin />} /><Route path="/admin" element={<AdminPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>
}

