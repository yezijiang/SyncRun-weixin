/**
 * 分享物料构造器 —— 双层表达的代码层防线（PRD 1.2 / 9.3）
 *
 * 规则很简单，但很容易在迭代中被改坏：
 *   对外分享卡只允许出现：时间 · 距离 · 城市 · 人数
 *   禁止出现：品牌名、Slogan、彩虹元素、用户昵称、用户头像
 *
 * 所以这里不提供「往分享文案里塞品牌」的口子。任何想加品牌名的需求，
 * 都应该先回到 PRD 1.2 讨论，而不是改这个文件。
 */

/**
 * 纯文本分享标题（微信会话中卡片下方的文案）
 * @param {{title?:string, start_time:number, target_km:number, city:string, joined:number}} s
 */
function neutralShareTitle(s) {
  const parts = []
  const t = formatTime(s.start_time)
  if (t) parts.push(t)
  if (s.city) parts.push(s.city)
  if (s.target_km) parts.push(`一起跑 ${s.target_km}KM`)
  if (s.joined) parts.push(`已有 ${s.joined} 人`)
  return parts.join(' · ') || '一起跑步'
}

/**
 * 分享图（5:4）用的文字层，同样保持中性
 */
function neutralShareCard(s) {
  return {
    title: s.target_km ? `一起跑 ${s.target_km}KM` : '一起跑步',
    subtitle: [formatTime(s.start_time), s.city].filter(Boolean).join(' · '),
    meta: s.joined ? `已有 ${s.joined} 人加入` : '',
    // 明确声明：调用方不得覆盖以下两个字段
    __noBrand: true,
    __noAvatar: true
  }
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay) return `今晚 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/**
 * 提供给页面 onShareAppMessage 直接使用
 */
function buildShareMessage(session) {
  return {
    title: neutralShareTitle(session),
    path: `/pages/run/index?sessionId=${session._id || ''}`,
    imageUrl: '' // 由调用方传入中性分享图，不得使用品牌海报
  }
}

module.exports = { neutralShareTitle, neutralShareCard, buildShareMessage }
