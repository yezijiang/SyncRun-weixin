/**
 * 数据访问层。
 *
 * 设计约束：
 *   1. 页面只跟这一层打交道，不直接写 wx.cloud.database()，也不直接 import mock。
 *   2. 云开发未就绪（没填 AppID）时自动降级到 mock，保证骨架随时可点。
 *   3. 所有跨用户可见的查询，都必须过 excludeBlocked() —— 双向屏蔽是 P0，
 *      不能靠每个页面自觉。
 */

const mock = require('./mock')
const { summarize, countRunningNow, countCheckedInToday } = require('./session')

function app() {
  return getApp()
}

function cloudOn() {
  const a = app()
  return !!(a && a.globalData && a.globalData.cloudReady && wx.cloud)
}

function coll(name) {
  return wx.cloud.database().collection(name)
}

/**
 * 双向屏蔽过滤（PRD 9.4）
 * 单向屏蔽会让屏蔽功能变成跟踪工具，所以两个方向都要排除。
 */
function excludeBlocked(items, me, idKey = 'user_id') {
  const mine = (me && me.blocked_ids) || []
  if (!mine.length) return items
  const blockedSet = new Set(mine)
  return items.filter((it) => !blockedSet.has(it[idKey]))
}

/* ---------------- 首页 ---------------- */

async function getHome() {
  if (!cloudOn()) return homeFromMock()

  try {
    const [sessions, cityStats] = await Promise.all([
      coll('sessions').where({ status: 'open' }).orderBy('start_time', 'asc').limit(10).get(),
      coll('city_stats').limit(20).get()
    ])

    // 场次成员：v1 单城、场次少，可一次性取回；量上来后换成按 session_id 聚合的云函数
    const ids = sessions.data.map((s) => s._id)
    const members = ids.length
      ? await coll('session_members').where({ session_id: wx.cloud.database().command.in(ids) }).get()
      : { data: [] }

    const bySession = groupBy(members.data, 'session_id')
    const runningNow = countRunningNow(sessions.data, bySession)

    const todayCheckins = await coll('checkins').orderBy('created_at', 'desc').limit(500).get()
    const todayRunners = countCheckedInToday(todayCheckins.data)

    return {
      sessions: sessions.data.map((s) => Object.assign({}, s, summarize(s, bySession[s._id]))),
      cities: cityStats.data,
      todayRunners,
      runningNow,
      source: 'cloud'
    }
  } catch (e) {
    console.warn('[同频跑] 首页云端读取失败，降级 mock', e)
    return homeFromMock()
  }
}

function homeFromMock() {
  const bySession = mock.SESSION_MEMBERS
  const sessions = mock.SESSIONS.map((s) => Object.assign({}, s, summarize(s, bySession[s._id])))
  return {
    sessions,
    cities: mock.CITY_STATS,
    todayRunners: countCheckedInToday(mock.CHECKINS),
    runningNow: countRunningNow(mock.SESSIONS, bySession),
    // mock 里人数太少，首页大数字用城市统计兜底，保持演示观感
    todayRunnersDisplay: mock.CITY_STATS[0].runner_count,
    source: 'mock'
  }
}

/* ---------------- 场次 ---------------- */

async function joinSession(sessionId, userId) {
  if (!cloudOn()) return { ok: true, source: 'mock' }
  const now = Date.now()
  const exist = await coll('session_members').where({ session_id: sessionId, user_id: userId }).get()
  if (exist.data.length) {
    // 之前取消过的话，重新加入即清除 left_at，别人看不到「已退出」痕迹
    await coll('session_members').doc(exist.data[0]._id).update({ data: { left_at: null, joined_at: now } })
    return { ok: true }
  }
  await coll('session_members').add({ data: { session_id: sessionId, user_id: userId, joined_at: now } })
  return { ok: true }
}

async function leaveSession(sessionId, userId) {
  if (!cloudOn()) return { ok: true, source: 'mock' }
  const res = await coll('session_members').where({ session_id: sessionId, user_id: userId }).get()
  if (res.data.length) {
    await coll('session_members').doc(res.data[0]._id).update({ data: { left_at: Date.now() } })
  }
  return { ok: true }
}

async function createSession(payload) {
  if (!cloudOn()) return { ok: true, _id: 'local-' + Date.now(), source: 'mock' }
  const res = await coll('sessions').add({
    data: Object.assign(
      {
        status: 'open',
        grace_minutes: 90,
        city: app().globalData.city,
        created_at: Date.now()
      },
      payload
    )
  })
  return { ok: true, _id: res._id }
}

async function cancelSession(sessionId) {
  if (!cloudOn()) return { ok: true, source: 'mock' }
  await coll('sessions').doc(sessionId).update({ data: { status: 'cancelled', cancelled_at: Date.now() } })
  return { ok: true }
}

/* ---------------- 打卡 ---------------- */

async function submitCheckin(payload, userId) {
  if (!cloudOn()) return { ok: true, _id: 'local-' + Date.now(), source: 'mock' }

  const now = Date.now()
  const res = await coll('checkins').add({
    data: Object.assign(
      { user_id: userId, created_at: now, source: 'manual' },
      payload
    )
  })

  if (payload.session_id) {
    const sm = await coll('session_members')
      .where({ session_id: payload.session_id, user_id: userId })
      .get()
    if (sm.data.length) {
      await coll('session_members').doc(sm.data[0]._id).update({ data: { checkin_id: res._id } })
    }
  }

  // 打卡自动生成一条社区内可见的动态（PRD 9.2：默认社区内可见，不提供"全部公开"开关）
  await coll('posts').add({
    data: {
      user_id: userId,
      type: 'checkin',
      checkin_id: res._id,
      session_id: payload.session_id || '',
      content: payload.note || '',
      images: payload.screenshot_url ? [payload.screenshot_url] : [],
      visibility: 'community',
      cheer_count: 0,
      comment_count: 0,
      created_at: now
    }
  })

  return { ok: true, _id: res._id }
}

/* ---------------- 动态 ---------------- */

async function getFeed(me) {
  if (!cloudOn()) return feedFromMock(me)
  const res = await coll('posts')
    .where({ visibility: 'community' })
    .orderBy('created_at', 'desc')
    .limit(30)
    .get()
  return excludeBlocked(res.data, me)
}

function feedFromMock(me) {
  const users = indexBy(mock.USERS, '_id')
  return excludeBlocked(mock.POSTS, me).map((p) =>
    Object.assign({}, p, { author: users[p.user_id] })
  )
}

async function cheerPost(postId, userId) {
  if (!cloudOn()) return { ok: true, source: 'mock' }
  await coll('cheers').add({ data: { target_type: 'post', target_id: postId, from_user: userId, created_at: Date.now() } })
  const cmd = wx.cloud.database().command
  await coll('posts').doc(postId).update({ data: { cheer_count: cmd.inc(1) } })
  return { ok: true }
}

/* ---------------- 搜索：活动 / 跑友 / 队伍 ---------------- */

async function search(kind, keyword, me) {
  if (!cloudOn()) return searchMock(kind, keyword, me)
  const db = wx.cloud.database()
  const re = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })

  if (kind === 'session') {
    const r = await coll('sessions').where({ title: re, status: 'open' }).limit(20).get()
    return r.data
  }
  if (kind === 'team') {
    const r = await coll('teams').where({ name: re }).limit(20).get()
    return r.data
  }
  // 跑友：只有开启「允许被搜索」的人才出现在结果里
  const r = await coll('users').where({ nickname: re, searchable: true }).limit(20).get()
  return excludeBlocked(r.data, me, '_id')
}

function searchMock(kind, keyword, me) {
  const kw = (keyword || '').trim()
  const hit = (s) => !kw || String(s).indexOf(kw) >= 0
  if (kind === 'session') return mock.SESSIONS.filter((s) => hit(s.title))
  if (kind === 'team') return []
  return excludeBlocked(mock.USERS.filter((u) => hit(u.nickname)), me, '_id')
}

/* ---------------- 我的 ---------------- */

async function getMe(userId) {
  if (!cloudOn()) {
    const checkins = mock.CHECKINS.filter((c) => c.user_id === userId)
    return aggregate(checkins)
  }
  const res = await coll('checkins').where({ user_id: userId }).orderBy('created_at', 'desc').limit(300).get()
  return Object.assign(aggregate(res.data), { records: res.data })
}

function aggregate(checkins) {
  const totalKm = checkins.reduce((a, c) => a + (c.distance_km || 0), 0)
  const longest = checkins.reduce((a, c) => Math.max(a, c.distance_km || 0), 0)
  return {
    totalKm,
    totalCount: checkins.length,
    longest,
    records: checkins
  }
}

/* ---------------- 工具 ---------------- */

function groupBy(list, key) {
  return (list || []).reduce((acc, it) => {
    const k = it[key]
    ;(acc[k] = acc[k] || []).push(it)
    return acc
  }, {})
}

function indexBy(list, key) {
  return (list || []).reduce((acc, it) => {
    acc[it[key]] = it
    return acc
  }, {})
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  getHome,
  getFeed,
  getMe,
  search,
  joinSession,
  leaveSession,
  createSession,
  cancelSession,
  submitCheckin,
  cheerPost,
  excludeBlocked
}
