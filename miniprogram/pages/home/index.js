const db = require('../../utils/db')
const fmt = require('../../utils/format')
const cityUtil = require('../../utils/city')

Page({
  data: {
    greeting: '今晚好',
    nickname: '',
    gradient: ['#7C5CFF', '#4CC9F0'],
    // PRD 4.1.1：数字都是真的，没有就是 0
    todayRunners: 0,   // 今天跑过（累计）
    runningNow: 0,     // 此刻正在跑（状态机推导）
    todayKm: 0,
    cheerReceived: 0,  // 我的动态收到的鼓励
    streakDays: 0,     // 连续打卡天数
    city: '深圳',
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
      todayKm: res.todayKm || 0,
      cheerReceived: res.cheerReceived || 0,
      streakDays: res.streakDays || 0,
      city: res.city || cityUtil.get(),
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
    wx.showLoading({ title: '加入中' })
    db.joinSession(id)
      .then((r) => {
        wx.hideLoading()
        if (!r.ok) return wx.showToast({ title: this.failText(r.error), icon: 'none' })
        wx.showToast({ title: '已加入这场陪跑', icon: 'none' })
        this.fetch()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '加入失败，稍后再试', icon: 'none' })
      })
  },

  /** 云函数返回的错误码翻成人话，不要直接把 code 弹给用户 */
  failText(code) {
    const map = {
      cloud_unavailable: '云服务还没就绪，请先在开发者工具部署云函数',
      session_closed: '这场已经结束或取消了',
      not_found: '场次不存在',
      daily_limit: '今天发起得有点多，明天再来',
      offline_only_daytime: '线下场次请选 6:00–18:00 的公共场地',
      risky_content: '文字没通过内容安全校验，换个说法试试',
      no_title: '还没填场次名'
    }
    return map[code] || '操作失败，稍后再试'
  },

  goCheckin() {
    wx.switchTab({ url: '/pages/run/index' })
  },

  /**
   * 切换城市。本地立刻生效，服务端同步失败也不影响浏览——
   * 城市只是浏览上下文，不该因为一次网络问题就卡住用户
   */
  async pickCity(e) {
    const next = e.currentTarget.dataset.c
    if (!next || next === this.data.city) return

    cityUtil.set(next)
    this.setData({ city: next })
    wx.showToast({ title: '已切换到 ' + next, icon: 'none' })

    const r = await db.setCity(next)
    if (!r.ok) console.warn('[同频跑] 城市没能同步到服务端', r.error)
    this.fetch()
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
