/**
 * 本地 mock 数据。
 * 存在的唯一目的：AppID 还没填、云开发没就绪时，工程依然能在开发者工具里点着走。
 * 注意口径：所有数字都遵守 PRD 4.1.1 —— 「今天」是累计真数，「此刻」由状态机推导。
 */

const MIN = 60 * 1000
const HOUR = 60 * MIN

function base(offsetMinutes) {
  // 以「最近的 20:00」为锚点构造场次时间，保证演示时「正在跑」不为空
  const now = new Date()
  const anchor = new Date(now)
  anchor.setHours(20, 0, 0, 0)
  return anchor.getTime() + offsetMinutes * MIN
}

const USERS = [
  { _id: 'u1', nickname: '深圳 · 夜跑者 No.107', gradient: ['#FF4D6D', '#FF9F1C'], city: '深圳' },
  { _id: 'u2', nickname: '深圳 · 晨跑者 No.233', gradient: ['#06D6A0', '#4CC9F0'], city: '深圳' },
  { _id: 'u3', nickname: '深圳 · 慢跑者 No.458', gradient: ['#4CC9F0', '#9B5DE5'], city: '深圳' },
  { _id: 'u4', nickname: '深圳 · 绕圈跑者 No.312', gradient: ['#FFD166', '#06D6A0'], city: '深圳' },
  { _id: 'u5', nickname: '深圳 · 河堤跑者 No.619', gradient: ['#9B5DE5', '#FF4D6D'], city: '深圳' }
]

const SESSIONS = [
  {
    _id: 's1',
    title: '同频跑之夜 · 5KM 轻松跑',
    start_time: base(0),
    target_km: 5,
    pace_range: "5'30–6'30",
    capacity: 30,
    city: '深圳',
    mode: 'online',
    is_official: true,
    status: 'open',
    grace_minutes: 90
  },
  {
    _id: 's2',
    title: '深圳湾公园 8KM',
    start_time: base(60 * 14),
    target_km: 8,
    pace_range: "5'00–6'00",
    capacity: 12,
    city: '深圳',
    mode: 'offline',
    poi_name: '深圳湾公园 · 婚庆广场入口',
    is_official: false,
    status: 'open',
    grace_minutes: 90
  },
  {
    _id: 's3',
    title: '莲花山 10KM 拉练',
    start_time: base(60 * 38),
    target_km: 10,
    pace_range: "5'30–6'30",
    capacity: 15,
    city: '深圳',
    mode: 'offline',
    poi_name: '莲花山公园 · 南门',
    is_official: false,
    status: 'open',
    grace_minutes: 90
  }
]

// 场次成员：s1 里前两人打了卡、后两人还在跑，用来演示三种状态
const SESSION_MEMBERS = {
  s1: [
    { _id: 'sm1', session_id: 's1', user_id: 'u1', joined_at: base(-30), checkin_id: 'c1' },
    { _id: 'sm2', session_id: 's1', user_id: 'u2', joined_at: base(-25), checkin_id: 'c2' },
    { _id: 'sm3', session_id: 's1', user_id: 'u3', joined_at: base(-20) },
    { _id: 'sm4', session_id: 's1', user_id: 'u4', joined_at: base(-18) },
    { _id: 'sm5', session_id: 's1', user_id: 'u5', joined_at: base(-15) }
  ],
  s2: [
    { _id: 'sm6', session_id: 's2', user_id: 'u5', joined_at: base(-10) }
  ],
  s3: []
}

const CHECKINS = [
  { _id: 'c1', user_id: 'u1', session_id: 's1', distance_km: 5.23, duration_s: 1771, created_at: base(-5) },
  { _id: 'c2', user_id: 'u2', session_id: 's1', distance_km: 5.05, duration_s: 1682, created_at: base(-3) }
]

const POSTS = [
  {
    _id: 'p1',
    user_id: 'u1',
    type: 'checkin',
    checkin_id: 'c1',
    content: '今天风很好，沿着海边跑完了 5 公里。',
    visibility: 'community',
    cheer_count: 24,
    comment_count: 3,
    created_at: base(-5)
  },
  {
    _id: 'p2',
    user_id: 'u2',
    type: 'invite',
    session_id: 's2',
    content: '周六早上深圳湾 8KM，来一起？',
    visibility: 'community',
    cheer_count: 9,
    comment_count: 2,
    created_at: base(-120)
  },
  {
    _id: 'p3',
    user_id: 'u3',
    type: 'feeling',
    content: '最近状态一般，但今天还是出门跑了。',
    visibility: 'community',
    cheer_count: 31,
    comment_count: 6,
    created_at: base(-300)
  }
]

const CITY_STATS = [
  { city: '深圳', lit: true, runner_count: 128, total_km: 328.6 }
]

module.exports = { USERS, SESSIONS, SESSION_MEMBERS, CHECKINS, POSTS, CITY_STATS }
