/**
 * 场次状态汇总 + 首页数据（PRD 4.1.1，UI v2.2 口径修订）。
 *
 * 首页两个核心数字：
 *   「本时段 X 人同场开跑」= 同一开跑时段（整点桶）场次的去重报名人数。
 *     这是约定而非实测——我们不用实时定位，也无法知道谁此刻真的在跑，
 *     前端必须把推算方式写在数字旁。
 *   场次卡上的「正在跑 X」仍是状态机推导：
 *     已加入某场 AND now ∈ [start_time, start_time + grace_minutes]
 *     AND 尚未打卡 AND 未退出（left_at 为空）。
 *
 * 数字永远是真的。冷启动只有 3 个人就返回 3，
 * 不会像写死「128 人正在奔跑」那样被一眼识破。
 *
 * 同时强制过双向屏蔽：A 屏蔽 B 或 B 屏蔽 A，双方都不出现在彼此的列表里
 * （PRD 9.4）。单向屏蔽会让屏蔽功能变成跟踪工具，所以必须两个方向都算。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_GRACE_MINUTES = 90

// v1 只点亮深圳，其余作为「未点亮」展示，制造向往感（PRD 4.1）
// 扩城时把这个列表挪到数据库，不要在这里越加越长
const PLANNED_CITIES = ['上海', '成都', '北京', '广州', '杭州']

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const now = Date.now()
  const city = event.city || '深圳'

  const dayStart = startOfDay(now)

  // 超过宽限期的场次视为已结束，不再出现在列表里。
  // 不做这一步的话，上周发起的一场会永远挂在首页，第一眼就露馅。
  const earliestAlive = now - DEFAULT_GRACE_MINUTES * 60 * 1000

  const [sessionsRes, statsRes, todayCheckinsRes] = await Promise.all([
    db
      .collection('sessions')
      .where({ city, status: 'open', start_time: _.gte(earliestAlive) })
      .orderBy('start_time', 'asc')
      .limit(20)
      .get(),
    db.collection('city_stats').where({ date: _.gte(dayStart) }).limit(50).get(),
    db.collection('checkins').where({ city, created_at: _.gte(dayStart) }).field({ user_id: true, distance_km: true }).limit(2000).get()
  ])

  const sessions = sessionsRes.data

  // 我的屏蔽名单 + 屏蔽了我的人 = 双向不可见
  const blockedBoth = await getMutualBlocks(OPENID)

  let bySession = {}
  if (sessions.length) {
    const ids = sessions.map((s) => s._id)
    const members = await db
      .collection('session_members')
      .where({ session_id: _.in(ids) })
      .limit(1000)
      .get()
    bySession = groupBy(members.data, 'session_id')
  }

  const result = sessions.map((s) => {
    const live = (bySession[s._id] || []).filter((m) => !blockedBoth.has(m.user_id))
    return {
      _id: s._id,
      title: s.title,
      start_time: s.start_time,
      target_km: s.target_km,
      pace_range: s.pace_range,
      mode: s.mode || 'online',
      poi_name: s.poi_name || '',
      is_official: !!s.is_official,
      joined: live.filter((m) => !m.left_at).length,
      done: live.filter((m) => !!m.checkin_id).length,
      running: live.filter((m) => isRunning(m, s, now)).length,
      // 我是否加入了这场，供前端渲染「已加入」状态
      iJoined: live.some((m) => m.user_id === OPENID && !m.left_at),
      // 我在这场是否已打卡：我的页「我报名的活动」要区分 已完成 / 待打卡
      iDone: live.some((m) => m.user_id === OPENID && !!m.checkin_id),
      // 是否我发起的：只有发起者能取消，前端据此决定要不要显示取消入口
      isMine: s.created_by === OPENID
    }
  })

  // 首页统计条里「收到鼓励」与「连续跑步」是本人的数据，只能在这里一起算：
  // posts 与 cheers 都是仅管理端可读写，前端拿不到
  const [cheerReceived, streakDays] = await Promise.all([
    countCheerReceived(OPENID),
    countStreak(OPENID)
  ])

  const runningUserSet = new Set()
  sessions.forEach((s) => {
    ;(bySession[s._id] || []).forEach((m) => {
      if (!blockedBoth.has(m.user_id) && isRunning(m, s, now)) runningUserSet.add(m.user_id)
    })
  })

  // 「本时段 X 位跑友和你同场开跑」（UI v2.2 口径）：
  // = 加入「开跑时间落在同一整点时段」场次的去重报名人数。
  // 它是约定，不是实测——我们不用实时定位，也无法知道谁此刻真的在跑，
  // 所以前端必须把推算方式写在数字旁边（PRD 4.1.1 修订）。
  const slot = slotRunners(sessions, bySession, blockedBoth, now)

  // 首页统计条：今日跑量 / 今日完成人数，均为累计口径（不是「此刻」）
  const todayKm = todayCheckinsRes.data.reduce((a, c) => a + (c.distance_km || 0), 0)
  const todayRunnersSet = new Set(todayCheckinsRes.data.map((c) => c.user_id))

  // 点亮城市：有统计数据的算已点亮，其余用 PLANNED_CITIES 补成灰色卡
  const litCities = statsRes.data.map((s) => ({
    city: s.city,
    lit: true,
    runner_count: s.runner_count || 0,
    total_km: Math.round((s.total_km || 0) * 10) / 10
  }))
  const litNames = new Set(litCities.map((c) => c.city))
  const planned = PLANNED_CITIES.filter((c) => !litNames.has(c)).map((c) => ({
    city: c,
    lit: false,
    runner_count: 0,
    total_km: 0
  }))

  return {
    ok: true,
    sessions: result,
    cities: litCities.concat(planned),
    // 「今天」与「本时段」是两个不同口径，前端必须分开显示
    todayRunners: todayRunnersSet.size,
    todayKm: Math.round(todayKm * 10) / 10,
    runningNow: runningUserSet.size,
    slotRunners: slot.runners,
    slotTime: slot.slotTime,
    // 本人的两项，只跟自己有关，但也只能云端算
    cheerReceived,
    streakDays,
    city,
    serverTime: now
  }
}

/** 我发的动态收到的鼓励总数。没有动态就是 0，不编数字 */
async function countCheerReceived(openid) {
  if (!openid) return 0

  const mine = await db.collection('posts').where({ user_id: openid }).field({ _id: true }).limit(100).get()
  const ids = mine.data.map((p) => p._id)
  if (!ids.length) return 0

  const res = await db
    .collection('cheers')
    .where({ target_type: 'post', target_id: _.in(ids) })
    .field({ _id: true })
    .limit(1000)
    .get()
  return res.data.length
}

/** 连续打卡天数：按自然日去重后往前数，今天没跑不算断 */
async function countStreak(openid) {
  if (!openid) return 0

  const res = await db
    .collection('checkins')
    .where({ user_id: openid })
    .orderBy('created_at', 'desc')
    .field({ created_at: true })
    .limit(500)
    .get()

  const days = new Set(res.data.map((c) => startOfDay(c.created_at)))
  let n = 0
  let cursor = startOfDay(Date.now())
  if (!days.has(cursor)) cursor -= 86400000
  while (days.has(cursor)) {
    n += 1
    cursor -= 86400000
  }
  return n
}

/**
 * 双向屏蔽集合：我屏蔽的人 + 屏蔽了我的人。
 * 注意 users 集合是「仅管理端可读写」，所以只能在云函数里查。
 */
async function getMutualBlocks(openid) {
  if (!openid) return new Set()

  const me = await db.collection('users').where({ openid }).limit(1).get()
  const myBlocks = (me.data[0] && me.data[0].blocked_ids) || []

  const blockedBy = await db
    .collection('users')
    .where({ blocked_ids: openid })
    .field({ openid: true })
    .limit(1000)
    .get()

  const set = new Set(myBlocks)
  blockedBy.data.forEach((u) => set.add(u.openid))
  return set
}

/**
 * 「同场开跑」口径（UI v2.2/v2.4）：同一开跑时段（整点桶）场次的去重报名人数。
 * 当前时段没有场次时，取最近一场尚未开跑的场次所在时段。
 */
function slotRunners(sessions, bySession, blockedBoth, now) {
  const list = sessions.filter((s) => s.status !== 'cancelled')
  if (!list.length) return { slotTime: 0, runners: 0 }

  const hourStart = (ts) => {
    const d = new Date(ts)
    d.setMinutes(0, 0, 0)
    return d.getTime()
  }

  const curSlot = hourStart(now)
  const inCur = list.filter((s) => hourStart(s.start_time) === curSlot)
  let slotTime
  if (inCur.length) {
    slotTime = curSlot
  } else {
    const upcoming = list
      .filter((s) => s.start_time >= curSlot)
      .sort((a, b) => a.start_time - b.start_time)[0]
    if (!upcoming) return { slotTime: 0, runners: 0 }
    slotTime = hourStart(upcoming.start_time)
  }

  const seen = new Set()
  list.forEach((s) => {
    if (hourStart(s.start_time) !== slotTime) return
    ;(bySession[s._id] || []).forEach((m) => {
      if (!m.left_at && !blockedBoth.has(m.user_id)) seen.add(m.user_id)
    })
  })
  return { slotTime, runners: seen.size }
}

function isRunning(member, session, now) {
  if (session.status === 'cancelled') return false
  if (member.left_at) return false
  if (member.checkin_id) return false
  const grace = (session.grace_minutes || DEFAULT_GRACE_MINUTES) * 60 * 1000
  return now >= session.start_time && now <= session.start_time + grace
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function groupBy(list, key) {
  return (list || []).reduce((acc, it) => {
    ;(acc[it[key]] = acc[it[key]] || []).push(it)
    return acc
  }, {})
}
