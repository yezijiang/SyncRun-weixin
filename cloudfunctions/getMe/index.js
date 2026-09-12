/**
 * 「我的」数据聚合 + 昵称修改。
 *
 * 为什么聚合放在云函数：checkins 是「仅创建者可读写」，前端能读自己的，
 * 但一次最多 20 条，累计里程会算少。云函数一次最多取 1000 条。
 *
 * 不返回 openid，也不返回别人的任何信息。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_RECORDS = 500

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  if (event.action === 'rename') return rename(OPENID, event)
  if (event.action === 'settings') return settings(OPENID)
  if (event.action === 'setSearchable') return setSearchable(OPENID, event)
  if (event.action === 'deleteAccount') return deleteAccount(OPENID)
  return aggregate(OPENID)
}

/** 设置页：可被搜索的开关 + 屏蔽名单（名单里的人要能解除） */
async function settings(openid) {
  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  const blockedIds = me.data[0].blocked_ids || []
  let blocked = []
  if (blockedIds.length) {
    const res = await db
      .collection('users')
      .where({ openid: _.in(blockedIds) })
      .limit(100)
      .get()
    blocked = res.data.map((u) => ({
      id: u._id,
      nickname: u.nickname || '已注销的跑友',
      gradient: u.gradient || ['#7C5CFF', '#4CC9F0']
    }))
  }

  return {
    ok: true,
    searchable: me.data[0].searchable !== false,
    blocked
  }
}

async function setSearchable(openid, event) {
  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  const searchable = event.searchable !== false
  await db.collection('users').doc(me.data[0]._id).update({ data: { searchable } })
  return { ok: true, searchable }
}

/**
 * 注销：删掉这个人留下的全部内容。
 *
 * 举报记录不删。它是别人用来保护自己的凭证，不能因为被举报者注销就消失；
 * 而且 reporter 字段是 openid，账号删掉之后它就是一串无意义的字符。
 */
async function deleteAccount(openid) {
  const owned = ['checkins', 'posts', 'session_members', 'team_members', 'achievements']
  for (const name of owned) {
    await purge(name, { user_id: openid })
  }
  await purge('cheers', { from_user: openid })

  // 别人名单里对我的屏蔽，注销后也要摘掉，否则会残留一串永远匹配不上的 openid
  await db
    .collection('users')
    .where({ blocked_ids: openid })
    .update({ data: { blocked_ids: _.pull(openid) } })
    .catch((e) => console.warn('[同频跑] 清理他人屏蔽名单失败', e))

  await db.collection('users').where({ openid }).remove()

  // 城市统计是累计值，不倒扣：一个人的离开不该让城市数字往回跳
  return { ok: true }
}

/** 分批删干净，单次 remove 有上限，一次删不完会留下孤儿数据 */
async function purge(collection, where) {
  for (let i = 0; i < 20; i++) {
    const r = await db.collection(collection).where(where).limit(1000).remove()
    if (!r || !r.stats || r.stats.removed === 0) return
  }
}

async function aggregate(openid) {
  const res = await db
    .collection('checkins')
    .where({ user_id: openid })
    .orderBy('created_at', 'desc')
    .limit(MAX_RECORDS)
    .get()

  const list = res.data
  const totalKm = list.reduce((a, c) => a + (c.distance_km || 0), 0)
  const longest = list.reduce((a, c) => Math.max(a, c.distance_km || 0), 0)

  const me = await db.collection('users').where({ openid }).limit(1).get()
  const profile = me.data[0] || {}

  return {
    ok: true,
    totalKm: Math.round(totalKm * 100) / 100,
    totalCount: list.length,
    longest: Math.round(longest * 100) / 100,
    streakDays: streak(list),
    cities: Array.from(new Set(list.map((c) => c.city).filter(Boolean))),
    // 前端只取最近 20 条渲染，全量留在服务端
    records: list.slice(0, 20).map((c) => ({
      _id: c._id,
      distance_km: c.distance_km,
      duration_s: c.duration_s,
      pace_auto: c.pace_auto,
      city: c.city,
      note: c.note,
      created_at: c.created_at
    })),
    achievements: achievements(list, totalKm, longest),
    profile: {
      nickname: profile.nickname || '匿名跑者',
      gradient: profile.gradient || ['#7C5CFF', '#4CC9F0'],
      city: profile.city || '深圳',
      searchable: profile.searchable !== false
    }
  }
}

async function rename(openid, event) {
  const nickname = String(event.nickname || '').trim()
  if (!nickname) return { ok: false, error: 'empty_nickname' }
  if (nickname.length > 20) return { ok: false, error: 'nickname_too_long' }

  const safe = await checkText(nickname)
  if (!safe.ok) return { ok: false, error: safe.error }

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  await db.collection('users').doc(me.data[0]._id).update({
    data: { nickname, nickname_custom: true }
  })
  return { ok: true, nickname }
}

/** 连续打卡天数：按自然日去重后往前数 */
function streak(list) {
  const days = new Set(list.map((c) => startOfDay(c.created_at)))
  let n = 0
  let cursor = startOfDay(Date.now())
  // 今天还没跑不算断，从昨天开始倒推
  if (!days.has(cursor)) cursor -= 86400000
  while (days.has(cursor)) {
    n += 1
    cursor -= 86400000
  }
  return n
}

function achievements(list, totalKm, longest) {
  const days = new Set(list.map((c) => startOfDay(c.created_at)))
  let s = 0
  let cursor = startOfDay(Date.now())
  if (!days.has(cursor)) cursor -= 86400000
  while (days.has(cursor)) {
    s += 1
    cursor -= 86400000
  }

  return [
    { code: 'first', name: '第一次打卡', got: list.length >= 1 },
    { code: 'streak7', name: '连续 7 天', got: s >= 7 },
    { code: 'city1', name: '点亮第一座城市', got: new Set(list.map((c) => c.city)).size >= 1 },
    { code: 'km100', name: '累计 100KM', got: totalKm >= 100 },
    { code: 'half', name: '第一次半马', got: longest >= 21.1 }
  ]
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
