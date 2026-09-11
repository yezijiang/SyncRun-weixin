/**
 * 场次状态机 —— 「此刻正在奔跑」的唯一数据来源（PRD 4.1.1）
 *
 * 纯小程序拿不到任何实时在线数据，所以「正在跑」不能靠在线状态，
 * 只能由场次推导：
 *
 *   正在跑 = 已加入某场
 *          AND 当前时间 ∈ [开始时间, 开始时间 + 宽限期]
 *          AND 尚未打卡
 *
 * 好处是它永远是真的：冷启动时只有 3 个人在跑，就显示 3 个人，
 * 不会像写死 128 那样被一眼识破。副作用是它把「加入场次」变成了刚需。
 */

const DEFAULT_GRACE_MINUTES = 90

/**
 * 判断某人此刻是否处于「正在跑」
 * @param {{checkin_id?: string, left_at?: number}} member
 * @param {{start_time: number, grace_minutes?: number, status?: string}} session
 * @param {number} now
 */
function isRunning(member, session, now) {
  if (!member || !session) return false
  if (session.status === 'cancelled') return false
  if (member.left_at) return false // 已取消参加
  if (member.checkin_id) return false // 已打卡，不再算正在跑

  const grace = (session.grace_minutes || DEFAULT_GRACE_MINUTES) * 60 * 1000
  const start = session.start_time
  return now >= start && now <= start + grace
}

/**
 * 汇总一场的状态：加入 / 完成 / 正在跑
 * @returns {{joined:number, done:number, running:number, runningMembers:Array}}
 */
function summarize(session, members, now = Date.now()) {
  const list = members || []
  const runningMembers = list.filter((m) => isRunning(m, session, now))
  return {
    joined: list.filter((m) => !m.left_at).length,
    done: list.filter((m) => m.checkin_id).length,
    running: runningMembers.length,
    runningMembers
  }
}

/**
 * 全站「此刻 N 人正在跑」——跨所有进行中的场次去重后计数
 */
function countRunningNow(sessions, membersBySession, now = Date.now()) {
  const seen = new Set()
  ;(sessions || []).forEach((s) => {
    const members = membersBySession[s._id] || []
    members.forEach((m) => {
      if (isRunning(m, s, now)) seen.add(m.user_id)
    })
  })
  return seen.size
}

/**
 * 打卡有宽限期，但「今天跑过」是当日累计，口径不同，不要混用。
 * 这个函数给首页大数字用。
 */
function countCheckedInToday(checkins, now = Date.now()) {
  const d = new Date(now)
  const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  const seen = new Set()
  ;(checkins || []).forEach((c) => {
    if (!c.created_at) return
    const cd = new Date(c.created_at)
    const ck = `${cd.getFullYear()}-${cd.getMonth() + 1}-${cd.getDate()}`
    if (ck === key) seen.add(c.user_id)
  })
  return seen.size
}

module.exports = { isRunning, summarize, countRunningNow, countCheckedInToday, DEFAULT_GRACE_MINUTES }
