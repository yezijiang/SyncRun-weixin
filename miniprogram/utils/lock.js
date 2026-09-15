/**
 * 应用锁：开小程序时要验指纹或面容。
 *
 * 为什么要这个而不是「退出登录」：
 *   身份绑在微信账号上（openid），就算清掉本地缓存，重新打开还是同一个人——
 *   做一个「登出」按钮，点了没变化，是假的。用户真正要的是
 *   「别人拿起我手机时打不开」，所以给的是锁，不是登出。
 *
 * 锁只在内存里记本次会话：进程被杀掉就要重新验证。
 * 不存长期凭证，避免哪天钥匙本身变成泄露源。
 */

const STORAGE_KEY = 'tf_lock_v1'

let unlocked = false

function isEnabled() {
  return !!wx.getStorageSync(STORAGE_KEY)
}

function setEnabled(v) {
  wx.setStorageSync(STORAGE_KEY, !!v)
  if (!v) unlocked = false
}

/** 当前会话是否已经验证过 */
function isUnlocked() {
  return unlocked
}

function markUnlocked() {
  unlocked = true
}

/** 设备是否支持生物认证，以及是否已录入 */
async function checkSupport() {
  if (!wx.checkIsSupportSoterAuthentication) return { ok: false, reason: 'unsupported' }

  const support = await new Promise((resolve) => {
    wx.checkIsSupportSoterAuthentication({
      success: resolve,
      fail: () => resolve({ supportModes: [] })
    })
  })

  const modes = (support.supportModes || []).filter(
    (m) => m === 'fingerPrint' || m === 'facial'
  )
  if (!modes.length) return { ok: false, reason: 'unsupported' }

  // 支持但没录入指纹/面容也用不了，这里要提前问清楚，别等点开关才报错
  for (const mode of modes) {
    const enrolled = await new Promise((resolve) => {
      wx.checkIsSoterEnrolledInDevice({
        checkAuthMode: mode,
        success: (r) => resolve(!!r.isEnrolled),
        fail: () => resolve(false)
      })
    })
    if (enrolled) return { ok: true, mode }
  }

  return { ok: false, reason: 'not_enrolled' }
}

/** 开启：先确认设备可用，再落开关。不可用就别给一个点了没反应的开关 */
async function enable() {
  const r = await checkSupport()
  if (!r.ok) return r
  setEnabled(true)
  return { ok: true, mode: r.mode }
}

/**
 * 验证。
 * @returns {{ok:boolean, cancelled?:boolean, reason?:string}}
 */
function authenticate() {
  return new Promise((resolve) => {
    if (!wx.startSoterAuthentication) {
      return resolve({ ok: false, reason: 'unsupported' })
    }
    wx.startSoterAuthentication({
      requestAuthModes: ['fingerPrint', 'facial'],
      challenge: 'tongfin-run',
      authContent: '验证身份后进入同频跑',
      success: () => resolve({ ok: true }),
      fail: (e) => {
        // 用户主动取消不算失败，不该弹「验证失败」吓人一跳
        const cancelled = e && (e.errCode === 90001 || e.errMsg === 'cancel')
        resolve({ ok: false, cancelled: !!cancelled, reason: 'failed' })
      }
    })
  })
}

module.exports = {
  isEnabled,
  setEnabled,
  isUnlocked,
  markUnlocked,
  checkSupport,
  enable,
  authenticate,
  STORAGE_KEY
}
