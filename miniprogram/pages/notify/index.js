const db = require('../../utils/db')

/**
 * 消息中心（UI v2.0）。
 *
 * 五类消息：鼓励 / 报名 / 约跑 / 取消 / 提醒。每类带一个能就地完成的操作——
 * 「消息只能看」是冷启动期最容易让人流失的设计。
 *
 * 隐私相关消息（举报结果等）服务端已经把对方信息全部剥掉了，
 * 这里连 target 都不渲染，也不提供跳转。
 */
const TYPE_TEXT = {
  cheer: '鼓励',
  join: '报名',
  invite: '约跑',
  cancel: '取消',
  remind: '提醒',
  comment: '评论',
  privacy: '隐私',
  system: '系统'
}

// 内联操作的文案与去向
const ACTIONS = {
  cheer: '回一个加油',
  join: '查看报名的人',
  invite: '接受并加入',
  cancel: '看看其他场次',
  remind: '去这场看看',
  comment: '去回复'
}

Page({
  data: {
    messages: [],
    typeText: TYPE_TEXT
  },

  onShow() {
    this.fetch()
  },

  async fetch() {
    const res = await db.getMessages()
    this.setData({
      messages: res.messages.map((m) => ({
        ...m,
        timeText: timeAgo(m.created_at),
        actionText: ACTIONS[m.type] || ''
      }))
    })
  },

  async readAll() {
    const r = await db.readMessages(null)
    if (!r.ok) return wx.showToast({ title: '没成功，稍后再试', icon: 'none' })
    this.fetch()
  },

  open(e) {
    const m = this.data.messages[Number(e.currentTarget.dataset.i)]
    if (!m) return
    if (m.type === 'privacy') return // 隐私消息刻意不给跳转
    if (m.type === 'remind' || m.type === 'cancel' || m.type === 'invite') {
      wx.switchTab({ url: '/pages/run/index' })
      return
    }
    if (m.type === 'join') {
      wx.switchTab({ url: '/pages/me/index' })
      return
    }
    wx.switchTab({ url: '/pages/feed/index' })
  },

  /** 内联操作：能就地做完的，就不跳页面 */
  async act(e) {
    const m = this.data.messages[Number(e.currentTarget.dataset.i)]
    if (!m) return

    if (m.type === 'cheer') {
      if (!m.target_id) return
      const r = await db.cheerBack(m.target_id)
      wx.showToast({
        title: r.ok ? (r.duplicated ? '已经加过油了' : '已回一个加油') : '没成功，稍后再试',
        icon: 'none'
      })
      return
    }

    if (m.type === 'invite') {
      if (!m.target_id) return
      const r = await db.joinSession(m.target_id)
      wx.showToast({
        title: r.ok ? '已加入这场陪跑' : '这场可能已经结束了',
        icon: 'none'
      })
      return
    }

    // 其余类型的「操作」本质是去对应页面，交给 open 处理
    this.open(e)
  }
})

/** 相对时间：消息列表里「20 分钟前」比时间戳好用 */
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
