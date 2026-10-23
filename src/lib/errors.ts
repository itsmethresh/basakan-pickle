const messages: Record<string, string> = {
  SLOT_TAKEN: 'One or more slots were just taken, please pick again.',
  HOLD_EXPIRED: 'Your hold expired. Please select your slots again.',
  SLOT_PASSED: 'That slot has already started. Please choose another.',
  PAST_DATE: 'Please choose today or a future date.',
  OUTSIDE_HOURS: 'That time is outside the court hours.',
  INVALID_PHONE: 'Enter a valid Philippine mobile number.',
  INVALID_EMAIL: 'Enter a valid email address.',
  BOOKING_NOT_FOUND: 'We could not find that booking.',
  INVALID_STATE: 'This booking is no longer in the expected state.',
  NAME_REQUIRED: 'Enter your first and last name.',
  NO_SLOTS_SELECTED: 'Choose at least one time slot.',
  RECEIPT_REQUIRED: 'Upload your payment screenshot to continue.',
  INVALID_COURT: 'That court is not available.',
  SETTINGS_UNAVAILABLE: 'Booking is temporarily unavailable.',
  FORBIDDEN: 'You do not have permission to do that.'
}
export const friendlyError = (error: unknown) => {
  const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error)
  const code = Object.keys(messages).find((key) => message.includes(key))
  return code ? messages[code] : 'Something went wrong. Please try again.'
}
