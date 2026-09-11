/**
 * 登录：把 openid 交给前端作为「生成式身份」的种子。
 *
 * 只返回 openid，不返回微信昵称/头像，也不落库任何真实身份信息（PRD 9.1）。
 *
 * 这里额外做一件事：在服务端生成昵称与渐变色并落库。
 * 原因：动态流、跑友列表要显示别人的昵称，但 users 是「仅管理端可读写」，
 * 前端读不到；而生成式身份是 openid 的确定性哈希，服务端算出来和客户端
 * 用 utils/identity.js 算出来的完全一致，两边不需要同步。
 *
 * 首次调用建号；已存在但昵称为空（改动前建的号）时回填，省掉一次数据迁移。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 与 miniprogram/utils/identity.js 保持完全一致，改动必须同步两边
const RUNNER_WORDS = ['夜跑者', '晨跑者', '午后跑者', '慢跑者', '绕圈跑者', '河堤跑者']
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
const DEFAULT_GRADIENT = ['#7C5CFF', '#4CC9F0']

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, error: 'no_openid' }
  }

  const city = event.city || '深圳'
  const users = db.collection('users')
  const exist = await users.where({ openid: OPENID }).limit(1).get()

  if (!exist.data.length) {
    await users.add({
      data: {
        openid: OPENID,
        nickname: buildNickname(OPENID, city),
        gradient: buildGradient(OPENID),
        // 头像用 openid 哈希出的几何图形，不存图片也不存微信头像
        avatar_seed: OPENID,
        city,
        usual_km: 5,
        level: 1,
        searchable: true,
        blocked_ids: [],
        created_at: Date.now()
      }
    })
    return { ok: true, openid: OPENID }
  }

  // 回填：早期创建或异常中断导致的空昵称
  const me = exist.data[0]
  const patch = {}
  if (!me.nickname) patch.nickname = buildNickname(OPENID, me.city || city)
  if (!me.gradient) patch.gradient = buildGradient(OPENID)
  if (!me.blocked_ids) patch.blocked_ids = []
  if (Object.keys(patch).length) {
    await users.doc(me._id).update({ data: patch })
  }

  return { ok: true, openid: OPENID }
}

function buildNickname(seed, city) {
  const h = hash(seed)
  const word = RUNNER_WORDS[h % RUNNER_WORDS.length]
  const no = ((h >> 7) % 899) + 100 // 100–998
  return `${city} · ${word} No.${no}`
}

function buildGradient(seed) {
  const h = hash(seed)
  return GRADIENTS[(h >> 3) % GRADIENTS.length] || DEFAULT_GRADIENT
}

function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h
}
