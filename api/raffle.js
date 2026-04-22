const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const T = process.env.TABLE_PREFIX || 'ct'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const pw = req.headers['x-admin-password']
    if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' })
    const { data, error } = await supabase
      .from(`${T}_raffle`)
      .select('*')
      .order('registered_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  if (req.method === 'POST') {
    const { name, phone, single_tickets, bundle_tickets, total_tickets, total_amount } = req.body
    if (!name?.trim() || !phone?.trim())
      return res.status(400).json({ error: 'Name and phone number are required.' })
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10 && !(digits.length === 11 && digits[0] === '1'))
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number.' })
    if (!total_tickets || total_tickets < 1)
      return res.status(400).json({ error: 'Please select at least one ticket.' })

    const { data, error } = await supabase
      .from(`${T}_raffle`)
      .insert([{
        name: name.trim(),
        phone: phone.trim(),
        single_tickets: single_tickets || 0,
        bundle_tickets: bundle_tickets || 0,
        total_tickets,
        total_amount
      }])
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  res.status(405).json({ error: 'Method not allowed' })
}
