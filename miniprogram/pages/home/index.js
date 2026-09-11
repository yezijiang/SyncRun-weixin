const db = require('../../utils/db')
const fmt = require('../../utils/format')

Page({
  data: {
    greeting: '今晚好',
    nickname: '',
    gradient: ['#7C5CFF', '#4CC9F0'],
    // PRD 4.1.1：两个数字都是真的
    todayRunners: 0,   // 今天跑过（累计）
    runningNow: 0,     // 此刻正在跑（状态机推导）
    sessions: [],
    cities: [],
    source: 'mock'
  },

  onLoad() {
    this.hydrate()
    this.fetch()
  },

  onShow() {
    // 从打卡页返回时刷新，保证「今天跑过」立刻变化
    this.fetch()
  },

  hydrate() {
    const app = getApp()
    this.setData({ greeting: this.greet(), nickname: app.globalData.profile ? app.globalData.profile.nickname : '' })
    app.onProfileReady((p) => this.setData({ nickname: p.nickname, gradient: p.gradient }))
  },

  greet() {
    const h = new Date().getHours()
    if (h < 5) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '今晚好'
  },

  async fetch() {
    const res = await db.getHome()
    this.setData({
      todayRunners: res.todayRunnersDisplay || res.todayRunners,
      runningNow: res.runningNow,
      source: res.source,
      sessions: res.sessions.map((s) => ({
        ...s,
        timeText: fmt.sessionTime(s.start_time),
        joined: s.joined || 0,
        done: s.done || 0,
        running: s.running || 0
      })),
      cities: res.cities
    })
  },

  onJoin(e) {
    const id = e.currentTarget.dataset.id
    const app = getApp()
    const userId = app.globalData.profile && app.globalData.profile.seed
    wx.showLoading({ title: '加入中' })
    db.joinSession(id, userId)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已加入这场陪跑', icon: 'none' })
        this.fetch()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '加入失败，稍后再试', icon: 'none' })
      })
  },

  goCheckin() {
    wx.switchTab({ url: '/pages/run/index' })
  },

  goCreate() {
    // 去跑页是 tabBar 页面，只能用 switchTab；发起动作通过全局标记传递
    getApp().globalData.pendingAction = 'create'
    wx.switchTab({ url: '/pages/run/index' })
  },

  onShareAppMessage() {
    // 外层分享保持中性：只有跑步，没有品牌与身份（PRD 9.3）
    return { title: '今晚，不止你一个人在跑', path: '/pages/home/index' }
  }
})
