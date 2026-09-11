/**
 * 场次状态汇总 —— 「此刻正在奔跑」的唯一权威来源（PRD 4.1.1）。
 *
 *   正在跑 = 已加入某场
 *          AND now ∈ [start_time, start_time + grace_minutes]
 *          AND 尚未打卡
 *          AND 未退出（left_at 为空）
 *
 * 这样做的好处：数字永远是真的。冷启动只有 3 个人在跑就返回 3，
 * 不会像写死「128 人正在奔跑」那样被一眼识破。
 *
 * 同时返回双向屏蔽后的成员视图：查询他人时，A 屏蔽了 B 或 B 屏蔽了 A，
 * 双方都不应出现在彼此的列表里（PRD 9.4）。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_GRACE_MINUTES = 90

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const now = Date.now()
  const city = event.city || '深圳'

  const sessions = await db
    .collection('sessions')
    .where({ city, status: 'open' })
    .orderBy('start_time', 'asc')
    .limit(20)
    .get()

  if (!sessions.data.length) {
    return { ok: true, sessions: [], runningNow: 0, todayRunners: 0 }
  }

  const ids = sessions.data.map((s) => s._id)
  const members = await db
    .collection('session_members')
    .where({ session_id: _.in(ids) })
    .limit(1000)
    .get()

  const bySession = groupBy(members.data, 'session_id')

  // 取当前用户与相关用户的屏蔽关系
  const me = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const myBlocks = (me.data[0] && me.data[0].blocked_ids) || []
  const relatedIds = uniq(members.data.map((m) => m.user_id))
  const others = relatedIds.length
    ? await db
        .collection('users')
        .where({ openid: _.in(relatedIds) })
        .field({ openid: true, blocked_ids: true })
        .limit(1000)
        .get()
    : { data: [] }

  // 双向屏蔽：A 屏蔽 B 或 B 屏蔽 A，都算互相不可见
  const blockedBoth = new Set(myBlocks)
  others.data.forEach((u) => {
    if ((u.blocked_ids || []).indexOf(OPENID) >= 0) blockedBoth.add(u.openid)
  })

  const visible = members.data.filter((m) => !blockedBoth.has(m.user_id))

  const result = sessions.data.map((s) => {
    const list = bySession[s._id] || []
    const live = list.filter((m) => !blockedBoth.has(m.user_id))
    const running = live.filter((m) => isRunning(m, s, now))
    return {
      _id: s._id,
      title: s.title,
      start_time: s.start_time,
      target_km: s.target_km,
      pace_range: s.pace_range,
      mode: s.mode,
      poi_name: s.poi_name,
      joined: live.filter((m) => !m.left_at).length,
      done: live.filter((m) => !!m.checkin_id).length,
      running: running.length
    }
  })

  const runningUserSet = new Set()
  sessions.data.forEach((s) => {
    ;(bySession[s._id] || []).forEach((m) => {
      if (!blockedBoth.has(m.user_id) && isRunning(m, s, now)) runningUserSet.add(m.user_id)
    })
  })

  // 今日累计打卡人数（与「此刻」是两个不同口径，前端要分开显示）
  const dayStart = startOfDay(now)
  const checkins = await db
    .collection('checkins')
    .where({ city, created_at: _.gte(dayStart) })
    .field({ user_id: true })
    .limit(2000)
    .get()

  return {
    ok: true,
    sessions: result,
    runningNow: runningUserSet.size,
    todayRunners: new Set(checkins.data.map((c) => c.user_id)).size,
    memberCount: visible.length,
    serverTime: now
  }
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

function uniq(arr) {
  return Array.from(new Set(arr))
}
