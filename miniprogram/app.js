const { ensureIdentity } = require('./utils/identity')
const config = require('./config')

App({
  globalData: {
    // 当前城市：v1 深圳单城，但城市始终是数据字段，不硬编码在业务逻辑里
    city: config.defaultCity,
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

    // traceUser 显式关掉：它会在云开发控制台留下用户访问轨迹，
    // 对一个把隐私当命的产品来说，没必要留的就不留
    try {
      wx.cloud.init({
        env: config.cloudEnv || undefined,
        traceUser: false
      })
      this.globalData.cloudReady = true
      if (!config.cloudEnv) {
        console.warn('[同频跑] 还没填云环境 ID（miniprogram/config.js → cloudEnv），云调用会失败')
      }
    } catch (e) {
      console.warn('[同频跑] 云开发初始化失败，当前降级到本地 mock 数据', e)
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
