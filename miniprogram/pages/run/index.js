const db = require('../../utils/db')
const fmt = require('../../utils/format')

const DISTANCE_CHIPS = [3, 5, 8, 10, 15, 21.1]
const PACE_OPTIONS = ['不限', "6'00\" 以内", "6'00\"–7'00\"", "7'00\"–8'00\"", "8'00\" 以外"]

// 云函数错误码 -> 用户能看懂的话。不要把 code 直接弹给用户
const ERR_TEXT = {
  cloud_unavailable: '云服务还没就绪，请先在开发者工具部署云函数',
  no_title: '给这场跑起个名字吧',
  title_too_long: '名字最多 30 个字',
  bad_start_time: '开始时间不太对',
  start_time_past: '不能发起一场已经过去的跑',
  start_time_too_far: '最多只能发起 30 天内的场次',
  bad_target_km: '距离填得不太对',
  offline_only_daytime: '线下见面请选 6:00–18:00 的公共场地',
  daily_limit: '今天发起得有点多，明天再来',
  risky_content: '文字没通过内容安全校验，换个说法试试',
  session_closed: '这场已经结束或取消了',
  not_found: '场次不存在',
  not_owner: '只有发起者能解散这场'
}

Page({
  data: {
    mode: 'list',            // list | create | checkin | done
    sessions: [],
    joinedSession: null,
    distanceChips: DISTANCE_CHIPS,
    paceOptions: PACE_OPTIONS,
    startText: '',
    submitting: false,
    // 发起表单
    form: {
      title: '',
      startIndex: 0,
      date: '',
      time: '',
      km: '5',
      useCustomKm: false,
      paceIndex: 0,
      mode: 'online',
      poi_name: '',
      poi_lat: null,
      poi_lng: null
    },
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
    // 首页的「发起」按钮是 tab 跳转，只能用全局标记把意图带过来
    if (getApp().globalData.pendingAction === 'create') {
      getApp().globalData.pendingAction = ''
      this.openCreate()
    }
  },

  async fetch() {
    const res = await db.getHome()
    const joined = res.sessions.filter((s) => s.iJoined)
    this.setData({
      sessions: res.sessions.map((s) => ({
        ...s,
        timeText: fmt.sessionTime(s.start_time)
      })),
      joinedSession: joined.length ? joined[0] : null
    })
    this.recalc()
  },

  errText(code) {
    return ERR_TEXT[code] || '操作失败，稍后再试'
  },

  checkinEntry() {
    this.setData({ mode: 'checkin' })
  },

  /* ---------- 发起场次 ---------- */

  openCreate() {
    const now = new Date()
    const tonight = atHour(now, 20, 0)
    // 今晚 20:00 已经过去了就顺延到明天，否则会撞上「不能发起过去的场次」
    const t0 = tonight > Date.now() ? tonight : tonight + 86400000
    const t1 = atHour(now, 6, 30) + 86400000

    this.setData({
      mode: 'create',
      form: {
        title: '',
        startIndex: 0,
        date: fmt.dateValue(t0),
        time: fmt.timeValue(t0),
        km: '5',
        useCustomKm: false,
        paceIndex: 0,
        mode: 'online',
        poi_name: '',
        poi_lat: null,
        poi_lng: null
      },
      _starts: [t0, t1, t0],
      startText: fmt.dateTime(t0)
    })
  },

  cancelCreate() {
    this.setData({ mode: 'list' })
  },

  pickStart(e) {
    const i = Number(e.currentTarget.dataset.i)
    const starts = this.data._starts || []
    this.setData({ 'form.startIndex': i }, () => this.syncStartText())
  },

  onDate(e) {
    this.setData({ 'form.date': e.detail.value }, () => this.syncStartText())
  },

  onTime(e) {
    this.setData({ 'form.time': e.detail.value }, () => this.syncStartText())
  },

  /** 时间文案与真实时间戳必须同源，否则用户看到的时间可能和落库的不一致 */
  syncStartText() {
    const ts = this.startTimestamp()
    this.setData({ startText: fmt.dateTime(ts) })
  },

  startTimestamp() {
    const f = this.data.form
    if (f.startIndex === 2) {
      const parts = String(f.date || '').split('-')
      const hm = String(f.time || '00:00').split(':')
      const d = new Date(
        Number(parts[0]) || new Date().getFullYear(),
        (Number(parts[1]) || 1) - 1,
        Number(parts[2]) || 1,
        Number(hm[0]) || 0,
        Number(hm[1]) || 0,
        0,
        0
      )
      return d.getTime()
    }
    const starts = this.data._starts || []
    return starts[f.startIndex] || Date.now()
  },

  onFormKmChip(e) {
    const v = e.currentTarget.dataset.v
    this.setData({ 'form.km': String(v), 'form.useCustomKm': false })
  },

  onFormKmInput(e) {
    this.setData({ 'form.km': e.detail.value, 'form.useCustomKm': !!e.detail.value })
  },

  pickPace(e) {
    this.setData({ 'form.paceIndex': Number(e.currentTarget.dataset.i) })
  },

  pickMode(e) {
    this.setData({ 'form.mode': e.currentTarget.dataset.v })
  },

  onForm(e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['form.' + k] = e.detail.value
    this.setData(patch)
  },

  /**
   * 地图选点只取地点名与坐标，坐标留在服务端用于后续的同城聚合，
   * 前端不展示、不上传轨迹（PRD 9.8：地理只到城市粒度）
   */
  choosePoi() {
    wx.chooseLocation({
      success: (r) => {
        this.setData({
          'form.poi_name': (r.name || '').slice(0, 30),
          'form.poi_lat': r.latitude,
          'form.poi_lng': r.longitude
        })
      },
      fail: () => {}
    })
  },

  async submitCreate() {
    const f = this.data.form
    if (!f.title.trim()) {
      return wx.showToast({ title: '给这场跑起个名字吧', icon: 'none' })
    }
    const km = Number(f.km)
    if (!isFinite(km) || km <= 0 || km > 100) {
      return wx.showToast({ title: '距离填得不太对', icon: 'none' })
    }
    if (f.mode === 'offline' && !f.poi_name) {
      return wx.showToast({ title: '线下见面要选个地点', icon: 'none' })
    }

    this.setData({ submitting: true })
    const r = await db.createSession({
      title: f.title.trim(),
      start_time: this.startTimestamp(),
      target_km: km,
      pace_range: PACE_OPTIONS[f.paceIndex] || '不限',
      mode: f.mode,
      poi_name: f.poi_name,
      poi_lat: f.poi_lat,
      poi_lng: f.poi_lng,
      grace_minutes: 90
    })
    this.setData({ submitting: false })

    if (!r.ok) return wx.showToast({ title: this.errText(r.error), icon: 'none' })

    wx.showToast({ title: '已发起，等第一个人加入', icon: 'none' })
    this.setData({ mode: 'list' })
    this.fetch()
  },

  async cancelSession() {
    const s = this.data.joinedSession
    if (!s) return
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '解散这场陪跑',
        content: '已经加入的人会看到这场被取消，确定吗？',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!ok) return
    const r = await db.cancelSession(s._id)
    if (!r.ok) return wx.showToast({ title: this.errText(r.error), icon: 'none' })
    wx.showToast({ title: '已解散', icon: 'none' })
    this.setData({ joinedSession: null })
    this.fetch()
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
        wx.showToast({ title: 'OCR 未接入，请手动填写', icon: 'none' })
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

    wx.showLoading({ title: '正在记录' })
    const r = await db.submitCheckin({
      distance_km: km,
      duration_s,
      session_id: this.data.joinedSession ? this.data.joinedSession._id : '',
      note: this.data.note,
      city: this.data.city || getApp().globalData.city
    })
    wx.hideLoading()

    if (!r.ok) return wx.showToast({ title: this.errText(r.error), icon: 'none' })
    this.setData({ mode: 'done' })
  },

  /** 取消参加：退出后别人看不到「已退出」痕迹（PRD 4.2 A3） */
  async leave() {
    const s = this.data.joinedSession
    if (!s) return
    const r = await db.leaveSession(s._id)
    if (!r.ok) return wx.showToast({ title: this.errText(r.error), icon: 'none' })
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

function atHour(base, h, m) {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
