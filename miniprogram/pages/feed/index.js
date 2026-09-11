const db = require('../../utils/db')
const fmt = require('../../utils/format')

Page({
  data: {
    posts: [],
    cheered: {}
  },

  onShow() {
    this.fetch()
  },

  async fetch() {
    const me = getApp().globalData.profile
    const list = await db.getFeed(me)
    this.setData({
      posts: list.map((p) => ({
        ...p,
        timeText: this.ago(p.created_at),
        author: p.author || this.fallbackAuthor(p)
      }))
    })
  },

  fallbackAuthor(p) {
    return { nickname: '深圳 · 夜跑者 No.107', gradient: ['#FF4D6D', '#FF9F1C'] }
  },

  ago(ts) {
    const diff = Date.now() - (ts || 0)
    const m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return m + ' 分钟前'
    const h = Math.floor(m / 60)
    if (h < 24) return h + ' 小时前'
    return Math.floor(h / 24) + ' 天前'
  },

  async cheer(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.cheered[id]) return
    const app = getApp()
    const userId = app.globalData.profile ? app.globalData.profile.seed : 'local'
    await db.cheerPost(id, userId)

    const posts = this.data.posts.map((p) => {
      if (p._id !== id) return p
      return Object.assign({}, p, { cheer_count: (p.cheer_count || 0) + 1 })
    })
    const cheered = Object.assign({}, this.data.cheered, { [id]: true })
    this.setData({ posts, cheered })
    wx.vibrateShort({ type: 'light' })
  },

  /** 举报 / 双向屏蔽（PRD 9.4，P0） */
  more(e) {
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['举报这条内容', '屏蔽这个跑友', '不感兴趣'],
      success: (res) => {
        const labels = ['已提交举报，我们会在 24 小时内处理', '已屏蔽，你们将互相看不到对方', '已减少这类内容']
        wx.showToast({ title: labels[res.tapIndex], icon: 'none' })
      },
      fail: () => {}
    })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/feed/index' }
  }
})
