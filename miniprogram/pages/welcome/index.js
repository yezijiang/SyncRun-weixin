/**
 * 欢迎页（UI v2.3 首进流程）：
 *   欢迎与承诺 → 勾选同意 → 三步引导 → 进入首页（便签随之浮出）
 *
 * 只在第一次进入时出现（app.js 检查 welcomed_v1 标记），
 * 引导文案必须与产品实际能力一致——v1 没有 OCR，就绝不提自动识别。
 */

Page({
  data: {
    agreed: false,
    step: -1, // -1 = 引导未开始
    steps: [
      {
        num: '①',
        t: '同频跑：一个人跑，也不算一个人跑',
        d: '跑步是异步同行的——同一时段各自开跑，跑完回来打卡，就能看到今晚和你一起跑的人。\n\n没有滑卡、没有私信、没有人能定位你。'
      },
      {
        num: '②',
        t: '三步就能加入一场陪跑',
        d: '1. 在「去跑」挑一场时间、距离合适的\n2. 点「加入陪跑」，到点用你习惯的方式开跑\n3. 跑完回来打卡，记录你的距离与时长\n\n不想约人，也可以直接「开始我的跑步」。'
      },
      {
        num: '③',
        t: '你的安全是默认设置',
        d: '· 头像昵称默认系统生成，不会自动拉取微信资料\n· 只在你主动点的时候读一次位置，不持续追踪\n· 分享到微信的卡片是中性内容，不含身份信息\n· 任何卡片都能一键举报与双向屏蔽'
      }
    ]
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  /** 同意后进引导。标记先写下——就算中途杀掉，也不该再看一遍长文案 */
  accept() {
    if (!this.data.agreed) {
      wx.showToast({ title: '先勾选同意再进入', icon: 'none' })
      return
    }
    wx.setStorageSync('welcomed_v1', true)
    getApp().globalData.onboarded = true
    this.setData({ step: 0 })
  },

  onbPrev() {
    if (this.data.step > 0) this.setData({ step: this.data.step - 1 })
  },

  onbNext() {
    if (this.data.step < 2) {
      this.setData({ step: this.data.step + 1 })
      return
    }
    // 引导走完进首页，同时让品牌便签浮出一次（UI v2.3 流程）
    const app = getApp()
    app.globalData.noteShownThisLaunch = false
    app.globalData.forceNote = true
    wx.switchTab({ url: '/pages/home/index' })
  }
})
