const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}

export function requireString(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors[field] = `${field} is required.`
  }
}
