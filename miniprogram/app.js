const { ensureIdentity } = require('./utils/identity')

App({
  globalData: {
    // 当前城市：v1 深圳单城，但城市始终是数据字段，不硬编码在业务逻辑里
    city: '深圳',
    // 当前用户档案（含生成式昵称与几何头像），登录后填充
    profile: null,
    // 云开发是否就绪：AppID 未填写时为 false，页面需降级到本地 mock
    cloudReady: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[同频跑] 基础库版本过低，请使用 2.2.3 及以上版本')
      return
    }

    // AppID 未配置时 create 会失败，这里捕获后走本地 mock，保证骨架可预览
    try {
      wx.cloud.init({ traceUser: true })
      this.globalData.cloudReady = true
    } catch (e) {
      console.warn('[同频跑] 云开发未初始化（通常是还没填 AppID），当前使用本地 mock 数据', e)
      this.globalData.cloudReady = false
    }

    // 身份脱敏是 P0：不拉取微信头像昵称，一律用生成式身份（PRD 9.1）
    ensureIdentity().then((profile) => {
      this.globalData.profile = profile
      if (typeof this.profileReady === 'function') this.profileReady(profile)
    })
  },

  // 页面可通过 app.onProfileReady(cb) 等待身份就绪，避免异步竞态
  onProfileReady(cb) {
    if (this.globalData.profile) {
      cb(this.globalData.profile)
    } else {
      this.profileReady = cb
    }
  }
})
