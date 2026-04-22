const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const T = process.env.TABLE_PREFIX || 'ct'

const PRIZE_IDS = ['uchiko', 'roka', 'milk_cookies', 'revitalash']

function sumTotals(entries) {
  const totals = Object.fromEntries(PRIZE_IDS.map(id => [id, 0]))
  for (const e of entries) {
    if (e.allocations) {
      for (const id of PRIZE_IDS) totals[id] += e.allocations[id] || 0
    }
  }
  return totals
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from(`${T}_raffle`)
      .select('*')
      .order('registered_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    const totals = sumTotals(data)

    const pw = req.headers['x-admin-password']
    if (pw === process.env.ADMIN_PASSWORD) {
      return res.json({ entries: data, totals })
    }
    return res.json({ totals })
  }

  if (req.method === 'POST') {
    const { name, phone, single_tickets, bundle_tickets, total_tickets, total_amount, allocations } = req.body
    if (!name?.trim() || !phone?.trim())
      return res.status(400).json({ error: 'Name and phone number are required.' })
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10 && !(digits.length === 11 && digits[0] === '1'))
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number.' })
    if (!total_tickets || total_tickets < 1)
      return res.status(400).json({ error: 'Please select at least one ticket.' })

    const allocSum = PRIZE_IDS.reduce((s, id) => s + (allocations?.[id] || 0), 0)
    if (allocSum !== total_tickets)
      return res.status(400).json({ error: 'Please allocate all your tickets to prizes.' })

    const { data, error } = await supabase
      .from(`${T}_raffle`)
      .insert([{
        name: name.trim(),
        phone: phone.trim(),
        single_tickets: single_tickets || 0,
        bundle_tickets: bundle_tickets || 0,
        total_tickets,
        total_amount,
        allocations: allocations || {}
      }])
      .select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  res.status(405).json({ error: 'Method not allowed' })
}
