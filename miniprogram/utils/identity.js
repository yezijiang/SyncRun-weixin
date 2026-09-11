/**
 * 身份脱敏（PRD 9.1，优先级 P0）
 *
 * 为什么不用微信头像昵称：
 *   微信账号 = 真实社会身份，头像往往是本人，昵称常是真名。
 *   如果默认填充，等于逼用户在第一次打开时就回答「我要不要出柜」。
 *   这是本产品最不能犯的错。
 *
 * 这里生成的是「稳定且唯一」的假身份：同一个 openid 永远得到同一张
 * 彩虹几何头像和同一个昵称，用户可辨识、可被认出来，但不含任何真实信息。
 */

const STORAGE_KEY = 'tf_identity_v1'

const RUNNER_WORDS = ['夜跑者', '晨跑者', '午后跑者', '慢跑者', '绕圈跑者', '河堤跑者']

// 两两一组，取自 PRD 彩虹渐变的分段组合
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

function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * 由种子构造档案。同一 seed 结果恒定。
 * @param {string} seed 通常是 openid；无云环境时退化为本地随机串
 * @param {string} city
 */
function buildProfile(seed, city) {
  const h = hash(seed)
  const word = RUNNER_WORDS[h % RUNNER_WORDS.length]
  const gradient = GRADIENTS[(h >> 3) % GRADIENTS.length]
  const no = ((h >> 7) % 899) + 100 // 100–998

  return {
    seed,
    nickname: `${city} · ${word} No.${no}`,
    gradient,
    // 头像上不显示任何真实字符，只用几何色块；这里留一个中性符号位供 UI 使用
    avatarGlyph: '·',
    createdAt: Date.now()
  }
}

/**
 * 获取（或首次生成）本地身份。不调用 wx.getUserProfile。
 */
function ensureIdentity(city) {
  const cached = wx.getStorageSync(STORAGE_KEY)
  const app = (typeof getApp === 'function' && getApp()) || null
  const cloudReady = !!(app && app.globalData && app.globalData.cloudReady)

  // 没云环境时用过本地随机种子，后来填了环境 ID —— 必须换成 openid。
  // 不换的话：换设备认不出是同一个人，而且服务端查无此人，打卡会全部失败。
  const staleLocal = !!(cached && cached.seed && String(cached.seed).indexOf('local-') === 0)
  if (cached && cached.seed && !(cloudReady && staleLocal)) {
    return Promise.resolve(cached)
  }

  return new Promise((resolve) => {
    const finish = (seed) => {
      const profile = buildProfile(seed, city || '深圳')
      // 用户改过昵称就保留，不能因为换了种子又把人家名字改回去
      if (cached && cached.customized && cached.nickname) {
        profile.nickname = cached.nickname
        profile.customized = true
      }
      wx.setStorageSync(STORAGE_KEY, profile)
      resolve(profile)
    }

    // 有云环境时用 openid 作种子，保证换手机也认得出是同一个人
    if (cloudReady && wx.cloud && wx.cloud.callFunction) {
      wx.cloud
        .callFunction({ name: 'login', data: { city: city || '深圳' } })
        .then((res) => {
          const openid = res && res.result && res.result.openid
          finish(openid || localSeed())
        })
        .catch(() => finish(localSeed()))
    } else {
      finish(localSeed())
    }
  })
}

function localSeed() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * 用户主动更换昵称时调用。仍然只允许自定义，不提供「使用微信昵称」入口。
 */
function setNickname(nickname) {
  const cached = wx.getStorageSync(STORAGE_KEY) || {}
  const next = Object.assign({}, cached, { nickname, customized: true })
  wx.setStorageSync(STORAGE_KEY, next)
  return next
}

module.exports = { ensureIdentity, buildProfile, setNickname, hash, STORAGE_KEY }
