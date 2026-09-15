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
    showAvatar: false
  },

  onShow() {
    const app = getApp()
    const profile = app.globalData.profile
    if (profile) {
      this.setData({ nickname: profile.nickname, gradient: profile.gradient })
    } else {
      app.onProfileReady((p) => this.setData({ nickname: p.nickname, gradient: p.gradient }))
    }
    this.fetch()
  },

  async fetch() {
    const res = await db.getMe()
    this.setData({
      totalKm: fmt.km(res.totalKm),
      totalCount: res.totalCount,
      longest: fmt.km(res.longest),
      streakDays: res.streakDays || 0,
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

  /**
   * 换头像配色。本地先变，再同步服务端——
   * 换的是配色不是身份，失败了也只是别人看到的还是旧的，不阻塞
   */
  async pickGradient(e) {
    const g = GRADIENTS[Number(e.currentTarget.dataset.i)]
    if (!g) return

    const { setGradient } = require('../../utils/identity')
    const next = setGradient(g)
    getApp().globalData.profile = next
    this.setData({ gradient: g, showAvatar: false })

    const r = await db.setGradient(g)
    if (!r.ok) {
      wx.showToast({ title: '配色没能同步，别人看到的还是旧的', icon: 'none' })
    }
  },

  async editIdentity() {
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '更换昵称',
        editable: true,
        placeholderText: '输入你想被叫的名字',
        success: resolve,
        fail: () => resolve({})
      })
    })
    if (!res.confirm || !res.content || !res.content.trim()) return

    const { setNickname } = require('../../utils/identity')
    const next = setNickname(res.content.trim())
    getApp().globalData.profile = next
    this.setData({ nickname: next.nickname })

    // 本地改完要同步到服务端，否则别人在动态里看到的还是旧昵称
    const r = await db.renameNickname(next.nickname)
    if (!r.ok) {
      const map = {
        cloud_unavailable: '昵称只在本机生效，联网后会自动同步',
        risky_content: '这个名字没通过内容安全校验，换一个吧',
        nickname_too_long: '昵称最多 20 个字'
      }
      wx.showToast({ title: map[r.error] || '同步失败，昵称只在本机生效', icon: 'none' })
    }
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/home/index' }
  }
})
