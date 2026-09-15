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

// 头像色板，与 miniprogram/utils/identity.js 一致，改动要同步两边
const GRADIENTS = [
  ['#FF4D6D', '#FF9F1C'],
  ['#FF9F1C', '#FFD166'],
  ['#FFD166', '#06D6A0'],
  ['#06D6A0', '#4CC9F0'],
  ['#4CC9F0', '#9B5DE5'],
  ['#9B5DE5', '#FF4D6D'],
  ['#7C5CFF', '#4CC9F0'],
  ['#0F6E56', '#06D6A0']
]

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  if (event.action === 'rename') return rename(OPENID, event)
  if (event.action === 'settings') return settings(OPENID)
  if (event.action === 'setSearchable') return setSearchable(OPENID, event)
  if (event.action === 'setGradient') return setGradient(OPENID, event)
  if (event.action === 'setCity') return setCity(OPENID, event)
  if (event.action === 'setAvatar') return setAvatar(OPENID, event)
  if (event.action === 'clearAvatar') return clearAvatar(OPENID)
  if (event.action === 'setGender') return setGender(OPENID, event)
  if (event.action === 'deleteAccount') return deleteAccount(OPENID)
  return aggregate(OPENID)
}

/**
 * 换头像。头像是 openid 哈希出来的渐变色块，不含任何真实信息，
 * 所以让用户自己挑一个完全没问题——换的只是配色，不是身份本身。
 * 只接受预设色板里的值，不接受任意颜色，避免出现刺眼的配色。
 */
async function setGradient(openid, event) {
  const palette = GRADIENTS.map((g) => g.join(','))
  const value = event.gradient
  if (!Array.isArray(value) || value.length !== 2) return { ok: false, error: 'bad_gradient' }
  if (palette.indexOf(value.join(',')) < 0) return { ok: false, error: 'gradient_not_allowed' }

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  await db.collection('users').doc(me.data[0]._id).update({ data: { gradient: value } })
  return { ok: true, gradient: value }
}

/**
 * 换成微信头像。
 *
 * 这是用户主动点的，不是我们自动拉来的——默认身份永远是生成式的几何色块，
 * 只有用户自己决定"我要用真头像"才会走到这里。差别很大：
 * 自动填充等于逼用户在第一次打开时就回答"要不要出柜"，主动选择是他自己的决定。
 *
 * 头像存云存储（微信给的是临时链接，会失效），fileID 存进 users。
 */
async function setAvatar(openid, event) {
  const fileId = String(event.file_id || '').trim()
  if (!fileId) return { ok: false, error: 'no_file' }

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  // 图片安全尽力而为：mediaCheckAsync 是异步的，真要拦住需要在控制台配置
  // 内容安全回调。这里只在能拿到明确结论时拒绝，不阻塞用户换头像。
  await checkImage(fileId)

  await db.collection('users').doc(me.data[0]._id).update({
    data: { avatar_file_id: fileId, avatar_at: Date.now() }
  })
  return { ok: true, fileId }
}

/** 换回生成式头像。只清字段，不删云存储里的图片——留着能一键换回来 */
async function clearAvatar(openid) {
  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  await db.collection('users').doc(me.data[0]._id).update({
    data: { avatar_file_id: '' }
  })
  return { ok: true }
}

/**
 * 性别自填。微信早已不提供这个字段，只能让用户自己说。
 * 必须保留「不愿说」——对这群用户来说，被要求勾选性别本身就是一种压力。
 */
async function setGender(openid, event) {
  const allowed = ['male', 'female', 'nonbinary', 'unspecified']
  const gender = allowed.indexOf(event.gender) >= 0 ? event.gender : 'unspecified'

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  await db.collection('users').doc(me.data[0]._id).update({ data: { gender } })
  return { ok: true, gender }
}

async function checkImage(fileId) {
  try {
    const url = await cloud.getTempFileURL({ fileList: [fileId] })
    const temp = url.fileList && url.fileList[0] && url.fileList[0].tempFileURL
    if (!temp) return
    await cloud.openapi.security.mediaCheckAsync({ media_url: temp, media_type: 2 })
  } catch (e) {
    const code = e && (e.errCode || e.errcode)
    if (code === 87014) throw e
    // 没开权限或接口异常时放行，不让安全校验变成换头像的拦路虎
    console.warn('[同频跑] 图片安全校验不可用，本次放行', e)
  }
}

/** 切换城市。城市是数据字段，换城市后首页场次与统计都按新城市过滤 */
async function setCity(openid, event) {
  const city = String(event.city || '').trim().slice(0, 20)
  if (!city) return { ok: false, error: 'no_city' }

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  await db.collection('users').doc(me.data[0]._id).update({ data: { city } })
  return { ok: true, city }
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
    avatar_file_id: me.data[0].avatar_file_id || '',
    gender: me.data[0].gender || 'unspecified',
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
      // 用户主动换的微信头像（云存储 fileID）。为空就是还在用生成式头像
      avatar_file_id: profile.avatar_file_id || '',
      gender: profile.gender || 'unspecified',
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
