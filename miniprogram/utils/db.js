/**
 * 数据访问层。
 *
 * 三条设计约束：
 *   1. 页面只跟这一层打交道，不直接写 wx.cloud.database()，也不直接 import mock。
 *   2. 跨用户读取一律走云函数。不是风格问题：小程序端一次最多取 20 条，
 *      而且「仅管理端可读写」的集合前端根本读不到，直连只会拿到空数组。
 *   3. 云函数还没部署时，读操作降级到 mock 保证界面可点，写操作如实失败——
 *      写了却没生效比报错更糟，那种问题要花一整晚才查得出来。
 *
 * 双向屏蔽（PRD 9.4）在云函数里做（feed / search / sessionStatus），
 * 这里只在 mock 路径上保留一份，目的是本地预览时行为一致。
 */

const mock = require('./mock')
const { summarize, countRunningNow, countCheckedInToday } = require('./session')

// 云函数不可用（未部署 / 网络失败）时的统一返回，页面据此提示而不是假装成功
const UNAVAILABLE = { ok: false, error: 'cloud_unavailable' }

function app() {
  return getApp()
}

function city() {
  const a = app()
  return (a && a.globalData && a.globalData.city) || '深圳'
}

function cloudOn() {
  const a = app()
  return !!(a && a.globalData && a.globalData.cloudReady && wx.cloud)
}

/**
 * 调用云函数。
 * @returns 成功返回结果对象；云端不可用返回 null；业务校验失败返回 { ok:false, error }
 */
async function call(name, data) {
  if (!cloudOn()) return null
  try {
    const res = await wx.cloud.callFunction({ name, data })
    const r = res && res.result
    if (!r) {
      console.warn('[同频跑] 云函数返回为空：' + name)
      return null
    }
    if (r.ok === false) {
      // 业务拒绝（内容违规、超出每日上限等），把原因带给页面
      console.warn('[同频跑] 云函数拒绝：' + name, r.error)
      return r
    }
    return r
  } catch (e) {
    console.warn('[同频跑] 云函数调用失败（多半是还没部署）：' + name, e)
    return null
  }
}

/** 写操作的统一收口：云端不可用时给出可提示的失败，绝不假装成功 */
function written(r) {
  return r && r.ok ? { ok: true, ...r } : Object.assign({}, UNAVAILABLE, r || {})
}

/* ---------------- 首页 ---------------- */

async function getHome() {
  const r = await call('sessionStatus', { city: city() })
  if (!r) return homeFromMock()

  return {
    sessions: r.sessions || [],
    cities: r.cities || [],
    todayRunners: r.todayRunners || 0,
    todayKm: r.todayKm || 0,
    runningNow: r.runningNow || 0,
    source: 'cloud'
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

async function joinSession(sessionId) {
  return written(await call('sessionAction', { action: 'join', session_id: sessionId }))
}

async function leaveSession(sessionId) {
  return written(await call('sessionAction', { action: 'leave', session_id: sessionId }))
}

async function createSession(payload) {
  const r = await call('sessionAction', Object.assign({ action: 'create', city: city() }, payload))
  return written(r)
}

async function cancelSession(sessionId) {
  return written(await call('sessionAction', { action: 'cancel', session_id: sessionId }))
}

/* ---------------- 打卡 ---------------- */

async function submitCheckin(payload) {
  const r = await call(
    'checkin',
    Object.assign({ city: city(), source: 'manual' }, payload)
  )
  return written(r)
}

/* ---------------- 动态 ---------------- */

async function getFeed(me) {
  const r = await call('feed', {})
  if (!r) return feedFromMock(me)
  return r.posts || []
}

function feedFromMock(me) {
  const users = indexBy(mock.USERS, '_id')
  return excludeBlocked(mock.POSTS, me).map((p) =>
    Object.assign({}, p, { author: users[p.user_id] })
  )
}

async function cheerPost(postId) {
  return written(await call('interact', { action: 'cheer', target_id: postId }))
}

async function reportPost(postId, reason) {
  return written(
    await call('interact', {
      action: 'report',
      target_type: 'post',
      target_id: postId,
      reason: reason || ''
    })
  )
}

/**
 * 屏蔽：传 users 记录 _id，不是 openid。
 * 对外流通的只能是 _id——把别人的 openid 送到客户端是隐私事故。
 */
async function blockUser(userId) {
  return written(await call('interact', { action: 'block', target_user_id: userId }))
}

async function unblockUser(userId) {
  return written(await call('interact', { action: 'unblock', target_user_id: userId }))
}

/* ---------------- 搜索：活动 / 跑友 / 队伍 ---------------- */

async function search(kind, keyword, me) {
  const r = await call('search', { kind, keyword: keyword || '', city: city() })
  if (!r) return searchMock(kind, keyword, me)
  return r.results || []
}

function searchMock(kind, keyword, me) {
  const kw = (keyword || '').trim()
  const hit = (s) => !kw || String(s).indexOf(kw) >= 0
  if (kind === 'session') return mock.SESSIONS.filter((s) => hit(s.title))
  if (kind === 'team') return []
  return excludeBlocked(mock.USERS.filter((u) => hit(u.nickname)), me, '_id')
}

/* ---------------- 队伍 ---------------- */

async function listTeams() {
  const r = await call('team', { action: 'list', city: city() })
  return (r && r.teams) || []
}

async function createTeam(payload) {
  return written(await call('team', Object.assign({ action: 'create', city: city() }, payload)))
}

async function joinTeam(teamId) {
  return written(await call('team', { action: 'join', team_id: teamId }))
}

/* ---------------- 我的 ---------------- */

async function getMe() {
  const r = await call('getMe', {})
  if (!r) return meFromMock()
  return r
}

async function renameNickname(nickname) {
  return written(await call('getMe', { action: 'rename', nickname }))
}

function meFromMock() {
  const checkins = mock.CHECKINS
  const totalKm = checkins.reduce((a, c) => a + (c.distance_km || 0), 0)
  return {
    totalKm,
    totalCount: checkins.length,
    longest: checkins.reduce((a, c) => Math.max(a, c.distance_km || 0), 0),
    streakDays: 0,
    cities: ['深圳'],
    records: checkins.slice(0, 20),
    achievements: [],
    source: 'mock'
  }
}

/* ---------------- 工具 ---------------- */

/**
 * 双向屏蔽过滤（PRD 9.4）。
 * 云函数里才是真正的执行点，这里只服务 mock 路径与本地预览。
 */
function excludeBlocked(items, me, idKey = 'user_id') {
  const mine = (me && me.blocked_ids) || []
  if (!mine.length) return items
  const blockedSet = new Set(mine)
  return items.filter((it) => !blockedSet.has(it[idKey]))
}

function indexBy(list, key) {
  return (list || []).reduce((acc, it) => {
    acc[it[key]] = it
    return acc
  }, {})
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
  reportPost,
  blockUser,
  unblockUser,
  listTeams,
  createTeam,
  joinTeam,
  renameNickname,
  excludeBlocked,
  UNAVAILABLE
}
