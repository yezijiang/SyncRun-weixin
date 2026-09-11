/**
 * 打卡：写入 checkins，回写 session_members.checkin_id，并自动生成一条
 * 「社区内可见」的动态（PRD 9.2：默认社区内可见，不提供"全部公开"开关）。
 *
 * 防作弊原则（PRD 第 8 章）：这里不做任何"是否真跑了"的校验。
 * 一旦产品变成审核工具，调性就毁了。截图只在被举报时人工查看。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_KM = 200 // 明显异常值拦截，仅防误输入，不做真实性判断
const MAX_DURATION_S = 24 * 3600

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { distance_km, duration_s, session_id, note, city, screenshot_url, source } = event

  const km = Number(distance_km)
  const dur = Number(duration_s)

  if (!OPENID) return { ok: false, error: 'no_openid' }
  if (!isFinite(km) || km <= 0 || km > MAX_KM) return { ok: false, error: 'bad_distance' }
  if (!isFinite(dur) || dur <= 0 || dur > MAX_DURATION_S) return { ok: false, error: 'bad_duration' }

  const now = Date.now()
  const checkins = db.collection('checkins')

  const res = await checkins.add({
    data: {
      user_id: OPENID,
      session_id: session_id || '',
      city: city || '深圳',
      distance_km: km,
      duration_s: dur,
      // 配速实时可算，这里存一份便于聚合查询
      pace_auto: Math.round(dur / km),
      note: (note || '').slice(0, 200),
      screenshot_url: screenshot_url || '',
      source: source === 'ocr' ? 'ocr' : 'manual',
      created_at: now
    }
  })

  if (session_id) {
    const sm = await db
      .collection('session_members')
      .where({ session_id, user_id: OPENID })
      .limit(1)
      .get()

    if (sm.data.length) {
      await db.collection('session_members').doc(sm.data[0]._id).update({
        data: { checkin_id: res._id }
      })
    } else {
      // 没加入过场次也允许打卡（自由跑），但补一条成员记录便于统计
      await db.collection('session_members').add({
        data: { session_id, user_id: OPENID, joined_at: now, checkin_id: res._id }
      })
    }
  }

  await db.collection('posts').add({
    data: {
      user_id: OPENID,
      type: 'checkin',
      checkin_id: res._id,
      session_id: session_id || '',
      content: (note || '').slice(0, 200),
      images: screenshot_url ? [screenshot_url] : [],
      visibility: 'community',
      cheer_count: 0,
      comment_count: 0,
      created_at: now
    }
  })

  // 城市统计：累计口径，用于「今天 X 人跑过」与城市点亮
  const stats = db.collection('city_stats')
  const dayStart = startOfDay(now)
  const hit = await stats
    .where({ city: city || '深圳', date: _.gte(dayStart) })
    .limit(1)
    .get()

  if (hit.data.length) {
    await stats.doc(hit.data[0]._id).update({
      data: { runner_count: _.inc(1), total_km: _.inc(km) }
    })
  } else {
    await stats.add({
      data: { city: city || '深圳', date: dayStart, runner_count: 1, total_km: km }
    })
  }

  return { ok: true, checkinId: res._id }
}

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
