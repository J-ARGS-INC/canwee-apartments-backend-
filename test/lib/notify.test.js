import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Mocked so this is a true unit test of the merge logic — no real database
// call, and no dependency on whatever is actually in the settings table
// right now.
vi.mock('../../src/lib/settings.js', () => ({ getSetting: vi.fn() }))

const { getSetting } = await import('../../src/lib/settings.js')
const { getDigestRecipients } = await import('../../src/lib/notify.js')

describe('getDigestRecipients', () => {
  const originalEnv = process.env.NOTIFY_EMAILS

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NOTIFY_EMAILS = 'support@canweeapartments.com,jargsltd@gmail.com'
  })

  it('always includes the two hardcoded operator addresses, with nothing else configured', async () => {
    getSetting.mockImplementation(async (key) => (key === 'notify_emails' ? [] : []))
    const recipients = await getDigestRecipients('daily_digest_emails')
    const emails = recipients.map((r) => r.email)
    expect(emails).toContain('echteedee2@gmail.com')
    expect(emails).toContain('emoawosejoshua@gmail.com')
  })

  it('always includes the NOTIFY_EMAILS env addresses too, not only as a fallback', async () => {
    getSetting.mockImplementation(async (key) => (key === 'notify_emails' ? ['someone-real@example.com'] : []))
    const recipients = await getDigestRecipients('daily_digest_emails')
    const emails = recipients.map((r) => r.email)
    // The env addresses must still be present even though notify_emails is non-empty —
    // this is the exact bug this behavior was built to fix (env used to be a
    // fallback-only, used only when the setting was empty).
    expect(emails).toContain('support@canweeapartments.com')
    expect(emails).toContain('jargsltd@gmail.com')
    expect(emails).toContain('someone-real@example.com')
  })

  it('adds a dedicated digest-specific address on top of the shared baseline, not instead of it', async () => {
    getSetting.mockImplementation(async (key) =>
      key === 'daily_digest_emails' ? ['owner-only@example.com'] : key === 'notify_emails' ? ['admin@example.com'] : [],
    )
    const recipients = await getDigestRecipients('daily_digest_emails')
    const emails = recipients.map((r) => r.email)
    expect(emails).toContain('owner-only@example.com')
    expect(emails).toContain('admin@example.com')
    expect(emails).toContain('echteedee2@gmail.com')
  })

  it('never returns duplicate addresses even when the same one appears in multiple sources', async () => {
    getSetting.mockImplementation(async (key) =>
      key === 'daily_digest_emails' ? ['emoawosejoshua@gmail.com'] : [],
    )
    const recipients = await getDigestRecipients('daily_digest_emails')
    const emails = recipients.map((r) => r.email)
    const occurrences = emails.filter((e) => e === 'emoawosejoshua@gmail.com').length
    expect(occurrences).toBe(1)
  })

  afterAll(() => {
    process.env.NOTIFY_EMAILS = originalEnv
  })
})
