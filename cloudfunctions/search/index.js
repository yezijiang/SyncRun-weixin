/**
 * 搜索：活动 / 跑友 / 队伍 三档。
 *
 * 跑友档的两条规则不能动：
 *   1. 只有 searchable 为 true 的人出现。被人搜到是要自己同意的事，
 *      不能因为注册了就默认可被找到。
 *   2. 不返回 openid，只返回记录 _id。屏蔽、查看都用它，它是无意义的字符串。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const LIMIT = 20

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const kind = event.kind || 'session'
  const kw = String(event.keyword || '').trim()

  if (kind === 'session') return searchSession(kw, event.city)
  if (kind === 'team') return searchTeam(kw, event.city)
  if (kind === 'profile') return getProfile(event.user_id, OPENID)
  return searchFriend(kw, OPENID)
}

/**
 * 跑友主页（UI v2.0）。跨用户读取，只能在这里做。
 *
 * 可见性从三个开关推导，全部尊重：
 *   - 双向屏蔽 → 当作不存在
 *   - 隐身中 / visible_scope=hidden → 明确告诉对方「TA 关闭了主页」，不是 404
 *   - visible_scope=cheered → 只有互相加油过的人能看
 * 隐私边界：不返回 openid、不给精确位置、不返回配速——只有 TA 自己公布的。
 */
async function getProfile(userId, myOpenid) {
  if (!userId) return { ok: false, error: 'no_target' }

  const doc = await db.collection('users').doc(userId).get().catch(() => null)
  if (!doc || !doc.data) return { ok: false, error: 'not_found' }
  const u = doc.data

  const blocked = await getMutualBlocks(myOpenid)
  if (blocked.has(u.openid) || u.openid === myOpenid) return { ok: false, error: 'not_found' }

  if (u.ghost_until && u.ghost_until > Date.now()) return { ok: true, hidden: true }
  const scope = u.visible_scope || 'city'
  if (scope === 'hidden') return { ok: true, hidden: true }
  if (scope === 'cheered') {
    const both = await getCheeredEachOther(myOpenid)
    if (!both.has(u.openid)) return { ok: true, hidden: true }
  }

  const since = Date.now() - 30 * 86400000
  const [checkins, posts] = await Promise.all([
    db.collection('checkins').where({ user_id: u.openid, created_at: _.gte(since) }).field({ distance_km: true, created_at: true }).limit(500).get(),
    db.collection('posts').where({ user_id: u.openid, visibility: 'community' }).orderBy('created_at', 'desc').limit(3).get()
  ])

  const totalKm = Math.round(checkins.data.reduce((a, c) => a + (c.distance_km || 0), 0) * 10) / 10

  return {
    ok: true,
    profile: {
      id: u._id,
      nickname: u.nickname || '匿名跑者',
      gradient: u.gradient || ['#7C5CFF', '#4CC9F0'],
      avatar: u.avatar_file_id || '',
      city: u.city || '',
      // 性别只在对方愿意说的时候展示
      gender: u.gender && u.gender !== 'unspecified' ? u.gender : '',
      km30: totalKm,
      runs30: checkins.data.length
    },
    posts: posts.data.map((p) => ({
      _id: p._id,
      content: p.content || '',
      cheer_count: p.cheer_count || 0,
      comment_count: p.comment_count || 0,
      created_at: p.created_at
    }))
  }
}

async function searchSession(kw, city) {
  const where = { status: 'open' }
  if (city) where.city = city
  if (kw) where.title = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' })

  const res = await db
    .collection('sessions')
    .where(where)
    .orderBy('start_time', 'asc')
    .limit(LIMIT)
    .get()

  return {
    ok: true,
    results: res.data.map((s) => ({
      _id: s._id,
      title: s.title,
      target_km: s.target_km,
      pace_range: s.pace_range,
      start_time: s.start_time,
      city: s.city,
      poi_name: s.poi_name || '',
      mode: s.mode || 'online'
    }))
  }
}

async function searchTeam(kw, city) {
  const where = {}
  if (city) where.city = city
  if (kw) where.name = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' })

  const res = await db.collection('teams').where(where).limit(LIMIT).get()

  return {
    ok: true,
    results: res.data.map((t) => ({
      _id: t._id,
      name: t.name,
      city: t.city,
      member_count: t.member_count || 0,
      usual_km: t.usual_km || 0,
      run_window: t.run_window || '',
      join_mode: t.join_mode || 'free'
    }))
  }
}

/**
 * 跑友搜索。除了「可被搜索」开关与双向屏蔽，还必须尊重安全中心的两项设置
 * （UI v2.0）：隐身中的人从搜索里消失；可见范围为「仅互相加油过的人」的，
 * 只对确实互相加油过的人可见。开关不开就没人找得到，这是字面意思。
 */
async function searchFriend(kw, openid) {
  const where = { searchable: true }
  if (kw) where.nickname = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' })

  const res = await db
    .collection('users')
    .where(where)
    .orderBy('created_at', 'desc')
    .limit(LIMIT * 3)
    .get()

  const blocked = await getMutualBlocks(openid)
  const cheeredBoth = await getCheeredEachOther(openid)

  const results = res.data
    .filter((u) => u.openid !== openid)
    .filter((u) => !blocked.has(u.openid))
    // 隐身中：24 小时内从所有推荐与搜索里消失
    .filter((u) => !(u.ghost_until && u.ghost_until > Date.now()))
    .filter((u) => {
      const scope = u.visible_scope || 'city'
      if (scope === 'hidden') return false
      if (scope === 'cheered') return cheeredBoth.has(u.openid)
      return true
    })
    .slice(0, LIMIT)
    .map((u) => ({
      _id: u._id,
      nickname: u.nickname || '匿名跑者',
      gradient: u.gradient || ['#7C5CFF', '#4CC9F0'],
      avatar: u.avatar_file_id || '',
      city: u.city || '',
      usual_km: u.usual_km || 0
    }))

  return { ok: true, results }
}

async function getMutualBlocks(openid) {
  if (!openid) return new Set()

  const me = await db
    .collection('users')
    .where({ openid })
    .field({ blocked_ids: true })
    .limit(1)
    .get()
  const mine = (me.data[0] && me.data[0].blocked_ids) || []

  const blockedBy = await db
    .collection('users')
    .where({ blocked_ids: openid })
    .field({ openid: true })
    .limit(1000)
    .get()

  const set = new Set(mine)
  blockedBy.data.forEach((u) => set.add(u.openid))
  return set
}

/** 与我互相加油过的人：可见范围为「仅互相加油过的人」时的白名单 */
async function getCheeredEachOther(openid) {
  if (!openid) return new Set()
  const set = new Set()

  const [mine, their] = await Promise.all([
    db.collection('cheers').where({ from_user: openid }).limit(300).get(),
    db.collection('posts').where({ user_id: openid }).field({ _id: true }).limit(300).get()
  ])
  const myPostIds = new Set(their.data.map((p) => p._id))

  // 我给别人点过赞的那些动态，作者就是「我加油过的人」
  const postIds = Array.from(new Set(mine.data.map((c) => c.target_id))).slice(0, 300)
  let authorsCheeredByMe = new Set()
  if (postIds.length) {
    const posts = await db.collection('posts').where({ _id: _.in(postIds) }).field({ user_id: true }).limit(300).get()
    authorsCheeredByMe = new Set(posts.data.map((p) => p.user_id))
  }

  // 给我点过赞的人
  let cheeredMe = new Set()
  if (myPostIds.size) {
    const onMine = await db
      .collection('cheers')
      .where({ from_user: _.exists(true), target_id: _.in(Array.from(myPostIds)) })
      .limit(300)
      .get()
    cheeredMe = new Set(onMine.data.map((c) => c.from_user))
  }

  authorsCheeredByMe.forEach((u) => { if (cheeredMe.has(u)) set.add(u) })
  cheeredMe.forEach((u) => { if (authorsCheeredByMe.has(u)) set.add(u) })
  return set
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
