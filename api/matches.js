const { createClient } = require('@supabase/supabase-js')
const { propagateByes, applyScore } = require('./_bracket')
const { sendSms, normalizePhone, markReadyMatches, checkAndAssignStations } = require('./_notify')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const T = process.env.TABLE_PREFIX || 'ct'

function getBracketSize(teamCount) {
  const sizes = [4, 8, 16, 32, 64, 128]
  return sizes.find(s => s >= teamCount) || 128
}

function buildMatchStructure(bracketSize) {
  const matches = []
  let id = 1

  const WB_ROUNDS = Math.log2(bracketSize)
  // Consolation is single elimination — narrows every round.
  // WB R1 losers seed consolation R1. Consolation slots freed by R1 byes are
  // claimed by WB R2 bye-recipients who lose (their first real loss). See assignTeams.
  const LB_ROUNDS = WB_ROUNDS - 1

  // Pre-assign IDs for WB
  const wb = {}
  for (let r = 1; r <= WB_ROUNDS; r++) {
    wb[r] = {}
    const count = bracketSize / Math.pow(2, r)
    for (let p = 0; p < count; p++) wb[r][p] = id++
  }

  // Pre-assign IDs for LB (single elimination, halves each round)
  // LB Rr has bracketSize / 2^(r+1) matches
  const lb = {}
  for (let r = 1; r <= LB_ROUNDS; r++) {
    lb[r] = {}
    const count = bracketSize / Math.pow(2, r + 1)
    for (let p = 0; p < count; p++) lb[r][p] = id++
  }

  // Generate WB matches
  for (let r = 1; r <= WB_ROUNDS; r++) {
    const count = bracketSize / Math.pow(2, r)
    for (let p = 0; p < count; p++) {
      const next_match_id = r < WB_ROUNDS ? wb[r + 1][Math.floor(p / 2)] : null
      const next_slot = r < WB_ROUNDS ? (p % 2) + 1 : null

      // WB R1 losers → consolation R1. WB R2 loser routing set in assignTeams.
      let loser_next_match_id = null, loser_next_slot = null
      if (r === 1 && LB_ROUNDS > 0) {
        loser_next_match_id = lb[1][Math.floor(p / 2)]
        loser_next_slot = (p % 2) + 1
      }

      matches.push({
        id: wb[r][p], bracket: 'W', round: r, position: p,
        team1_id: null, team2_id: null, score1: null, score2: null, winner_id: null,
        next_match_id, next_slot, loser_next_match_id, loser_next_slot,
        status: 'pending', is_bye: false
      })
    }
  }

  // Generate LB matches (single elimination, halves each round)
  for (let r = 1; r <= LB_ROUNDS; r++) {
    const count = bracketSize / Math.pow(2, r + 1)
    for (let p = 0; p < count; p++) {
      const next_match_id = r < LB_ROUNDS ? lb[r + 1][Math.floor(p / 2)] : null
      const next_slot = r < LB_ROUNDS ? (p % 2) + 1 : null
      matches.push({
        id: lb[r][p], bracket: 'L', round: r, position: p,
        team1_id: null, team2_id: null, score1: null, score2: null, winner_id: null,
        next_match_id, next_slot, loser_next_match_id: null, loser_next_slot: null,
        status: 'pending', is_bye: false
      })
    }
  }

  return matches
}

function assignTeams(matches, teams, bracketSize) {
  const shuffled = [...teams]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const numMatches = bracketSize / 2
  const numRealVsReal = Math.max(0, teams.length - numMatches)

  // Spread real-vs-real matches evenly across R1 positions
  const realPositions = new Set()
  for (let i = 0; i < numRealVsReal; i++) {
    realPositions.add(Math.round(i * numMatches / numRealVsReal))
  }

  const r1 = matches.filter(m => m.bracket === 'W' && m.round === 1).sort((a, b) => a.position - b.position)
  let teamIdx = 0
  r1.forEach((match, i) => {
    match.team1_id = shuffled[teamIdx++]?.id || null
    if (realPositions.has(i)) {
      match.team2_id = shuffled[teamIdx++]?.id || null
    }
    if (!match.team1_id || !match.team2_id) {
      match.is_bye = true
      match.status = 'complete'
      match.winner_id = match.team1_id || match.team2_id
    }
  })

  // Route WB R2 losers to consolation when one of their R1 feeders was a bye.
  // Each bye in R1 frees a consolation R1 slot; the corresponding R2 loser claims it.
  const r2 = matches.filter(m => m.bracket === 'W' && m.round === 2).sort((a, b) => a.position - b.position)
  r2.forEach((r2m, q) => {
    const r1a = r1[2 * q]      // feeds slot 1 of this R2 match
    const r1b = r1[2 * q + 1]  // feeds slot 2 of this R2 match
    if (r1a && r1a.is_bye) {
      // r1a's consolation slot is empty — give it to the R2 loser
      r2m.loser_next_match_id = r1a.loser_next_match_id
      r2m.loser_next_slot = r1a.loser_next_slot
    } else if (r1b && r1b.is_bye) {
      r2m.loser_next_match_id = r1b.loser_next_match_id
      r2m.loser_next_slot = r1b.loser_next_slot
    }
    // If neither R1 feeder was a bye, both teams already had a real loss — R2 loser is eliminated
  })

  // No propagation at creation — teams advance only when scores are entered
  return matches
}


module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from(`${T}_matches`)
      .select(`*, team1:team1_id(id,name,player1,player2), team2:team2_id(id,name,player1,player2), winner:winner_id(id,name)`)
      .order('bracket').order('round').order('position')
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'POST') {
    const { data: teams, error: te } = await supabase
      .from(`${T}_teams`).select('*').order('registered_at')
    if (te) return res.status(500).json({ error: te.message })
    if (teams.length < 2) return res.status(400).json({ error: 'Need at least 2 teams.' })

    const bracketSize = getBracketSize(teams.length)

    await supabase.from(`${T}_matches`).delete().gte('id', 0)

    let matches = buildMatchStructure(bracketSize)
    matches = assignTeams(matches, teams, bracketSize)

    const { error: ie } = await supabase.from(`${T}_matches`).insert(matches)
    if (ie) return res.status(500).json({ error: ie.message })

    await supabase.from(`${T}_settings`).upsert({ key: 'bracket_created', value: 'true' })

    // Assign stations 1-12 to first 12 real R1 matches, queue the rest
    try {
      const { scoreToken } = require('./_bracket')
      const eventName = process.env.EVENT_NAME || 'Tournament'
      const host = req.headers['x-forwarded-host'] || req.headers.host
      const now = new Date().toISOString()
      const MAX_STATIONS = 12

      const { data: r1 } = await supabase
        .from(`${T}_matches`)
        .select('id, position, team1:team1_id(id,name,phone), team2:team2_id(id,name,phone)')
        .eq('bracket', 'W').eq('round', 1).eq('is_bye', false)
        .order('position', { ascending: true })

      for (let i = 0; i < (r1 || []).length; i++) {
        const match = r1[i]
        const station = i < MAX_STATIONS ? i + 1 : null
        await supabase.from(`${T}_matches`)
          .update({ ready_at: now, ...(station ? { station } : {}) })
          .eq('id', match.id)

        if (station) {
          const url = `https://${host}/score.html?token=${scoreToken(match.id)}`
          for (const team of [match.team1, match.team2].filter(t => t?.phone)) {
            const opponent = team.id === match.team1.id ? match.team2?.name : match.team1?.name
            const text = `Welcome to the ${eventName}! Station ${station} vs ${opponent}. Score: ${url}`
            const result = await sendSms(normalizePhone(team.phone), text).catch(err => ({ error: err.message }))
            console.log(`SMS to ${team.name}:`, JSON.stringify(result))
          }
        }
      }
    } catch (e) {
      console.error('SMS bracket notify error:', e.message || e)
    }

    return res.json({ success: true, matchCount: matches.length })
  }

  if (req.method === 'PUT') {
    const { match_id, score1, score2 } = req.body
    if (match_id == null || score1 == null || score2 == null)
      return res.status(400).json({ error: 'match_id, score1, score2 required' })
    try {
      await applyScore(supabase, T, match_id, score1, score2)
      const host = req.headers['x-forwarded-host'] || req.headers.host
      await markReadyMatches(supabase, T).catch(() => {})
      await checkAndAssignStations(supabase, T, host).catch(() => {})
      return res.json({ success: true })
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.error || e.message || 'Server error.' })
    }
  }

  if (req.method === 'DELETE') {
    await supabase.from(`${T}_matches`).delete().gte('id', 0)
    await supabase.from(`${T}_settings`).upsert({ key: 'bracket_created', value: 'false' })
    return res.json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
