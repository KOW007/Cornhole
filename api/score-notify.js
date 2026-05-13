const { createClient } = require('@supabase/supabase-js')
const { scoreToken } = require('./_bracket')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const T = process.env.TABLE_PREFIX || 'ct'

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' })

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { match_id } = req.body
  if (!match_id) return res.status(400).json({ error: 'match_id required' })

  const { data: match, error } = await supabase
    .from(`${T}_matches`)
    .select(`*, team1:team1_id(id,name,phone), team2:team2_id(id,name,phone)`)
    .eq('id', match_id)
    .single()

  if (error || !match) return res.status(404).json({ error: 'Match not found.' })
  if (!match.team1_id || !match.team2_id)
    return res.status(400).json({ error: 'Match does not have two teams yet.' })

  const host = req.headers['x-forwarded-host'] || req.headers.host
  const url = `https://${host}/score.html?token=${scoreToken(match_id)}`

  if (req.body.link_only) return res.json({ success: true, url })

  const bracketLabel = match.bracket === 'W' ? 'Main Bracket' : 'Consolation'
  const eventName = process.env.EVENT_NAME || 'SAS Cornhole Tournament'
  const message = `${eventName} — ${bracketLabel} Round ${match.round}: ${match.team1.name} vs ${match.team2.name}. Submit your score: ${url}`

  const { sendSms, normalizePhone } = require('./_notify')
  const teams = [match.team1, match.team2].filter(t => t?.phone)
  const results = { sent: 0, failed: 0, sentList: [], failedList: [] }

  for (const team of teams) {
    try {
      const resp = await sendSms(normalizePhone(team.phone), message)
      if (resp.success) { results.sent++; results.sentList.push(team.name) }
      else { results.failed++; results.failedList.push(team.name) }
    } catch {
      results.failed++; results.failedList.push(team.name)
    }
  }

  return res.json({ success: true, url, ...results })
}
