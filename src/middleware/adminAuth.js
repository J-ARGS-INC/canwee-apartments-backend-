export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!process.env.ADMIN_API_KEY || token !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing admin credentials.' })
  }

  next()
}
