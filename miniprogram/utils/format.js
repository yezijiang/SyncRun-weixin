/**
 * 展示层格式化。
 * 存储约定（PRD 第 6 章）：时长一律存总秒数，配速实时算、不单独存储。
 */

/** 总秒数 -> 时分秒文本，用于打卡输入与详情展示 */
function hms(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${m}:${pad(sec)}`
}

/** 总秒数 -> 带小时单位的中文（成功页用） */
function durationLabel(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${sec}秒`
  return `${sec}秒`
}

/** 配速：秒/公里 -> 5'38" */
function pace(totalSeconds, km) {
  if (!km || km <= 0) return "—'—\""
  const perKm = totalSeconds / km
  if (!isFinite(perKm) || perKm <= 0) return "—'—\""
  const m = Math.floor(perKm / 60)
  const s = Math.round(perKm % 60)
  return `${m}'${pad(s)}"`
}

/** 供 <input type="digit"> 的三段输入使用 */
function splitHMS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  return {
    h: String(Math.floor(s / 3600)).padStart(2, '0'),
    m: String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
    s: String(s % 60).padStart(2, '0')
  }
}

function joinHMS(h, m, s) {
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)
}

/** 距离：统一保留一位小数，整数不补 .0 之外的多余位 */
function km(v) {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return '0.00'
  return n.toFixed(2)
}

/** 场次时间的口语化展示 */
function sessionTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const dayDiff = dayKey(d) === dayKey(now) ? 0 : dayKey(d) === dayKey(new Date(now.getTime() + 86400000)) ? 1 : -1
  const prefix = dayDiff === 0 ? '今晚' : dayDiff === 1 ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (dayDiff === 0 || dayDiff === 1) return `${prefix} ${hm}`
  return `${prefix} ${hm}`
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

module.exports = { hms, durationLabel, pace, splitHMS, joinHMS, km, sessionTime, pad }
