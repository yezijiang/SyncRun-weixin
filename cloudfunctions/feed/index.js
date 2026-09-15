/**
 * 动态流。
 *
 * 必须在云函数里做，不能前端直连：posts 与 users 都是「仅管理端可读写」。
 * 前端直连的两个后果——一次最多取 20 条，以及读到别人的记录——这里都不存在。
 *
 * 两条硬规则：
 *   1. 双向屏蔽（PRD 9.4）：我屏蔽的、屏蔽了我的，双方都不出现在彼此流里。
 *      只过滤一个方向，屏蔽功能就变成了跟踪工具。
 *   2. 不返回 openid。作者身份只下发生成式的昵称与渐变色，任何情况下
 *      都不把别人的 openid 送到客户端。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PAGE_SIZE = 30

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  const posts = await db
    .collection('posts')
    .where({ visibility: 'community' })
    .orderBy('created_at', 'desc')
    .limit(PAGE_SIZE)
    .get()

  if (!posts.data.length) return { ok: true, posts: [], serverTime: Date.now() }

  const blocked = await getMutualBlocks(OPENID)
  const visible = posts.data.filter((p) => !blocked.has(p.user_id))
  if (!visible.length) return { ok: true, posts: [], serverTime: Date.now() }

  const authorIds = Array.from(new Set(visible.map((p) => p.user_id)))
  const checkinIds = visible.map((p) => p.checkin_id).filter(Boolean)

  const [authorsRes, checkinsRes, cheeredRes] = await Promise.all([
    db.collection('users').where({ openid: _.in(authorIds) }).limit(100).get(),
    checkinIds.length
      ? db.collection('checkins').where({ _id: _.in(checkinIds) }).limit(100).get()
      : Promise.resolve({ data: [] }),
    db
      .collection('cheers')
      .where({ target_type: 'post', target_id: _.in(visible.map((p) => p._id)), from_user: OPENID })
      .field({ target_id: true })
      .limit(100)
      .get()
  ])

  const authors = {}
  authorsRes.data.forEach((u) => {
    authors[u.openid] = {
      // id 是 users 记录 _id，对外只流通它；openid 与 blocked_ids 一律不出云函数
      id: u._id,
      nickname: u.nickname || '匿名跑者',
      gradient: u.gradient || ['#7C5CFF', '#4CC9F0'],
      // 用户主动换的微信头像。为空时前端退回生成式色块
      avatar: u.avatar_file_id || '',
      city: u.city || ''
    }
  })

  const checkins = {}
  checkinsRes.data.forEach((c) => {
    checkins[c._id] = {
      distance_km: c.distance_km,
      duration_s: c.duration_s,
      pace_auto: c.pace_auto
    }
  })

  const cheered = new Set(cheeredRes.data.map((c) => c.target_id))

  return {
    ok: true,
    serverTime: Date.now(),
    posts: visible.map((p) => ({
      _id: p._id,
      type: p.type || 'checkin',
      content: p.content || '',
      images: p.images || [],
      cheer_count: p.cheer_count || 0,
      comment_count: p.comment_count || 0,
      created_at: p.created_at,
      author: authors[p.user_id] || { id: '', nickname: '匿名跑者', gradient: ['#7C5CFF', '#4CC9F0'], avatar: '', city: '' },
      checkin: p.checkin_id ? checkins[p.checkin_id] || null : null,
      cheered: cheered.has(p._id)
    }))
  }
}

/** 双向屏蔽集合：我屏蔽的人 + 屏蔽了我的人 */
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
