const { scoreToken } = require('./_bracket')

function normalizePhone(raw) {
  let phone = raw.replace(/\D/g, '')
  if (phone.length === 10) phone = '1' + phone
  else if (phone.length === 11 && !phone.startsWith('1')) phone = '1' + phone
  if (!phone.startsWith('+')) phone = '+' + phone
  return phone
}

async function notifyNextMatches(supabase, T, { next_match_id, loser_next_match_id }, host) {
  const ids = [next_match_id, loser_next_match_id].filter(Boolean)
  if (!ids.length) return

  const { data: nextMatches } = await supabase
    .from(`${T}_matches`)
    .select('id, bracket, round, is_bye, status, team1:team1_id(id,name,phone), team2:team2_id(id,name,phone)')
    .in('id', ids)

  const ready = (nextMatches || []).filter(m => m.team1?.id && m.team2?.id && m.status === 'pending' && !m.is_bye)
  if (!ready.length) return

  const { Vonage } = require('@vonage/server-sdk')
  const vonage = new Vonage({ apiKey: process.env.VONAGE_API_KEY, apiSecret: process.env.VONAGE_API_SECRET })
  const from = process.env.VONAGE_FROM_NUMBER || 'Cornhole'
  const eventName = process.env.EVENT_NAME || 'Tournament'

  for (const match of ready) {
    const url = `https://${host}/score.html?token=${scoreToken(match.id)}`
    const bracketLabel = match.bracket === 'W' ? 'Main Bracket' : 'Consolation'

    for (const team of [match.team1, match.team2].filter(t => t?.phone)) {
      const opponent = team.id === match.team1.id ? match.team2.name : match.team1.name
      const text = `${eventName} — Your next match is ready! ${bracketLabel} Round ${match.round} vs ${opponent}. Submit your score: ${url}`
      await vonage.sms.send({ to: normalizePhone(team.phone), from, text }).catch(() => {})
    }
  }
}

module.exports = { notifyNextMatches }
