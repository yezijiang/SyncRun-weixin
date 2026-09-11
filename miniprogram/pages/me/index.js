const db = require('../../utils/db')
const fmt = require('../../utils/format')

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
    achievements: ACHIEVEMENTS,
    cities: []
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
    const app = getApp()
    const userId = app.globalData.profile ? app.globalData.profile.seed : 'local'
    const res = await db.getMe(userId)
    this.setData({
      totalKm: fmt.km(res.totalKm),
      totalCount: res.totalCount,
      longest: fmt.km(res.longest),
      // 等级按累计打卡次数，不做配速排行（PRD 第 8 章）
      level: Math.max(1, Math.floor(res.totalCount / 10) + 1),
      cities: [{ city: '深圳', lit: true }]
    })
  },

  openSettings() {
    wx.showToast({ title: '设置与隐私（骨架待接入）', icon: 'none' })
  },

  editIdentity() {
    wx.showModal({
      title: '更换昵称',
      editable: true,
      placeholderText: '输入你想被叫的名字',
      success: (r) => {
        if (r.confirm && r.content) {
          const { setNickname } = require('../../utils/identity')
          const next = setNickname(r.content)
          getApp().globalData.profile = next
          this.setData({ nickname: next.nickname })
        }
      }
    })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/home/index' }
  }
})
