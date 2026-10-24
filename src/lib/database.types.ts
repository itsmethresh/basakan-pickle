export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type BookingStatus = 'held' | 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'expired'

export interface Database {
  public: {
    Tables: {
      courts: { Row: { id: number; name: string; is_active: boolean }; Insert: { id?: number; name: string; is_active?: boolean }; Update: { name?: string; is_active?: boolean }; Relationships: [] }
      settings: { Row: Settings; Insert: Partial<Settings> & { id?: number }; Update: { business_name?: string; hourly_rate?: number; day_hourly_rate?: number; night_hourly_rate?: number; open_hour?: number; close_hour?: number; hold_minutes?: number; gcash_qr_path?: string | null; gcash_account_name?: string | null; gcash_number?: string | null }; Relationships: [] }
      notification_settings: { Row: NotificationSettings; Insert: Partial<NotificationSettings> & { id?: number }; Update: Partial<NotificationSettings>; Relationships: [] }
      admin_users: { Row: { user_id: string; email: string }; Insert: { user_id: string; email: string }; Update: { user_id?: string; email?: string }; Relationships: [] }
      bookings: { Row: Booking; Insert: Partial<Booking>; Update: Partial<Booking>; Relationships: [] }
      booking_slots: { Row: BookingSlot; Insert: Partial<BookingSlot>; Update: Partial<BookingSlot>; Relationships: [] }
    }
    Views: {}
    Functions: {
      get_availability: { Args: { p_date: string }; Returns: AvailabilityRow[] }
      hold_slots: { Args: { p_court_id: number; p_date: string; p_hours: number[] }; Returns: HoldResult }
      cancel_hold: { Args: { p_booking_id: string; p_access_token: string }; Returns: null }
      submit_payment: { Args: { p_booking_id: string; p_access_token: string; p_first_name: string; p_last_name: string; p_phone: string; p_email: string; p_receipt_path: string }; Returns: { booking_id: string; access_token: string; status: BookingStatus; receipt_path: string | null } }
      get_my_booking: { Args: { p_booking_id: string; p_access_token: string }; Returns: CustomerBooking }
      admin_reschedule_booking: { Args: { p_booking_id: string; p_court_id: number; p_date: string; p_hours: number[] }; Returns: null }
      admin_delete_booking: { Args: { p_booking_id: string }; Returns: string | null }
      is_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: { booking_status: BookingStatus }
    CompositeTypes: Record<string, never>
  }
}

export type Settings = { id: number; business_name: string; hourly_rate: number; day_hourly_rate: number; night_hourly_rate: number; open_hour: number; close_hour: number; hold_minutes: number; gcash_qr_path: string | null; gcash_account_name: string | null; gcash_number: string | null; updated_at: string }
export type NotificationSettings = { id: number; owner_notification_email: string | null; updated_at: string }
export type Booking = { id: string; reference_code: string; access_token: string; court_id: number; booking_date: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; total_hours: number; hourly_rate: number; total_amount: number; receipt_path: string | null; status: BookingStatus; hold_expires_at: string | null; admin_notes: string | null; submitted_at: string | null; confirmed_at: string | null; created_at: string; updated_at: string }
export type BookingSlot = { id: number; booking_id: string; court_id: number; booking_date: string; slot_hour: number; hourly_rate: number; is_active: boolean }
export type AvailabilityRow = { court_id: number; slot_hour: number; status: 'held' | 'booked' }
export type HoldResult = { booking_id: string; access_token: string; hourly_rate: number; slot_rates: number[]; total_hours: number; total_amount: number; hold_expires_at: string }
export type CustomerBooking = { booking_id: string; status: BookingStatus; booking_date: string; court_name: string; hours: number[]; hourly_rate: number; slot_rates: number[]; total_amount: number; hold_expires_at: string | null; first_name: string | null; last_name: string | null }
