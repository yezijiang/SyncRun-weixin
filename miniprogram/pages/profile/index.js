const db = require('../../utils/db')

const GENDER_TEXT = { male: '男', female: '女', nonbinary: '非二元' }

Page({
  data: {
    state: 'loading',   // loading | ready | hidden | notfound
    profile: null,
    genderText: '',
    posts: []
  },

  onLoad(q) {
    const id = q && q.id
    if (!id) {
      this.setData({ state: 'notfound' })
      return
    }
    this.userId = id
    this.fetch()
  },

  async fetch() {
    const r = await db.getProfile(this.userId)
    if (!r.ok) {
      this.setData({ state: r.error === 'not_found' ? 'notfound' : 'notfound' })
      return
    }
    if (r.hidden) {
      this.setData({ state: 'hidden' })
      return
    }
    this.setData({
      state: 'ready',
      profile: r.profile,
      genderText: GENDER_TEXT[r.profile.gender] || '',
      posts: (r.posts || []).map((p) => ({ ...p, timeText: this.ago(p.created_at) }))
    })
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

  /** 屏蔽：双向不可见，PRD 9.4。单向屏蔽会变成跟踪工具 */
  async blockUser() {
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '屏蔽这个跑友',
        content: '你们将互相看不到对方的动态与搜索结果。确定吗？',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false)
      })
    })
    if (!ok) return
    const r = await db.blockUser(this.userId)
    if (!r.ok) return wx.showToast({ title: '屏蔽失败，稍后再试', icon: 'none' })
    wx.showToast({ title: '已屏蔽', icon: 'none' })
    wx.navigateBack({ fail: () => {} })
  },

  /** 举报分级，与动态页同一个流程 */
  async reportUser() {
    const reasons = ['垃圾营销或广告', '人身攻击或不友善', '骚扰或不当互动', '泄露他人隐私', '其他不当行为']
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

    const r = await db.reportUser(this.userId, picked + (extra ? '｜' + extra : ''))
    wx.showToast({
      title: r.ok ? '已提交，我们会在 24 小时内处理' : '提交失败，稍后再试',
      icon: 'none'
    })
  }
})
