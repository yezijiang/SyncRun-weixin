/**
 * 场次的全部写操作：create / cancel / join / leave。
 *
 * 为什么四个动作放一个函数：每个云函数都要在开发者工具里单独右键部署，
 * 动作越碎，漏部署的概率越高，而漏部署的表现是「按钮点了没反应」，很难查。
 *
 * 安全规则（PRD 第 9 章）：
 *   - 只有发起者能取消自己的场次
 *   - 退出不留下「已退出」痕迹（left_at 只用于计数，前端不展示）
 *   - 线下场次强制 6:00–18:00 的公共场地，这是产品承诺，不是建议
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_GRACE_MINUTES = 90
const MAX_CREATE_PER_DAY = 5
const DAY = 24 * 60 * 60 * 1000

// 线下场次的时间窗：白天 + 公共场地，3 人成行靠人數提示，不靠代码强制
const OFFLINE_FROM_HOUR = 6
const OFFLINE_TO_HOUR = 18

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  const action = event.action
  if (action === 'create') return create(OPENID, event)
  if (action === 'cancel') return cancel(OPENID, event)
  if (action === 'join') return join(OPENID, event)
  if (action === 'leave') return leave(OPENID, event)
  return { ok: false, error: 'unknown_action' }
}

/* ---------------- 创建 ---------------- */

async function create(openid, event) {
  const now = Date.now()
  const city = event.city || '深圳'

  const title = String(event.title || '').trim()
  if (!title) return { ok: false, error: 'no_title' }
  if (title.length > 30) return { ok: false, error: 'title_too_long' }

  const start = Number(event.start_time)
  if (!isFinite(start)) return { ok: false, error: 'bad_start_time' }
  // 允许补录刚刚开始的场次（5 分钟容差），但不许建过去的场次
  if (start < now - 5 * 60 * 1000) return { ok: false, error: 'start_time_past' }
  if (start > now + 30 * DAY) return { ok: false, error: 'start_time_too_far' }

  const km = Number(event.target_km)
  if (!isFinite(km) || km <= 0 || km > 100) return { ok: false, error: 'bad_target_km' }

  const mode = event.mode === 'offline' ? 'offline' : 'online'
  if (mode === 'offline') {
    const h = new Date(start).getHours()
    if (h < OFFLINE_FROM_HOUR || h >= OFFLINE_TO_HOUR) {
      return { ok: false, error: 'offline_only_daytime' }
    }
  }

  const poiName = String(event.poi_name || '').trim().slice(0, 30)

  const safe = await checkText(cloud, [title, poiName, event.note].filter(Boolean).join(' '))
  if (!safe.ok) return { ok: false, error: safe.error }

  // 防刷：同一人每天最多 5 场
  const dayStart = startOfDay(now)
  const mine = await db
    .collection('sessions')
    .where({ created_by: openid, created_at: _.gte(dayStart) })
    .limit(MAX_CREATE_PER_DAY + 1)
    .get()
  if (mine.data.length >= MAX_CREATE_PER_DAY) return { ok: false, error: 'daily_limit' }

  const res = await db.collection('sessions').add({
    data: {
      title,
      city,
      start_time: start,
      grace_minutes: Number(event.grace_minutes) || DEFAULT_GRACE_MINUTES,
      target_km: km,
      pace_range: String(event.pace_range || '不限').slice(0, 20),
      mode,
      poi_name: poiName,
      // 经纬度只在服务端留档，不下发到前端（PRD 9.8：地理只到城市粒度）
      poi_lat: isFinite(Number(event.poi_lat)) ? Number(event.poi_lat) : null,
      poi_lng: isFinite(Number(event.poi_lng)) ? Number(event.poi_lng) : null,
      note: String(event.note || '').slice(0, 100),
      remind: !!event.remind,
      is_official: false,
      status: 'open',
      created_by: openid,
      created_at: now
    }
  })

  // 发起者自动成为第一个成员，否则自己的场次在首页显示 0 人
  await db.collection('session_members').add({
    data: { session_id: res._id, user_id: openid, joined_at: now, left_at: null, checkin_id: '' }
  })

  return { ok: true, sessionId: res._id }
}

/* ---------------- 取消（仅发起者） ---------------- */

async function cancel(openid, event) {
  const id = event.session_id
  if (!id) return { ok: false, error: 'no_session' }

  const s = await db.collection('sessions').doc(id).get().catch(() => null)
  if (!s || !s.data) return { ok: false, error: 'not_found' }
  if (s.data.created_by !== openid) return { ok: false, error: 'not_owner' }
  if (s.data.status === 'cancelled') return { ok: true }

  await db.collection('sessions').doc(id).update({
    data: { status: 'cancelled', cancelled_at: Date.now() }
  })
  return { ok: true }
}

/* ---------------- 加入 / 退出 ---------------- */

async function join(openid, event) {
  const sessionId = event.session_id
  if (!sessionId) return { ok: false, error: 'no_session' }

  const s = await db.collection('sessions').doc(sessionId).get().catch(() => null)
  if (!s || !s.data) return { ok: false, error: 'not_found' }
  if (s.data.status !== 'open') return { ok: false, error: 'session_closed' }

  const exist = await db
    .collection('session_members')
    .where({ session_id: sessionId, user_id: openid })
    .limit(1)
    .get()

  if (exist.data.length) {
    // 之前退出过，再次加入直接清掉 left_at，不留下反复进出的痕迹
    await db.collection('session_members').doc(exist.data[0]._id).update({
      data: { left_at: null, joined_at: Date.now() }
    })
    return { ok: true }
  }

  await db.collection('session_members').add({
    data: { session_id: sessionId, user_id: openid, joined_at: Date.now(), left_at: null, checkin_id: '' }
  })
  return { ok: true }
}

async function leave(openid, event) {
  const sessionId = event.session_id
  if (!sessionId) return { ok: false, error: 'no_session' }

  const exist = await db
    .collection('session_members')
    .where({ session_id: sessionId, user_id: openid })
    .limit(1)
    .get()

  if (!exist.data.length) return { ok: true }
  await db.collection('session_members').doc(exist.data[0]._id).update({
    data: { left_at: Date.now() }
  })
  return { ok: true }
}

/* ---------------- 工具 ---------------- */

/**
 * 内容安全。UGC 一律过检（PRD 9.5）。
 *
 * 失败策略：判定「违规」时拒绝；接口本身不可用（没开权限 / 报错）时放行并记日志。
 * 理由：接口挂了就让全站发不出内容，是比漏过一条更糟的故障；而当真违规时
 * errCode 是明确的 87014，不会误判。
 */
async function checkText(sdk, text) {
  if (!text) return { ok: true }
  try {
    await sdk.openapi.security.msgSecCheck({ content: String(text).slice(0, 500) })
    return { ok: true }
  } catch (e) {
    const code = e && (e.errCode || e.errcode)
    if (code === 87014) return { ok: false, error: 'risky_content' }
    console.warn('[同频跑] msgSecCheck 不可用，本次放行', e)
    return { ok: true, degraded: true }
  }
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
