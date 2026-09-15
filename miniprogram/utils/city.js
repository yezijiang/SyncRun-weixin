/**
 * 当前城市。
 *
 * 城市是数据字段，不是常量：v1 首发深圳，但切换到别的城市只应该改数据，
 * 不该改代码。这里负责「用户选了哪座城市」的读写与持久化。
 *
 * 存本地而不是每次问服务端：城市是浏览上下文，打开小程序就该立刻生效，
 * 等一次网络往返会让首屏先闪一下别的城市。
 */

const STORAGE_KEY = 'tf_city_v1'
const config = require('../config')

function get() {
  const app = (typeof getApp === 'function' && getApp()) || null
  if (app && app.globalData && app.globalData.city) return app.globalData.city
  return wx.getStorageSync(STORAGE_KEY) || config.defaultCity
}

/** 切换城市：同时更新内存与本地存储，服务端同步由调用方负责 */
function set(city) {
  if (!city) return get()
  wx.setStorageSync(STORAGE_KEY, city)
  const app = (typeof getApp === 'function' && getApp()) || null
  if (app && app.globalData) app.globalData.city = city
  return city
}

/** 启动时把本地存储的城市灌回内存 */
function restore() {
  const app = (typeof getApp === 'function' && getApp()) || null
  if (!app || !app.globalData) return
  app.globalData.city = wx.getStorageSync(STORAGE_KEY) || config.defaultCity
}

/**
 * 可选城市：已点亮的 + 计划中的。
 * 服务端已经把「已点亮 / 未点亮」一起返回了，这里只是给设置页一个兜底列表，
 * 免得服务端还没数据时选择页是空的。
 */
function fallbackList(current) {
  const base = ['深圳', '上海', '成都', '北京', '广州', '杭州']
  return base.map((c) => ({ city: c, lit: c === '深圳', current: c === current }))
}

module.exports = { get, set, restore, fallbackList, STORAGE_KEY }
