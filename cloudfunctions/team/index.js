/**
 * 队伍（Team）—— 与场次（Session）是两层，不要混：
 *   队伍 = 长期的小圈子，有名字、有固定时间、成员稳定
 *   场次 = 一次性约跑，跑完即散
 * 前端把这两件事做在同一个按钮上是产品级的错误，见 PRD 4.2。
 *
 * 动作：create / join / list
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_CREATE_PER_DAY = 3

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  const action = event.action || 'list'
  if (action === 'create') return create(OPENID, event)
  if (action === 'join') return join(OPENID, event)
  return list(event)
}

async function create(openid, event) {
  const now = Date.now()
  const city = event.city || '深圳'
  const name = String(event.name || '').trim()

  if (!name) return { ok: false, error: 'no_name' }
  if (name.length > 20) return { ok: false, error: 'name_too_long' }

  const safe = await checkText(name)
  if (!safe.ok) return { ok: false, error: safe.error }

  const dayStart = startOfDay(now)
  const mine = await db
    .collection('teams')
    .where({ owner: openid, created_at: _.gte(dayStart) })
    .limit(MAX_CREATE_PER_DAY + 1)
    .get()
  if (mine.data.length >= MAX_CREATE_PER_DAY) return { ok: false, error: 'daily_limit' }

  const res = await db.collection('teams').add({
    data: {
      name,
      city,
      owner: openid,
      member_count: 1,
      usual_km: Number(event.usual_km) || 5,
      run_window: String(event.run_window || '').slice(0, 30),
      join_mode: event.join_mode === 'approval' ? 'approval' : 'free',
      created_at: now
    }
  })

  await db.collection('team_members').add({
    data: { team_id: res._id, user_id: openid, status: 'joined', joined_at: now }
  })

  return { ok: true, teamId: res._id }
}

async function join(openid, event) {
  const teamId = event.team_id
  if (!teamId) return { ok: false, error: 'no_team' }

  const t = await db.collection('teams').doc(teamId).get().catch(() => null)
  if (!t || !t.data) return { ok: false, error: 'not_found' }

  const exist = await db
    .collection('team_members')
    .where({ team_id: teamId, user_id: openid })
    .limit(1)
    .get()
  if (exist.data.length) return { ok: true, status: exist.data[0].status }

  // 队长审核的队伍只记录申请，不进成员数
  const status = t.data.join_mode === 'approval' ? 'pending' : 'joined'

  await db.collection('team_members').add({
    data: { team_id: teamId, user_id: openid, status, joined_at: Date.now() }
  })
  if (status === 'joined') {
    await db.collection('teams').doc(teamId).update({ data: { member_count: _.inc(1) } })
  }
  return { ok: true, status }
}

async function list(event) {
  const where = {}
  if (event.city) where.city = event.city

  const res = await db
    .collection('teams')
    .where(where)
    .orderBy('created_at', 'desc')
    .limit(20)
    .get()

  return {
    ok: true,
    teams: res.data.map((t) => ({
      _id: t._id,
      name: t.name,
      city: t.city,
      member_count: t.member_count || 0,
      usual_km: t.usual_km || 0,
      run_window: t.run_window || '',
      join_mode: t.join_mode || 'free'
    }))
  }
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function checkText(text) {
  if (!text) return { ok: true }
  try {
    await cloud.openapi.security.msgSecCheck({ content: String(text).slice(0, 500) })
    return { ok: true }
  } catch (e) {
    const code = e && (e.errCode || e.errcode)
    if (code === 87014) return { ok: false, error: 'risky_content' }
    console.warn('[同频跑] msgSecCheck 不可用，本次放行', e)
    return { ok: true, degraded: true }
  }
}
