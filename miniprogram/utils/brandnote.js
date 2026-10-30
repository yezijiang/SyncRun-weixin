/**
 * 品牌便签（UI v2.4）：进入时浮出的「致每一位跑者」便签纸。
 *
 * 出现规则：
 *   - 用户没关过（默认开）
 *   - 每次冷启动最多浮出一次（存的是内存标记，杀掉小程序就重新算一次）
 *   - 公共场合不想被看到的人可以在设置里永久关掉——这条是「肩膀冲浪」对策，
 *     不是可有可无的装饰开关
 */

const ENABLE_KEY = 'brand_note_enabled'

function isEnabled() {
  return wx.getStorageSync(ENABLE_KEY) !== false
}

function setEnabled(v) {
  wx.setStorageSync(ENABLE_KEY, !!v)
}

module.exports = { isEnabled, setEnabled }
