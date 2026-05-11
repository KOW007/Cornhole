const { scoreToken } = require('./_bracket')

function normalizePhone(raw) {
  let phone = raw.replace(/\D/g, '')
  if (phone.length === 10) phone = '1' + phone
  else if (phone.length === 11 && !phone.startsWith('1')) phone = '1' + phone
  if (!phone.startsWith('+')) phone = '+' + phone
  return phone
}

async function sendSms(to, text) {
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: to, message: text, key: process.env.TEXTBELT_KEY })
  })
  return res.json()
}

async function markReadyMatches(supabase, T) {
  await supabase.from(`${T}_matches`)
    .update({ ready_at: new Date().toISOString() })
    .eq('status', 'pending')
    .eq('is_bye', false)
    .not('team1_id', 'is', null)
    .not('team2_id', 'is', null)
    .is('ready_at', null)
}

async function checkAndAssignStations(supabase, T, host) {
  const { data: waiting } = await supabase
    .from(`${T}_matches`)
    .select('id, bracket, round, team1:team1_id(id,name,phone), team2:team2_id(id,name,phone)')
    .eq('status', 'pending')
    .eq('is_bye', false)
    .is('station', null)
    .not('team1_id', 'is', null)
    .not('team2_id', 'is', null)
    .not('ready_at', 'is', null)
    .order('ready_at', { ascending: true })

  if (!waiting?.length) return

  const { data: stationedMatches } = await supabase
    .from(`${T}_matches`)
    .select('status, station')
    .not('station', 'is', null)

  if (!stationedMatches?.length) return

  const pendingStations = new Set(
    stationedMatches.filter(m => m.status === 'pending').map(m => m.station)
  )
  const available = [...new Set(
    stationedMatches
      .filter(m => m.status === 'complete' && !pendingStations.has(m.station))
      .map(m => m.station)
  )].sort((a, b) => a - b)

  if (!available.length) return

  const eventName = process.env.EVENT_NAME || 'Tournament'
  const pairs = Math.min(available.length, waiting.length)

  for (let i = 0; i < pairs; i++) {
    const station = available[i]
    const match = waiting[i]

    await supabase.from(`${T}_matches`).update({ station }).eq('id', match.id)

    const url = `https://${host}/score.html?token=${scoreToken(match.id)}`
    const label = match.bracket === 'L' ? 'Consolation ' : ''

    for (const team of [match.team1, match.team2].filter(t => t?.phone)) {
      const opponent = team.id === match.team1.id ? match.team2.name : match.team1.name
      const text = `${eventName} — ${label}Station ${station} vs ${opponent}. Score: ${url}`
      await sendSms(normalizePhone(team.phone), text).catch(() => {})
    }
  }
}

module.exports = { sendSms, normalizePhone, markReadyMatches, checkAndAssignStations }
