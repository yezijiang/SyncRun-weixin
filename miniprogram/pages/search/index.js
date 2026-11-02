const db = require('../../utils/db')

const TABS = [
  { key: 'session', label: '活动' },
  { key: 'friend', label: '跑友' },
  { key: 'team', label: '队伍' }
]

Page({
  data: {
    tabs: TABS,
    tab: 'session',
    keyword: '',
    results: [],
    searched: false
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
    this.run()
  },

  pickTab(e) {
    this.setData({ tab: e.currentTarget.dataset.k }, () => this.run())
  },

  /** 点跑友 → 主页。跳过去也不带任何身份信息，只有 users._id */
  openProfile(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/profile/index?id=' + id })
  },

  async run() {
    const kw = this.data.keyword.trim()
    if (!kw) {
      return this.setData({ results: [], searched: false })
    }
    const me = getApp().globalData.profile
    const res = await db.search(this.data.tab, kw, me)
    this.setData({ results: res, searched: true })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/search/index' }
  }
})
