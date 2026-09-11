const db = require('../../utils/db')
const fmt = require('../../utils/format')

const DISTANCE_CHIPS = [3, 5, 8, 10, 15, 21.1]

Page({
  data: {
    mode: 'list',            // list | checkin | done
    sessions: [],
    joinedId: '',
    joinedSession: null,
    distanceChips: DISTANCE_CHIPS,
    // 打卡表单
    km: '',
    useCustomKm: false,
    h: '00',
    m: '00',
    s: '00',
    note: '',
    paceText: "—'—\"",
    durationText: '0分0秒',
    // 打卡位置：一次性定位的结果，只到城市（PRD 9.8）
    city: '',
    locating: false,
    ocrState: 'idle',        // idle | reading | ok | fail
    ocrResult: null
  },

  onLoad() {
    this.fetch()
  },

  onShow() {
    const action = getApp().globalData.pendingAction
    if (action === 'create') {
      getApp().globalData.pendingAction = ''
      wx.showToast({ title: '发起陪跑（骨架待接入表单）', icon: 'none' })
    }
  },

  async fetch() {
    const res = await db.getHome()
    const joined = res.sessions.filter((s) => s.joinedNow)
    this.setData({
      sessions: res.sessions.map((s) => ({
        ...s,
        timeText: fmt.sessionTime(s.start_time)
      })),
      joinedSession: joined.length ? joined[0] : res.sessions[0] || null
    })
    this.recalc()
  },

  checkinEntry() {
    this.setData({ mode: 'checkin' })
  },

  createEntry() {
    wx.showToast({ title: '发起表单待接入（骨架）', icon: 'none' })
  },

  /* ---------- 打卡表单 ---------- */

  onKmChip(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ km: String(v), useCustomKm: false })
    this.recalc()
  },

  onKmInput(e) {
    const v = e.detail.value
    this.setData({ km: v, useCustomKm: !!v })
    this.recalc()
  },

  onHms(e) {
    const field = e.currentTarget.dataset.f
    let v = String(e.detail.value).replace(/\D/g, '').slice(0, 2)
    const patch = {}
    patch[field] = v
    // 输满两位自动跳下一格
    this.setData(patch, () => {
      if (v.length === 2) {
        const next = field === 'h' ? 'm' : field === 'm' ? 's' : ''
        if (next) {
          const q = wx.createSelectorQuery().in(this)
          q.select('#in-' + next).focus()
          q.exec()
        }
      }
      this.recalc()
    })
  },

  onNote(e) {
    this.setData({ note: e.detail.value })
  },

  recalc() {
    const km = Number(this.data.km)
    const total = fmt.joinHMS(this.data.h, this.data.m, this.data.s)
    this.setData({
      paceText: fmt.pace(total, km),
      durationText: fmt.durationLabel(total)
    })
  },

  /** 上传成绩卡 —— OCR 是 P1，v1 先手输（PRD 7.3 冷启动期建议） */
  pickShot() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: () => {
        this.setData({ ocrState: 'reading' })
        wx.showToast({ title: '骨架阶段：OCR 未接入，请手动填写', icon: 'none' })
        setTimeout(() => this.setData({ ocrState: 'fail' }), 900)
      },
      fail: () => {}
    })
  },

  /** 一次性定位：用户主动点击才调用，不后台静默获取（PRD 9.8） */
  locate() {
    this.setData({ locating: true })
    wx.getLocation({
      type: 'gcj02',
      success: () => {
        // 真实项目里这里只把经纬度送去云函数换城市，本地不留坐标
        this.setData({ locating: false, city: getApp().globalData.city })
        wx.showToast({ title: '已记录所在城市', icon: 'none' })
      },
      fail: () => {
        this.setData({ locating: false })
        wx.showToast({ title: '未获取位置，可跳过', icon: 'none' })
      }
    })
  },

  async submit() {
    const km = Number(this.data.km)
    const duration_s = fmt.joinHMS(this.data.h, this.data.m, this.data.s)
    if (!km) return wx.showToast({ title: '请填写距离', icon: 'none' })
    if (!duration_s) return wx.showToast({ title: '请填写时长', icon: 'none' })

    const app = getApp()
    const userId = app.globalData.profile ? app.globalData.profile.seed : 'local'

    wx.showLoading({ title: '正在记录' })
    await db.submitCheckin(
      {
        distance_km: km,
        duration_s,
        pace_auto: duration_s / km,
        session_id: this.data.joinedSession ? this.data.joinedSession._id : '',
        note: this.data.note,
        city: this.data.city || app.globalData.city
      },
      userId
    )
    wx.hideLoading()
    this.setData({ mode: 'done' })
  },

  /** 取消参加：退出后别人看不到「已退出」痕迹（PRD 4.2 A3） */
  async leave() {
    const s = this.data.joinedSession
    if (!s) return
    const app = getApp()
    const userId = app.globalData.profile ? app.globalData.profile.seed : 'local'
    await db.leaveSession(s._id, userId)
    wx.showToast({ title: '已取消参加', icon: 'none' })
    this.setData({ joinedSession: null })
  },

  goFeed() {
    wx.switchTab({ url: '/pages/feed/index' })
  },

  again() {
    this.setData({
      mode: 'list',
      km: '',
      useCustomKm: false,
      h: '00',
      m: '00',
      s: '00',
      note: '',
      ocrState: 'idle',
      paceText: "—'—\"",
      durationText: '0分0秒'
    })
  },

  onShareAppMessage() {
    return { title: '一起跑步', path: '/pages/run/index' }
  }
})
