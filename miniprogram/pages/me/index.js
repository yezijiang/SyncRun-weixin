const db = require('../../utils/db')
const fmt = require('../../utils/format')
const { GRADIENTS } = require('../../utils/identity')

const ACHIEVEMENTS = [
  { code: 'first', name: '第一次打卡', got: true },
  { code: 'streak7', name: '连续 7 天', got: true },
  { code: 'city1', name: '点亮第一座城市', got: true },
  { code: 'km100', name: '累计 100KM', got: false },
  { code: 'half', name: '第一次半马', got: false }
]

Page({
  data: {
    nickname: '',
    gradient: ['#7C5CFF', '#4CC9F0'],
    level: 1,
    totalKm: '0.00',
    totalCount: 0,
    longest: '0.00',
    streakDays: 0,
    achievements: ACHIEVEMENTS,
    cities: [],
    gradients: GRADIENTS,
    showAvatar: false,
    // 用户主动换的微信头像（云存储 fileID）。为空 = 还在用生成式头像
    avatarFileId: '',
    pendingNickname: ''
  },

  onShow() {
    const app = getApp()
    const profile = app.globalData.profile
    const apply = (p) =>
      this.setData({
        nickname: p.nickname,
        gradient: p.gradient,
        avatarFileId: p.avatarFileId || ''
      })
    if (profile) apply(profile)
    else app.onProfileReady(apply)
    this.fetch()
  },

  async fetch() {
    const res = await db.getMe()
    this.setData({
      totalKm: fmt.km(res.totalKm),
      totalCount: res.totalCount,
      longest: fmt.km(res.longest),
      streakDays: res.streakDays || 0,
      // 服务端是权威：换过头像的话以它为准，本地只是缓存
      avatarFileId: (res.profile && res.profile.avatar_file_id) || this.data.avatarFileId || '',
      // 等级按累计打卡次数，不做配速排行（PRD 第 8 章）
      level: Math.max(1, Math.floor(res.totalCount / 10) + 1),
      // 成就由服务端按真实数据算，前端不自己判断
      achievements: (res.achievements && res.achievements.length
        ? res.achievements
        : ACHIEVEMENTS
      ).map((a) => Object.assign({}, a)),
      cities: (res.cities || ['深圳']).map((c) => ({ city: c, lit: true }))
    })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  /* ---------- 头像 ---------- */

  openAvatar() {
    this.setData({ showAvatar: true })
  },

  closeAvatar() {
    this.setData({ showAvatar: false })
  },

  /** catchtap 需要真实方法名，空值拦不住冒泡（点面板会误关弹窗） */
  noop() {},

  /**
   * 换头像配色。选配色就等于放弃微信头像——两者只能选一个，
   * 不能出现"既是真头像又叠个色块"这种四不像
   */
  async pickGradient(e) {
    const g = GRADIENTS[Number(e.currentTarget.dataset.i)]
    if (!g) return

    const { setGradient, clearAvatarFileId } = require('../../utils/identity')
    let next = setGradient(g)
    if (this.data.avatarFileId) {
      next = clearAvatarFileId()
      db.clearAvatar().catch(() => {})
    }
    getApp().globalData.profile = next
    this.setData({ gradient: g, avatarFileId: '', showAvatar: false })

    const r = await db.setGradient(g)
    if (!r.ok) {
      wx.showToast({ title: '配色没能同步，别人看到的还是旧的', icon: 'none' })
    }
  },

  /**
   * 用户选了微信头像。
   *
   * 只在第一次弹一次确认。之后不再烦人，但风险提示写在这里和设置页——
   * 头像是本人照片，一旦发出去就收不回来。
   */
  async onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return

    const ok = await this.confirmAvatarRisk()
    if (!ok) return

    wx.showLoading({ title: '上传中' })
    const up = await db.uploadAvatar(tempPath)
    wx.hideLoading()

    if (!up.ok) {
      const text = up.error === 'cloud_unavailable'
        ? '云存储还没就绪，请先在开发者工具开通云存储'
        : '上传失败，稍后再试'
      return wx.showToast({ title: text, icon: 'none' })
    }

    const r = await db.setAvatar(up.fileID)
    if (!r.ok) return wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })

    const { setAvatarFileId } = require('../../utils/identity')
    const next = setAvatarFileId(up.fileID)
    getApp().globalData.profile = next
    this.setData({ avatarFileId: up.fileID, showAvatar: false })
    wx.showToast({ title: '已换成你的微信头像', icon: 'none' })
  },

  /** 一次性风险确认。确认过就不再问，避免每次换头像都被拦一道 */
  confirmAvatarRisk() {
    const KEY = 'tf_avatar_confirmed_v1'
    if (wx.getStorageSync(KEY)) return Promise.resolve(true)

    return new Promise((resolve) => {
      wx.showModal({
        title: '用你自己的头像？',
        content:
          '换了之后，社区里的动态、跑友列表都会显示这张真实照片。\n\n' +
          '别人截图传出去，就能把照片和你本人对上。\n\n' +
          '随时可以换回生成的头像。',
        confirmText: '我知道风险',
        confirmColor: '#FF4D6D',
        success: (r) => {
          if (r.confirm) {
            wx.setStorageSync(KEY, true)
            resolve(true)
          } else {
            resolve(false)
          }
        },
        fail: () => resolve(false)
      })
    })
  },

  async revertAvatar() {
    const r = await db.clearAvatar()
    if (!r.ok) return wx.showToast({ title: '没换成功，稍后再试', icon: 'none' })

    const { clearAvatarFileId } = require('../../utils/identity')
    getApp().globalData.profile = clearAvatarFileId()
    this.setData({ avatarFileId: '', showAvatar: false })
    wx.showToast({ title: '已换回生成的头像', icon: 'none' })
  },

  onNicknameInput(e) {
    this.setData({ pendingNickname: e.detail.value })
  },

  async saveNickname() {
    const name = String(this.data.pendingNickname || '').trim()
    if (!name) return wx.showToast({ title: '还没填昵称', icon: 'none' })
    if (name.length > 20) return wx.showToast({ title: '昵称最多 20 个字', icon: 'none' })

    const { setNickname } = require('../../utils/identity')
    const next = setNickname(name)
    getApp().globalData.profile = next
    this.setData({ nickname: name, showAvatar: false })

    const r = await db.renameNickname(name)
    if (!r.ok) {
      const map = {
        cloud_unavailable: '昵称只在本机生效，联网后会自动同步',
        risky_content: '这个名字没通过内容安全校验，换一个吧'
      }
      wx.showToast({ title: map[r.error] || '同步失败，昵称只在本机生效', icon: 'none' })
    }
  },

  /** 改名与换头像共用一个面板，省得两个入口各改一半 */
  editIdentity() {
    this.setData({ pendingNickname: this.data.nickname, showAvatar: true })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/home/index' }
  }
})
