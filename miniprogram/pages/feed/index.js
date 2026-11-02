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
        comments: p.comments || [],
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

  /** 头像 → 跑友主页。没有 author.id（数据缺失或已注销）就不跳，点了没反应比不点更糟 */
  goProfile(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/profile/index?id=' + id })
  },

  /**
   * 评论。发之前先让用户看到已有什么，点「说点什么」再弹输入框，
   * 弹窗里自动带一条占位提示——评论区最怕的是一片「加油」刷屏。
   */
  async comment(e) {
    const id = e.currentTarget.dataset.id
    const post = this.data.posts.filter((p) => p._id === id)[0]
    if (!post) return

    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '说点什么',
        editable: true,
        placeholderText: '给 TA 一句具体的鼓励，比「加油」更动人',
        success: resolve,
        fail: () => resolve({})
      })
    })
    if (!res.confirm || !res.content || !res.content.trim()) return

    wx.showLoading({ title: '发送中' })
    const r = await db.commentPost(id, res.content.trim())
    wx.hideLoading()
    if (!r.ok) {
      const map = {
        risky_content: '这句话没通过内容安全校验，换个说法',
        blocked: '你们之间有一方设置了屏蔽，无法互动',
        comment_too_long: '评论最多 200 个字'
      }
      return wx.showToast({ title: map[r.error] || '没发出去，稍后再试', icon: 'none' })
    }

    const me = getApp().globalData.profile || { nickname: '我' }
    const posts = this.data.posts.map((p) => {
      if (p._id !== id) return p
      return Object.assign({}, p, {
        comment_count: (p.comment_count || 0) + 1,
        comments: (p.comments || []).concat([
          { _id: r.id, text: res.content.trim(), author: { nickname: me.nickname } }
        ]).slice(-2)
      })
    })
    this.setData({ posts })
  },

  /**
   * 举报 / 双向屏蔽（PRD 9.4，P0）
   * 举报分级（UI v2.0）：先选类型，再补一句话说明——
   * 给处理的人足够的上下文，给发的人明确的边界。
   */
  more(e) {
    const id = e.currentTarget.dataset.id
    const post = this.data.posts.filter((p) => p._id === id)[0]
    const canBlock = !!(post && post.author && post.author.id)
    const items = canBlock ? ['举报这条内容', '屏蔽这个跑友'] : ['举报这条内容']

    wx.showActionSheet({
      itemList: items,
      success: async (res) => {
        if (res.tapIndex === 0) {
          this.reportFlow(id)
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

  /** 举报两步流：分类 → 补充说明（选填） */
  async reportFlow(id) {
    const reasons = ['垃圾营销或广告', '人身攻击或不友善', '骚扰或不当互动', '泄露他人隐私', '内容不当（其他）']
    const picked = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: reasons,
        success: (r) => resolve(reasons[r.tapIndex]),
        fail: () => resolve('')
      })
    })
    if (!picked) return

    const extra = await new Promise((resolve) => {
      wx.showModal({
        title: '补充说明（选填）',
        editable: true,
        placeholderText: '简单描述发生了什么，有助于我们判断',
        success: (r) => resolve(r.confirm ? r.content || '' : ''),
        fail: () => resolve('')
      })
    })

    const r = await db.reportPost(id, picked + (extra ? '｜' + extra : ''))
    wx.showToast({
      title: r.ok ? '已提交，我们会在 24 小时内处理' : '提交失败，稍后再试',
      icon: 'none'
    })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/feed/index' }
  }
})
