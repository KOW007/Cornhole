const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ─── Bracket structure for 64-team double elimination ───────────────────────
// WB: R1(32) R2(16) R3(8) R4(4) R5(2) R6(1)  → IDs 1-63
// LB: R1(16) R2(16) R3(8) R4(8) R5(4) R6(4) R7(2) R8(2) R9(1) R10(1) → IDs 64-125
// GF: 1 match → ID 126

function buildMatchStructure() {
  const matches = []
  let id = 1

  // Pre-assign IDs for WB
  const wb = {}
  const WB_ROUNDS = 6
  for (let r = 1; r <= WB_ROUNDS; r++) {
    wb[r] = {}
    const count = 64 / Math.pow(2, r)
    for (let p = 0; p < count; p++) wb[r][p] = id++
  }

  // Pre-assign IDs for LB
  const LB_COUNTS = [16, 16, 8, 8, 4, 4, 2, 2, 1, 1]
  const lb = {}
  for (let r = 1; r <= 10; r++) {
    lb[r] = {}
    for (let p = 0; p < LB_COUNTS[r - 1]; p++) lb[r][p] = id++
  }

  const GF_ID = id++ // 126

  // WB loser drops into which LB round (and position rules)
  const WB_LOSER_TO_LB = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 8, 6: 10 }

  // Generate WB matches
  for (let r = 1; r <= WB_ROUNDS; r++) {
    const count = 64 / Math.pow(2, r)
    for (let p = 0; p < count; p++) {
      const next_match_id = r < WB_ROUNDS ? wb[r + 1][Math.floor(p / 2)] : GF_ID
      const next_slot = r < WB_ROUNDS ? (p % 2) + 1 : 1

      let loser_next_match_id, loser_next_slot
      if (r === 1) {
        loser_next_match_id = lb[1][Math.floor(p / 2)]
        loser_next_slot = (p % 2) + 1
      } else if (r === WB_ROUNDS) {
        loser_next_match_id = lb[10][0]
        loser_next_slot = 2
      } else {
        loser_next_match_id = lb[WB_LOSER_TO_LB[r]][p]
        loser_next_slot = 2
      }

      matches.push({
        id: wb[r][p], bracket: 'W', round: r, position: p,
        team1_id: null, team2_id: null, score1: null, score2: null, winner_id: null,
        next_match_id, next_slot, loser_next_match_id, loser_next_slot,
        status: 'pending', is_bye: false
      })
    }
  }

  // Generate LB matches
  for (let r = 1; r <= 10; r++) {
    const count = LB_COUNTS[r - 1]
    for (let p = 0; p < count; p++) {
      let next_match_id, next_slot
      if (r === 10) {
        next_match_id = GF_ID; next_slot = 2
      } else if (r % 2 === 1) {
        // Odd: one-to-one into next round slot 1
        next_match_id = lb[r + 1][p]; next_slot = 1
      } else {
        // Even: halving consolidation
        next_match_id = lb[r + 1][Math.floor(p / 2)]; next_slot = (p % 2) + 1
      }
      matches.push({
        id: lb[r][p], bracket: 'L', round: r, position: p,
        team1_id: null, team2_id: null, score1: null, score2: null, winner_id: null,
        next_match_id, next_slot, loser_next_match_id: null, loser_next_slot: null,
        status: 'pending', is_bye: false
      })
    }
  }

  // Grand Final
  matches.push({
    id: GF_ID, bracket: 'G', round: 1, position: 0,
    team1_id: null, team2_id: null, score1: null, score2: null, winner_id: null,
    next_match_id: null, next_slot: null, loser_next_match_id: null, loser_next_slot: null,
    status: 'pending', is_bye: false
  })

  return matches
}

function assignTeams(matches, teams) {
  // Pad to 64 with nulls (byes)
  const slots = [...teams]
  while (slots.length < 64) slots.push(null)

  // Shuffle
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]]
  }

  const r1 = matches.filter(m => m.bracket === 'W' && m.round === 1)
  r1.forEach((match, i) => {
    match.team1_id = slots[i * 2]?.id || null
    match.team2_id = slots[i * 2 + 1]?.id || null
    if (!match.team1_id || !match.team2_id) {
      match.is_bye = true
      match.status = 'complete'
      match.winner_id = match.team1_id || match.team2_id
    }
  })

  // Propagate bye winners into next rounds
  let changed = true
  while (changed) {
    changed = false
    for (const m of matches) {
      if (m.status === 'complete' && m.winner_id && m.next_match_id) {
        const next = matches.find(x => x.id === m.next_match_id)
        if (!next) continue
        const slot = m.next_slot === 1 ? 'team1_id' : 'team2_id'
        if (!next[slot]) {
          next[slot] = m.winner_id
          // If next match now has both slots filled and is a bye, auto-complete
          if (next.bracket === 'W' && (!next.team1_id || !next.team2_id) &&
              (next.team1_id || next.team2_id)) {
            next.is_bye = true
            next.status = 'complete'
            next.winner_id = next.team1_id || next.team2_id
          }
          changed = true
        }
      }
    }
  }

  return matches
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('ct_matches')
      .select(`*, team1:team1_id(id,name,player1,player2), team2:team2_id(id,name,player1,player2), winner:winner_id(id,name)`)
      .order('bracket').order('round').order('position')
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  // Admin required for POST and PUT
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'POST') {
    const { data: teams, error: te } = await supabase
      .from('ct_teams').select('*').order('registered_at')
    if (te) return res.status(500).json({ error: te.message })
    if (teams.length < 2) return res.status(400).json({ error: 'Need at least 2 teams.' })

    await supabase.from('ct_matches').delete().gte('id', 0)

    let matches = buildMatchStructure()
    matches = assignTeams(matches, teams)

    const { error: ie } = await supabase.from('ct_matches').insert(matches)
    if (ie) return res.status(500).json({ error: ie.message })

    await supabase.from('ct_settings').upsert({ key: 'bracket_created', value: 'true' })
    return res.json({ success: true, matchCount: matches.length })
  }

  if (req.method === 'PUT') {
    const { match_id, score1, score2 } = req.body
    if (match_id == null || score1 == null || score2 == null)
      return res.status(400).json({ error: 'match_id, score1, score2 required' })
    if (score1 === score2)
      return res.status(400).json({ error: 'Scores cannot be tied.' })

    const { data: match, error: me } = await supabase
      .from('ct_matches').select('*').eq('id', match_id).single()
    if (me || !match) return res.status(404).json({ error: 'Match not found' })
    if (!match.team1_id || !match.team2_id)
      return res.status(400).json({ error: 'Match does not have two teams yet.' })

    const winner_id = score1 > score2 ? match.team1_id : match.team2_id
    const loser_id = score1 > score2 ? match.team2_id : match.team1_id

    await supabase.from('ct_matches')
      .update({ score1, score2, winner_id, status: 'complete' })
      .eq('id', match_id)

    if (match.next_match_id && winner_id) {
      const slot = match.next_slot === 1 ? 'team1_id' : 'team2_id'
      await supabase.from('ct_matches')
        .update({ [slot]: winner_id }).eq('id', match.next_match_id)
    }

    if (match.bracket === 'W' && match.loser_next_match_id && loser_id) {
      const slot = match.loser_next_slot === 1 ? 'team1_id' : 'team2_id'
      await supabase.from('ct_matches')
        .update({ [slot]: loser_id }).eq('id', match.loser_next_match_id)
    }

    return res.json({ success: true })
  }

  if (req.method === 'DELETE') {
    await supabase.from('ct_matches').delete().gte('id', 0)
    await supabase.from('ct_settings').upsert({ key: 'bracket_created', value: 'false' })
    return res.json({ success: true })
  }

  res.status(405).json({ error: 'Method not allowed' })
}
