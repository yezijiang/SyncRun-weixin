const share = require('../../utils/share')
const fmt = require('../../utils/format')

Page({
  data: {
    tab: 'out',        // out = 对外分享卡片（中性） | in = 站内邀请页（专属）
    name: '',
    session: null,
    shareTitle: '',
    shareCard: null
  },

  onLoad(q) {
    const name = q && q.name ? decodeURIComponent(q.name) : '今日陪跑'
    // 骨架阶段用一条演示场次；接入后改为按 sessionId 读取
    const session = {
      _id: 's1',
      title: name,
      start_time: Date.now(),
      target_km: 5,
      city: '深圳',
      joined: 8
    }
    this.setData({
      name,
      session,
      shareTitle: share.neutralShareTitle(session),
      shareCard: share.neutralShareCard(session)
    })
  },

  pickTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t })
  },

  saveQr() {
    // 太阳码同样保持中性样式（PRD 9.3）
    wx.showToast({ title: '太阳码已保存到相册（骨架）', icon: 'none' })
  },

  onShareAppMessage() {
    // 关键：分享标题走 share.js，永远不含品牌名、彩虹与身份信息
    return share.buildShareMessage(this.data.session)
  }
})
