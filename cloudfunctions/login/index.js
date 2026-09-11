/**
 * 登录：把 openid 交给前端作为「生成式身份」的种子。
 *
 * 注意这里只返回 openid，不返回微信昵称/头像，也不落库任何真实身份信息
 * （PRD 9.1 身份脱敏）。首次调用时建一条最小 users 记录。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, error: 'no_openid' }
  }

  const users = db.collection('users')
  const exist = await users.where({ openid: OPENID }).limit(1).get()

  if (!exist.data.length) {
    await users.add({
      data: {
        openid: OPENID,
        // 昵称与头像由前端按 openid 哈希生成，这里只留空位
        nickname: '',
        avatar_seed: OPENID,
        city: event.city || '深圳',
        level: 1,
        searchable: true,
        blocked_ids: [],
        created_at: Date.now()
      }
    })
  }

  return { ok: true, openid: OPENID }
}
