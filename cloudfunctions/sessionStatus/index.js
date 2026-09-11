/**
 * 场次状态汇总 + 首页数据 —— 「此刻正在奔跑」的唯一权威来源（PRD 4.1.1）。
 *
 *   正在跑 = 已加入某场
 *          AND now ∈ [start_time, start_time + grace_minutes]
 *          AND 尚未打卡
 *          AND 未退出（left_at 为空）
 *
 * 这样做的好处：数字永远是真的。冷启动只有 3 个人在跑就返回 3，
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

  const [sessionsRes, statsRes, todayCheckinsRes] = await Promise.all([
    db.collection('sessions').where({ city, status: 'open' }).orderBy('start_time', 'asc').limit(20).get(),
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
      // 是否我发起的：只有发起者能取消，前端据此决定要不要显示取消入口
      isMine: s.created_by === OPENID
    }
  })

  const runningUserSet = new Set()
  sessions.forEach((s) => {
    ;(bySession[s._id] || []).forEach((m) => {
      if (!blockedBoth.has(m.user_id) && isRunning(m, s, now)) runningUserSet.add(m.user_id)
    })
  })

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
    // 「今天」与「此刻」是两个不同口径，前端必须分开显示
    todayRunners: todayRunnersSet.size,
    todayKm: Math.round(todayKm * 10) / 10,
    runningNow: runningUserSet.size,
    serverTime: now
  }
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
