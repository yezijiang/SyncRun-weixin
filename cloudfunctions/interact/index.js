/**
 * 用户之间的动作：cheer（鼓励）/ report（举报）/ block / unblock（双向屏蔽）。
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_openid' }

  const action = event.action
  if (action === 'cheer') return cheer(OPENID, event)
  if (action === 'report') return report(OPENID, event)
  if (action === 'block') return block(OPENID, event, true)
  if (action === 'unblock') return block(OPENID, event, false)
  return { ok: false, error: 'unknown_action' }
}

/** 鼓励：同一人对同一条只计一次，重复点击直接返回成功 */
async function cheer(openid, event) {
  const targetId = event.target_id
  if (!targetId) return { ok: false, error: 'no_target' }

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
  return { ok: true }
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
