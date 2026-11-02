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
    // v2.1 发起即邀请：发起成功后带真实场次参数进来
    // 没带 id 的旧入口（如站内分享跳转）仍保留演示场次兜底
    let session
    if (q && q.id) {
      session = {
        _id: q.id,
        title: q.title ? decodeURIComponent(q.title) : '今日陪跑',
        start_time: Number(q.t) || Date.now(),
        target_km: Number(q.km) || 5,
        city: getApp().globalData.city,
        joined: 1
      }
    } else {
      const name = q && q.name ? decodeURIComponent(q.name) : '今日陪跑'
      session = {
        _id: 's1',
        title: name,
        start_time: Date.now(),
        target_km: 5,
        city: '深圳',
        joined: 8
      }
    }

    this.setData({
      name: session.title,
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
