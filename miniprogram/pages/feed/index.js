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
    // 服务端已经告诉我哪些鼓励过了，避免刷新后又能点一次
    const cheered = {}
    list.forEach((p) => {
      if (p.cheered) cheered[p._id] = true
    })
    this.setData({
      cheered,
      posts: list.map((p) => ({
        ...p,
        timeText: this.ago(p.created_at),
        kmText: p.checkin ? fmt.km(p.checkin.distance_km) : '',
        durText: p.checkin ? fmt.hms(p.checkin.duration_s) : '',
        paceText: p.checkin ? fmt.pace(p.checkin.duration_s, p.checkin.distance_km) : '',
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

    // 先动 UI 再发请求：鼓励是轻动作，等回包再亮会让手感发黏
    const posts = this.data.posts.map((p) => {
      if (p._id !== id) return p
      return Object.assign({}, p, { cheer_count: (p.cheer_count || 0) + 1 })
    })
    const cheered = Object.assign({}, this.data.cheered, { [id]: true })
    this.setData({ posts, cheered })
    wx.vibrateShort({ type: 'light' })

    const r = await db.cheerPost(id)
    if (!r.ok) {
      // 失败就回滚，不能让用户看到自己没送出去的鼓励
      this.setData({
        posts: this.data.posts.map((p) =>
          p._id === id ? Object.assign({}, p, { cheer_count: Math.max(0, (p.cheer_count || 1) - 1) }) : p
        ),
        cheered: Object.assign({}, this.data.cheered, { [id]: false })
      })
      wx.showToast({ title: '没送出去，稍后再试', icon: 'none' })
    }
  },

  /** 举报 / 双向屏蔽（PRD 9.4，P0） */
  more(e) {
    const id = e.currentTarget.dataset.id
    const post = this.data.posts.filter((p) => p._id === id)[0]
    // 作者可能已被屏蔽或数据缺失，没有 id 就不给屏蔽入口，避免点了没反应
    const canBlock = !!(post && post.author && post.author.id)
    const items = canBlock ? ['举报这条内容', '屏蔽这个跑友'] : ['举报这条内容']

    wx.showActionSheet({
      itemList: items,
      success: async (res) => {
        if (res.tapIndex === 0) {
          const r = await db.reportPost(id, '')
          wx.showToast({
            title: r.ok ? '已提交举报，我们会在 24 小时内处理' : '提交失败，稍后再试',
            icon: 'none'
          })
          return
        }
        const r = await db.blockUser(post.author.id)
        if (!r.ok) return wx.showToast({ title: '屏蔽失败，稍后再试', icon: 'none' })
        wx.showToast({ title: '已屏蔽，你们将互相看不到对方', icon: 'none' })
        this.fetch()
      },
      fail: () => {}
    })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/feed/index' }
  }
})
