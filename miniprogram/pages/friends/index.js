const db = require('../../utils/db')

const FILTERS = ['跑步时段', '常跑距离', '周频次']

Page({
  data: {
    filters: FILTERS,
    active: 0,
    teams: [],
    friends: [],
    showCreate: false,
    // 发起组队表单（陪跑场次与队伍是两类动作，见 PRD 4.2 A）
    form: { name: '', usual_km: 5, run_window: '早 6:30', join_mode: 'free' }
  },

  onShow() {
    this.fetch()
  },

  async fetch() {
    const me = getApp().globalData.profile
    const [res, teams] = await Promise.all([db.search('friend', '', me), db.listTeams()])
    this.setData({ friends: res, teams })
  },

  pickFilter(e) {
    this.setData({ active: Number(e.currentTarget.dataset.i) })
  },

  openSearch() {
    wx.navigateTo({ url: '/pages/search/index' })
  },

  openCreate() {
    this.setData({ showCreate: true })
  },

  closeCreate() {
    this.setData({ showCreate: false })
  },

  onForm(e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['form.' + k] = e.detail.value
    this.setData(patch)
  },

  pickKm(e) {
    this.setData({ 'form.usual_km': Number(e.currentTarget.dataset.v) })
  },

  pickJoinMode(e) {
    this.setData({ 'form.join_mode': e.currentTarget.dataset.v })
  },

  async submitCreate() {
    const f = this.data.form
    if (!f.name || !f.name.trim()) {
      return wx.showToast({ title: '请填写队伍名', icon: 'none' })
    }

    // 本地先挡一道，服务端的每日上限才是真正的兜底（防刷，PRD 4.3）
    const today = new Date().toDateString()
    const rec = wx.getStorageSync('tf_team_created') || {}
    if (rec.date !== today) {
      rec.date = today
      rec.count = 0
    }
    if (rec.count >= 3) {
      return wx.showToast({ title: '今天创建太多了，明天再来', icon: 'none' })
    }

    const r = await db.createTeam({
      name: f.name.trim(),
      usual_km: f.usual_km,
      run_window: f.run_window,
      join_mode: f.join_mode
    })
    if (!r.ok) {
      const map = {
        cloud_unavailable: '云服务还没就绪，请先在开发者工具部署云函数',
        daily_limit: '今天创建太多了，明天再来',
        risky_content: '队伍名没通过内容安全校验，换个名字试试'
      }
      return wx.showToast({ title: map[r.error] || '创建失败，稍后再试', icon: 'none' })
    }

    wx.setStorageSync('tf_team_created', { date: today, count: rec.count + 1 })
    this.setData({ showCreate: false })
    wx.showToast({ title: '队伍已创建', icon: 'none' })
    this.fetch()
  },

  async joinTeam(e) {
    const id = e.currentTarget.dataset.id
    const r = await db.joinTeam(id)
    if (!r.ok) return wx.showToast({ title: '加入失败，稍后再试', icon: 'none' })
    wx.showToast({
      title: r.status === 'pending' ? '已申请，等队长通过' : '已加入队伍',
      icon: 'none'
    })
    this.fetch()
  },

  openInvite(e) {
    const name = e.currentTarget.dataset.name || '今日陪跑'
    wx.navigateTo({ url: '/pages/invite/index?name=' + encodeURIComponent(name) })
  },

  goRun(e) {
    wx.switchTab({ url: '/pages/run/index' })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/friends/index' }
  }
})
