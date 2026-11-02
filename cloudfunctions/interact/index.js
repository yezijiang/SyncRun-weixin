/**
 * 用户之间的动作：cheer（鼓励）/ report（举报）/ block / unblock（双向屏蔽）
 * + 消息中心的读写（messageList / messageRead / unreadCount）。
 *
 * 屏蔽为什么是双向的（PRD 9.4）：
 *   如果只让「我屏蔽的人」从我视野里消失，那个人依然能看到我、能跟着我的
 *   场次打卡记录推断我的行踪——屏蔽就成了一个单方面的跟踪工具。
 *   所以这里只写一侧的 blocked_ids，读取时两个方向都排除（见 feed / search）。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 消息只保留 30 天：这是给用户的承诺，也是不留多余数据的自律
const KEEP_DAYS = 30

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  const action = event.action
  if (action === 'cheer') return cheer(OPENID, event)
  if (action === 'cheerBack') return cheer(OPENID, { target_id: event.target_id })
  if (action === 'report') return report(OPENID, event)
  if (action === 'block') return block(OPENID, event, true)
  if (action === 'unblock') return block(OPENID, event, false)
  if (action === 'messageList') return messageList(OPENID)
  if (action === 'messageRead') return messageRead(OPENID, event)
  if (action === 'unreadCount') return unreadCount(OPENID)
  return { ok: false, error: 'unknown_action' }
}

/** 鼓励：同一人对同一条只计一次，重复点击直接返回成功 */
async function cheer(openid, event) {
  const targetId = event.target_id
  if (!targetId) return { ok: false, error: 'no_target' }

  const post = await db.collection('posts').doc(targetId).get().catch(() => null)
  if (!post || !post.data) return { ok: false, error: 'no_target' }

  const author = post.data.user_id
  // 关掉「陌生人加油」的人：只有互相加油过的才允许（安全中心开关，UI v2.0）
  const authorDoc = await db.collection('users').where({ openid: author }).limit(1).get()
  if (authorDoc.data.length && authorDoc.data[0].allow_cheer === false && author !== openid) {
    const mutual = await db
      .collection('cheers')
      .where({ from_user: author, target_type: 'post' })
      .limit(100)
      .get()
    const myPosts = await db.collection('posts').where({ user_id: openid }).limit(100).get()
    const myIds = new Set(myPosts.data.map((p) => p._id))
    const cheeredMe = mutual.data.some((c) => myIds.has(c.target_id))
    if (!cheeredMe) return { ok: false, error: 'cheer_closed' }
  }

  const exist = await db
    .collection('cheers')
    .where({ target_type: 'post', target_id: targetId, from_user: openid })
    .limit(1)
    .get()
  if (exist.data.length) return { ok: true, duplicated: true }

  await db.collection('cheers').add({
    data: { target_type: 'post', target_id: targetId, from_user: openid, created_at: Date.now() }
  })
  await db.collection('posts').doc(targetId).update({ data: { cheer_count: _.inc(1) } })

  // 通知作者（聚合：同一条动态 24 小时内的鼓励只占一条消息）
  if (author && author !== openid) await notifyCheer(author, targetId, openid, post.data)
  return { ok: true }
}

/**
 * 鼓励通知。多条鼓励合并成一条，否则一个人连点五次就是五条消息——
 * 那不是通知，是骚扰。
 */
async function notifyCheer(author, postId, fromOpenid, post) {
  const since = Date.now() - 24 * 3600 * 1000
  const prev = await db
    .collection('messages')
    .where({ user_id: author, type: 'cheer', target_id: postId, read: false, created_at: _.gte(since) })
    .limit(1)
    .get()

  const nick = await nicknameOf(fromOpenid)
  const km = post.distance_km ? post.distance_km + 'KM ' : ''

  if (prev.data.length) {
    const n = (prev.data[0].count || 1) + 1
    await db.collection('messages').doc(prev.data[0]._id).update({
      data: {
        count: n,
        title: n + ' 位跑友给你加油',
        content: (prev.data[0].actor_nick || nick) + ' 等 ' + n + ' 人给你的 ' + km + '打卡点了赞',
        created_at: Date.now()
      }
    })
    return
  }

  await db.collection('messages').add({
    data: {
      user_id: author,
      type: 'cheer',
      title: '有跑友给你加油',
      content: nick + ' 给你的 ' + km + '打卡点了赞',
      actor_nick: nick,
      target_type: 'post',
      target_id: postId,
      count: 1,
      read: false,
      created_at: Date.now()
    }
  })
}

async function nicknameOf(openid) {
  const u = await db.collection('users').where({ openid }).limit(1).get()
  return (u.data[0] && u.data[0].nickname) || '一位跑友'
}

/* ---------------- 消息中心（UI v2.0） ---------------- */

/**
 * 我的消息。只返回自己的，且删掉 30 天之前的。
 * 隐私相关消息（举报结果）不带任何对方可识别信息——这是写在界面上的承诺。
 */
async function messageList(openid) {
  const since = Date.now() - KEEP_DAYS * 86400000
  const res = await db
    .collection('messages')
    .where({ user_id: openid, created_at: _.gte(since) })
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()

  return {
    ok: true,
    messages: res.data.map((m) => ({
      _id: m._id,
      type: m.type || 'system',
      title: m.title || '',
      content: m.content || '',
      // 隐私相关消息不返回对方任何信息，这里连 id 都不带
      target_type: m.type === 'privacy' ? '' : m.target_type || '',
      target_id: m.type === 'privacy' ? '' : m.target_id || '',
      read: !!m.read,
      created_at: m.created_at
    }))
  }
}

async function messageRead(openid, event) {
  const ids = Array.isArray(event.ids) ? event.ids : null
  if (ids && ids.length) {
    await db.collection('messages').where({ user_id: openid, _id: _.in(ids) }).update({ data: { read: true } })
  } else {
    // 全部已读
    await db.collection('messages').where({ user_id: openid, read: false }).update({ data: { read: true } })
  }
  return { ok: true }
}

async function unreadCount(openid) {
  const res = await db
    .collection('messages')
    .where({ user_id: openid, read: false })
    .limit(100)
    .get()
  return { ok: true, unread: res.data.length }
}

/** 举报：只落库，不做自动处置。人工 24 小时内看（PRD 9.5） */
async function report(openid, event) {
  const targetId = event.target_id
  if (!targetId) return { ok: false, error: 'no_target' }

  await db.collection('reports').add({
    data: {
      reporter: openid,
      target_type: event.target_type === 'user' ? 'user' : 'post',
      target_id: targetId,
      reason: String(event.reason || '').slice(0, 200),
      status: 'pending',
      created_at: Date.now()
    }
  })
  return { ok: true }
}

async function block(openid, event, blocking) {
  const targetDocId = event.target_user_id
  if (!targetDocId) return { ok: false, error: 'no_target' }

  // 传进来的是 users 记录 _id（对外公开的无意义 id），这里换成 openid 存进名单
  const target = await db.collection('users').doc(targetDocId).get().catch(() => null)
  if (!target || !target.data) return { ok: false, error: 'not_found' }
  if (target.data.openid === openid) return { ok: false, error: 'cannot_block_self' }

  const me = await db.collection('users').where({ openid }).limit(1).get()
  if (!me.data.length) return { ok: false, error: 'no_profile' }

  const list = me.data[0].blocked_ids || []
  const next = blocking
    ? Array.from(new Set(list.concat([target.data.openid])))
    : list.filter((x) => x !== target.data.openid)

  await db.collection('users').doc(me.data[0]._id).update({ data: { blocked_ids: next } })
  return { ok: true, blocked: blocking }
}
