const crypto = require('crypto')

function generateToken(matchId) {
  const secret = process.env.SCORE_SECRET || 'cornhole-score'
  return crypto.createHmac('sha256', secret).update(String(matchId)).digest('hex').slice(0, 12)
}

function scoreToken(matchId) {
  return `${matchId}-${generateToken(matchId)}`
}

function verifyToken(raw) {
  if (!raw || typeof raw !== 'string') return null
  const dash = raw.lastIndexOf('-')
  if (dash === -1) return null
  const matchId = raw.slice(0, dash)
  const hash = raw.slice(dash + 1)
  if (hash !== generateToken(matchId)) return null
  return Number(matchId)
}

async function propagateByes(supabase, T) {
  for (let pass = 0; pass < 20; pass++) {
    const { data: allMatches } = await supabase.from(`${T}_matches`).select('*')
    if (!allMatches) break
    const matchMap = Object.fromEntries(allMatches.map(m => [m.id, { ...m }]))
    let changed = false

    for (const m of allMatches) {
      if (m.status !== 'complete' || !m.winner_id || !m.next_match_id) continue
      const next = matchMap[m.next_match_id]
      if (!next || next.status === 'complete') continue
      const slotField = m.next_slot === 1 ? 'team1_id' : 'team2_id'
      if (!next[slotField]) {
        await supabase.from(`${T}_matches`).update({ [slotField]: m.winner_id }).eq('id', m.next_match_id)
        next[slotField] = m.winner_id
        changed = true
      }
    }

    const allMaps = Object.values(matchMap)
    for (const next of allMaps) {
      if (next.status === 'complete') continue
      if (next.team1_id && next.team2_id) continue
      const feedersFor = (slotNum) => allMaps.filter(f =>
        (f.next_match_id === next.id && f.next_slot === slotNum) ||
        (f.loser_next_match_id === next.id && f.loser_next_slot === slotNum)
      )
      const slot1Settled = !!next.team1_id || feedersFor(1).every(f => f.status === 'complete')
      const slot2Settled = !!next.team2_id || feedersFor(2).every(f => f.status === 'complete')
      if (slot1Settled && slot2Settled) {
        const winnerId = next.team1_id || next.team2_id || null
        await supabase.from(`${T}_matches`).update({ winner_id: winnerId, status: 'complete', is_bye: true }).eq('id', next.id)
        next.winner_id = winnerId; next.status = 'complete'; next.is_bye = true
        changed = true
      }
    }

    if (!changed) break
  }
}

async function applyScore(supabase, T, matchId, score1, score2) {
  score1 = Number(score1)
  score2 = Number(score2)
  if (isNaN(score1) || isNaN(score2)) throw { status: 400, error: 'Scores must be numbers.' }
  if (score1 === score2) throw { status: 400, error: 'Scores cannot be tied.' }

  const { data: match, error: me } = await supabase.from(`${T}_matches`).select('*').eq('id', matchId).single()
  if (me || !match) throw { status: 404, error: 'Match not found.' }
  if (!match.team1_id || !match.team2_id) throw { status: 400, error: 'Match does not have two teams yet.' }

  const winner_id = score1 > score2 ? match.team1_id : match.team2_id
  const loser_id  = score1 > score2 ? match.team2_id : match.team1_id

  await supabase.from(`${T}_matches`).update({ score1, score2, winner_id, status: 'complete' }).eq('id', matchId)

  if (match.next_match_id && winner_id) {
    const slot = match.next_slot === 1 ? 'team1_id' : 'team2_id'
    await supabase.from(`${T}_matches`).update({ [slot]: winner_id }).eq('id', match.next_match_id)
  }

  if (match.bracket === 'W' && match.loser_next_match_id && loser_id) {
    const { data: priorWins } = await supabase.from(`${T}_matches`).select('id').eq('winner_id', loser_id).eq('is_bye', false)
    if (!priorWins || priorWins.length === 0) {
      const slot = match.loser_next_slot === 1 ? 'team1_id' : 'team2_id'
      await supabase.from(`${T}_matches`).update({ [slot]: loser_id }).eq('id', match.loser_next_match_id)
    }
  }

  await propagateByes(supabase, T)
}

module.exports = { generateToken, scoreToken, verifyToken, propagateByes, applyScore }
