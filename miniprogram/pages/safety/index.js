const db = require('../../utils/db')

/**
 * 安全中心（UI v2.0）。
 *
 * 这个页面的每个开关都对应云函数里的一段过滤逻辑：
 *   visible_scope → search（谁能搜到我）+ feed（动态是否进同城流）
 *   ghost_until   → search / feed，24 小时内彻底消失
 *   allow_cheer   → interact.cheer，陌生人不能给我加油
 * 改这里不改服务端，等于给用户一个点了没用的按钮，比不提供更有害。
 */
const SCOPES = [
  { key: 'city', label: '同城可见', note: '默认。同城的人能看到你、搜到你，动态进入同城流' },
  { key: 'cheered', label: '仅互相加油过的人', note: '只有互相加油过的人能搜到你，动态不进同城流' },
  { key: 'hidden', label: '隐身', note: '谁都看不到你，也不出现在任何推荐里。你仍然可以正常打卡' }
]

Page({
  data: {
    scope: 'city',
    scopes: SCOPES,
    scopeNote: SCOPES[0].note,
    searchable: true,
    allowFeed: true,
    allowCheer: true,
    ghostUntil: 0,
    ghostLeft: '',
    blocked: [],
    exporting: false
  },

  onShow() {
    this.fetch()
  },

  async fetch() {
    const r = await db.getSettings()
    const scope = r.visible_scope || 'city'
    const found = SCOPES.filter((s) => s.key === scope)[0]
    this.setData({
      scope,
      scopeNote: found ? found.note : SCOPES[0].note,
      searchable: r.searchable !== false,
      allowFeed: r.allow_feed !== false,
      allowCheer: r.allow_cheer !== false,
      ghostUntil: r.ghost_until || 0,
      ghostLeft: ghostLeft(r.ghost_until),
      blocked: r.blocked || []
    })
  },

  async pickScope(e) {
    const v = e.currentTarget.dataset.v
    if (v === this.data.scope) return
    const found = SCOPES.filter((s) => s.key === v)[0]
    this.setData({ scope: v, scopeNote: found ? found.note : '' })
    const r = await db.setVisibility(v)
    if (!r.ok) {
      this.fetch()
      wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })
    }
  },

  async toggleSearchable(e) {
    const v = e.detail.value
    this.setData({ searchable: v })
    const r = await db.setSearchable(v)
    if (!r.ok) {
      this.setData({ searchable: !v })
      wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })
    }
  },

  async toggleFeed(e) {
    const v = e.detail.value
    this.setData({ allowFeed: v })
    const r = await db.setFeedVisible(v)
    if (!r.ok) {
      this.setData({ allowFeed: !v })
      wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })
    }
  },

  async toggleCheer(e) {
    const v = e.detail.value
    this.setData({ allowCheer: v })
    const r = await db.setCheerAllowed(v)
    if (!r.ok) {
      this.setData({ allowCheer: !v })
      wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })
    }
  },

  /** 隐身：临时消失，但已加入的场次不受影响——报名了却消失对同场的人是另一种冒犯 */
  async ghost() {
    const r = await db.ghostMode(false)
    if (!r.ok) return wx.showToast({ title: '没成功，稍后再试', icon: 'none' })
    this.setData({ ghostUntil: r.ghostUntil || Date.now() + 86400000, ghostLeft: ghostLeft(r.ghostUntil) })
    wx.showToast({ title: '已隐身 24 小时', icon: 'none' })
  },

  async unghost() {
    const r = await db.ghostMode(true)
    if (!r.ok) return wx.showToast({ title: '没成功，稍后再试', icon: 'none' })
    this.setData({ ghostUntil: 0, ghostLeft: '' })
    wx.showToast({ title: '已恢复可见', icon: 'none' })
  },

  async unblock(e) {
    const id = e.currentTarget.dataset.id
    const r = await db.unblockUser(id)
    if (!r.ok) return wx.showToast({ title: '没成功，稍后再试', icon: 'none' })
    this.fetch()
  },

  /**
   * 导出数据：拿到文本后放进剪贴板。
   * 不写文件、不上云——导出的是用户自己的东西，能少一次流转就少一次。
   */
  async exportData() {
    this.setData({ exporting: true })
    const r = await db.exportData()
    this.setData({ exporting: false })

    if (!r.ok) return wx.showToast({ title: '导出失败，稍后再试', icon: 'none' })
    wx.setClipboardData({
      data: r.text,
      success: () => {
        wx.showModal({
          title: '已复制',
          content: '共 ' + r.counts.checkins + ' 条打卡、' + r.counts.posts + ' 条动态，已复制到剪贴板',
          showCancel: false
        })
      }
    })
  }
})

function ghostLeft(until) {
  if (!until || until <= Date.now()) return ''
  const h = Math.ceil((until - Date.now()) / 3600000)
  return h + ' 小时'
}
