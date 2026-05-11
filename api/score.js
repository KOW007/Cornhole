const { createClient } = require('@supabase/supabase-js')
const { verifyToken, applyScore } = require('./_bracket')
const { notifyNextMatches } = require('./_notify')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const T = process.env.TABLE_PREFIX || 'ct'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const rawToken = req.method === 'GET' ? req.query.token : req.body?.token
  const matchId = verifyToken(rawToken)
  if (matchId == null) return res.status(403).json({ error: 'Invalid or expired link.' })

  if (req.method === 'GET') {
    const { data: match, error } = await supabase
      .from(`${T}_matches`)
      .select(`*, team1:team1_id(id,name), team2:team2_id(id,name)`)
      .eq('id', matchId)
      .single()
    if (error || !match) return res.status(404).json({ error: 'Match not found.' })
    return res.json(match)
  }

  if (req.method === 'POST') {
    const { score1, score2 } = req.body
    try {
      await applyScore(supabase, T, matchId, score1, score2)
      const { data: scored } = await supabase
        .from(`${T}_matches`).select('next_match_id, loser_next_match_id').eq('id', matchId).single()
      if (scored) {
        const host = req.headers['x-forwarded-host'] || req.headers.host
        await notifyNextMatches(supabase, T, scored, host).catch(() => {})
      }
      return res.json({ success: true })
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.error || 'Server error.' })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
