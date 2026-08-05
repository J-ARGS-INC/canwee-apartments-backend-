const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(new Date(value).getTime())
}

export function requireString(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors[field] = `${field} is required.`
  }
}

// Unbounded text fields are a cheap abuse vector (bloats the DB row, the
// notification email, and — since express.json()'s body-size limit is the
// only other backstop — a lot of the request budget). Called after
// requireString/optional presence checks, so it only fires on values that
// are actually present.
export function maxLength(value, field, max, errors) {
  if (typeof value === 'string' && value.length > max) {
    errors[field] = `${field} must be ${max} characters or fewer.`
  }
}

// Guest-submitted text gets interpolated into notification email HTML, so it
// needs escaping to prevent a booking/contact submission from injecting
// markup or links into the email the host reads.
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
