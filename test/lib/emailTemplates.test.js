import { describe, it, expect } from 'vitest'
import {
  adminLoginEmail, bookingCreatedEmail, bookingStatusChangedEmail,
  expenseAddedEmail, paymentLoggedEmail, autoStatusSummaryEmail,
  dailyDigestEmail, weeklyDigestEmail, monthlyReportEmail,
} from '../../src/lib/emailTemplates.js'

// Every template takes the same shape of real-world data it would receive
// in production, from scheduledReports.js/admin.js/adminExpenses.js/
// adminPayments.js — not placeholder strings, so a missing field would
// actually surface as "undefined" in the rendered HTML.
const samples = {
  adminLoginEmail: () => adminLoginEmail({ displayName: 'Tomiwa', role: 'admin', time: 'Oct 7, 2026, 9:00 AM' }),
  bookingCreatedEmail: () => bookingCreatedEmail({
    bookingCode: 'IKE-0200', fullName: 'Test Guest', listingTitle: 'Ikeja Apartment - Unit 1', unitCode: '4C',
    checkIn: '2026-10-10', checkOut: '2026-10-12', ratePerNight: 120000, discount: 10000, total: 230000,
    createdBy: 'Tomiwa', dashboardUrl: 'https://example.com/admin',
  }),
  bookingStatusChangedEmail: () => bookingStatusChangedEmail({
    bookingCode: 'IKE-0200', fullName: 'Test Guest', listingTitle: 'Ikeja Apartment - Unit 1', unitCode: '4C',
    oldStatus: 'confirmed', newStatus: 'checked_in', changedBy: 'Tomiwa', reason: null, dashboardUrl: 'https://example.com/admin',
  }),
  bookingStatusChangedEmail_withReason: () => bookingStatusChangedEmail({
    bookingCode: 'IKE-0200', fullName: 'Test Guest', listingTitle: 'Ikeja Apartment - Unit 1', unitCode: '4C',
    oldStatus: 'confirmed', newStatus: 'cancelled', changedBy: 'Tomiwa', reason: 'Guest requested cancellation', dashboardUrl: 'https://example.com/admin',
  }),
  expenseAddedEmail: () => expenseAddedEmail({
    expenseCode: 'EXP-0100', category: 'Utilities', amount: 50000, scopeLabel: 'Ikeja Apartment - Unit 1 (4C)',
    loggedBy: 'Joshua', description: 'PHCN bill', dashboardUrl: 'https://example.com/admin',
  }),
  paymentLoggedEmail: () => paymentLoggedEmail({
    bookingCode: 'IKE-0200', fullName: 'Test Guest', amount: 100000, paymentMethod: 'Bank Transfer',
    newAmountPaid: 100000, balance: 130000, paymentStatus: 'part_payment', loggedBy: 'Tomiwa', receiptCount: 1,
    dashboardUrl: 'https://example.com/admin',
  }),
  autoStatusSummaryEmail: () => autoStatusSummaryEmail({
    checkedIn: [{ booking_code: 'IKE-0201', full_name: 'A Guest', title: 'Ikeja Apartment - Unit 2', unit_code: '4D' }],
    checkedOut: [],
    dashboardUrl: 'https://example.com/admin',
  }),
}

describe('email templates render without leaking missing/broken data', () => {
  const badMarkers = ['undefined', 'NaN', '[object Object]']

  for (const [name, render] of Object.entries(samples)) {
    it(`${name} contains no bad markers`, () => {
      const html = render()
      for (const marker of badMarkers) {
        expect(html, `${name} should not contain "${marker}"`).not.toContain(marker)
      }
    })
  }

  it('escapes guest-supplied text so it cannot inject markup into the email', () => {
    const html = bookingCreatedEmail({
      bookingCode: 'IKE-0999',
      fullName: '<img src=x onerror=alert(1)>',
      listingTitle: 'Unit', unitCode: null, checkIn: '2026-01-01', checkOut: '2026-01-02',
      ratePerNight: 1000, discount: 0, total: 1000, createdBy: 'Tester', dashboardUrl: 'https://x',
    })
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes a cancellation reason the same way', () => {
    const html = bookingStatusChangedEmail({
      bookingCode: 'IKE-0999', fullName: 'Guest', listingTitle: 'Unit', unitCode: null,
      oldStatus: 'confirmed', newStatus: 'cancelled', changedBy: 'Tester',
      reason: '<script>alert(1)</script>', dashboardUrl: 'https://x',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('digest email templates (reused structures from scheduledReports.js)', () => {
  it('dailyDigestEmail renders cleanly with a quiet-day shape (every list empty)', () => {
    const html = dailyDigestEmail({
      dateLabel: 'Wednesday, October 7, 2026',
      checkInsToday: [], checkOutsToday: [], checkedInNow: [],
      occupiedCount: 0, availableCount: 11, totalUnits: 11,
      upcoming7d: [], unpaidReserved: [], overduePending: [],
      expectedToday: 0, receivedToday: 0, expensesYesterday: 0, expensesToday: 0,
      dashboardUrl: 'https://x',
    })
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  })

  it('weeklyDigestEmail and monthlyReportEmail render cleanly with a minimal report shape', () => {
    const report = {
      totalBookings: 0, totalRevenue: 0, totalCollected: 0, totalOutstanding: 0, totalExpenses: 0, netIncome: 0,
      topListings: [], bottomListings: [], byLocation: [], expenseByLocation: [], expenseByCategory: [], byStatus: [],
      averageBookingValue: 0,
    }
    const weekly = weeklyDigestEmail({
      weekLabel: 'Oct 1 - Oct 7', report, checkInsCompleted: 0, checkOutsCompleted: 0,
      cancelledCount: 0, noShowCount: 0, cancellations: [], upcoming7d: [], dashboardUrl: 'https://x',
    })
    expect(weekly).not.toContain('undefined')

    const monthly = monthlyReportEmail({
      monthLabel: 'September 2026', report, previousReport: report, paymentStatusCounts: {},
      cancellationCount: 0, averageLengthOfStay: 0, occupancyRate: 0, expenseByListing: [], upcomingNextMonth: [],
      dashboardUrl: 'https://x',
    })
    expect(monthly).not.toContain('undefined')
    expect(monthly).not.toContain('NaN')
  })
})
