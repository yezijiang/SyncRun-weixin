const db = require('../../utils/db')

/**
 * 设置与隐私。
 *
 * 这个页面对本项目不是「设置页」那么简单：用户敢不敢用，很大程度取决于
 * 能不能自己控制「被谁找到」「能不能彻底走掉」。所以注销要真删，
 * 屏蔽要能解除，可见范围要写清楚——含糊其辞等于没给安全感。
 */
Page({
  data: {
    searchable: true,
    blocked: [],
    deleting: false
  },

  onShow() {
    this.fetch()
  },

  async fetch() {
    const r = await db.getSettings()
    this.setData({
      searchable: r.searchable !== false,
      blocked: r.blocked || []
    })
  },

  async toggleSearchable(e) {
    const next = e.detail.value
    // 先改 UI，失败再回滚：开关等回包会让人以为没点到
    this.setData({ searchable: next })
    const r = await db.setSearchable(next)
    if (!r.ok) {
      this.setData({ searchable: !next })
      wx.showToast({ title: '没保存成功，稍后再试', icon: 'none' })
    }
  },

  async unblock(e) {
    const id = e.currentTarget.dataset.id
    const r = await db.unblockUser(id)
    if (!r.ok) return wx.showToast({ title: '解除失败，稍后再试', icon: 'none' })
    wx.showToast({ title: '已解除，你们又能看到彼此了', icon: 'none' })
    this.fetch()
  },

  /**
   * 注销：两次确认。第一次说明后果，第二次要求打字。
   * 这个操作不可逆，多一步摩擦是应该的。
   */
  deleteAccount() {
    wx.showModal({
      title: '注销账号',
      content:
        '会删除：你的全部打卡、动态、鼓励、场次与队伍关系、生成式身份。\n\n' +
        '不会删除：别人提交过的举报记录（那是别人的凭证）。\n\n' +
        '此操作无法撤销。',
      confirmText: '我已了解',
      confirmColor: '#FF4D6D',
      success: (r) => {
        if (r.confirm) this.confirmDelete()
      }
    })
  },

  confirmDelete() {
    wx.showModal({
      title: '最后确认',
      content: '真的要注销吗？删掉之后就找不回来了。',
      confirmText: '确认注销',
      confirmColor: '#FF4D6D',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '正在删除' })
        const res = await db.deleteAccount()
        wx.hideLoading()

        if (!res.ok) {
          return wx.showToast({ title: '注销失败，稍后再试', icon: 'none' })
        }

        // 本地身份必须一起清掉，否则下次打开会拿着一个服务端已不存在的种子继续跑
        require('../../utils/identity').resetIdentity()
        getApp().globalData.profile = null

        wx.showModal({
          title: '已注销',
          content: '你的数据已经删除。下次打开会是一个全新的身份。',
          showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/home/index' })
        })
      }
    })
  }
})
