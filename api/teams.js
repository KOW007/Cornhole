const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('ct_teams')
      .select('*')
      .order('registered_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  if (req.method === 'POST') {
    const { data: setting } = await supabase
      .from('ct_settings').select('value').eq('key', 'bracket_created').single()
    if (setting?.value === 'true')
      return res.status(400).json({ error: 'Registration is closed — bracket has been created.' })

    const { name, player1, player2, phone } = req.body
    if (!name?.trim() || !player1?.trim() || !player2?.trim() || !phone?.trim())
      return res.status(400).json({ error: 'Team name, both player names, and phone number are required.' })

    const { count } = await supabase
      .from('ct_teams').select('*', { count: 'exact', head: true })
    if (count >= 64)
      return res.status(400).json({ error: 'Tournament is full (64 teams max).' })

    const { data, error } = await supabase
      .from('ct_teams')
      .insert([{ name: name.trim(), player1: player1.trim(), player2: player2.trim(), phone: phone.trim() }])
      .select().single()
    if (error) {
      if (error.code === '23505')
        return res.status(400).json({ error: 'A team with that name is already registered.' })
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  if (req.method === 'DELETE') {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Unauthorized' })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'Team ID required' })
    const { error } = await supabase.from('ct_teams').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
