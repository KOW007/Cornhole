const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' })

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })

  const { data: teams, error } = await supabase
    .from('ct_teams').select('name, phone, partner_status')
  if (error) return res.status(500).json({ error: error.message })

  const venmoLink = 'https://venmo.com/katherine-wallin-1?txn=pay&amount=40&note=SAS%20Cornhole%20Tournament%202026'
  const message = `Hi! You're registered for the SAS Cornhole Tournament 2026. Entry fee is $40/team ($20/person). Please pay via Venmo: ${venmoLink}`

  const sid = process.env.TWILIO_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`

  const results = { sent: 0, failed: 0, skipped: 0 }

  for (const team of teams) {
    if (!team.phone) { results.skipped++; continue }

    let phone = team.phone.replace(/\D/g, '')
    if (phone.length === 10) phone = '1' + phone
    phone = '+' + phone

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ From: from, To: phone, Body: message })
      })
      if (r.ok) results.sent++
      else results.failed++
    } catch (e) {
      results.failed++
    }
  }

  return res.json({ success: true, ...results })
}
