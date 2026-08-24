// The single place paid/total amounts turn into a payment_status label.
// Used both when a payment is approved (adminPayments.js) and when an
// admin edits a booking's total amount, which can move an already-paid
// booking's status without any new money changing hands (admin.js).
export function derivePaymentStatus(paid, total) {
  if (paid <= 0) return 'unpaid'
  if (total == null) return 'part_payment'
  if (paid > total + 0.01) return 'overpaid'
  if (paid >= total - 0.01) return 'paid'
  return 'part_payment'
}
