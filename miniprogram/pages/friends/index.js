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
    const res = await db.search('friend', '', me)
    this.setData({ friends: res })
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

  submitCreate() {
    const f = this.data.form
    if (!f.name || !f.name.trim()) {
      return wx.showToast({ title: '请填写队伍名', icon: 'none' })
    }
    // 频率限制：每天最多创建 3 个队伍（防刷，PRD 4.3）
    const today = new Date().toDateString()
    const rec = wx.getStorageSync('tf_team_created') || {}
    if (rec.date !== today) {
      rec.date = today
      rec.count = 0
    }
    if (rec.count >= 3) {
      return wx.showToast({ title: '今天创建太多了，明天再来', icon: 'none' })
    }
    rec.count += 1
    wx.setStorageSync('tf_team_created', rec)

    this.setData({ showCreate: false })
    wx.showToast({ title: '队伍已创建（骨架未落库）', icon: 'none' })
  },

  joinTeam(e) {
    wx.showToast({ title: '已申请加入（骨架未落库）', icon: 'none' })
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
