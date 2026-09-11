# 同频跑 · 开发上手

> 微信小程序（原生框架 + 云开发）· 首发深圳 · 权威需求见 `docs/PRD-同频跑-v1.3.md`

---

## 一、开工前必须先办掉的事（阻塞）

| # | 事项 | 为什么阻塞 |
|---|---|---|
| 1 | **注册个体工商户**，用它注册小程序拿 AppID | 个人主体做此定位不可能过审；且官方口径对「个人主体能否变更为个体户」说法矛盾，不要赌 |
| 2 | 拿到 AppID 后填进 `project.config.json` | 云开发、真机预览、订阅消息、太阳码、地图选点全部依赖 AppID |
| 3 | 小程序后台**名称占位**（同频跑） | 微信要求名称唯一，被抢了商标也白搭 |
| 4 | 中国商标网检索同名近似，建议注册 9/42/41/45 四类 | — |

**填 AppID 的位置**：

```jsonc
// project.config.json
"appid": "touristappid"   // ← 改成你的 wx 开头 AppID
```

未填写时工程仍可在开发者工具中打开预览（走 `utils/mock.js` 的本地数据），
但云开发相关能力全部不可用。

---

## 二、目录结构

```
miniprogram/                 小程序前端
  app.js / app.json / app.wxss
  assets/tabbar/             自绘 Tab 图标（由 tools/gen_tabicons.py 生成）
  pages/
    home/                    发现 —— 今晚场次 / 点亮城市
    run/                     去跑 —— 场次 + 打卡（核心）
    friends/                 跑友 —— 发起组队 / 加入 / 邀请 / 搜索四入口
    feed/                    动态 —— 鼓励 + 举报屏蔽
    me/                      我的 —— 生成式身份 / 足迹 / 成就
    search/                  搜索 —— 活动 / 跑友 / 队伍 三档
    invite/                  邀请 —— 双层表达对比（对外中性 / 站内专属）
  utils/
    identity.js              身份脱敏（P0）：生成式昵称 + 彩虹几何头像
    session.js               场次状态机（P0）：推导「此刻正在奔跑」
    share.js                 分享物料（P0）：保证对外卡片中性
    db.js                    数据访问层 + 双向屏蔽过滤 + mock 降级
    format.js                时长 / 配速 / 距离格式化
    mock.js                  本地演示数据
cloudfunctions/
  login/                     换取 openid（作为身份种子）
  checkin/                   打卡写入 + 生成动态 + 城市统计
  sessionStatus/             场次状态汇总 + 双向屏蔽
tools/
  gen_tabicons.py            生成 Tab 图标（纯标准库）
```

---

## 三、本地跑起来

1. 打开微信开发者工具 → 导入项目 → 选择仓库根目录
2. AppID 填 `touristappid` 可先看界面（云开发关闭，走 mock）
3. 填了真实 AppID 后：工具栏「云开发」→ 新建环境

---

## 四、云开发数据库初始化

在云开发控制台手动创建以下集合（权限建议全部选 **「仅创建者可读写」**，
跨用户读取一律走云函数，避免前端直连读到他人数据）：

| 集合 | 说明 | 建议索引 |
|---|---|---|
| `users` | 用户，仅存 openid + 生成式身份 | `openid`（唯一） |
| `checkins` | 打卡记录 | `user_id + created_at`、`session_id` |
| `sessions` | 陪跑场次 | `city + status + start_time` |
| `session_members` | 场次成员（含 `left_at` / `checkin_id`） | `session_id + user_id`（唯一） |
| `teams` | 持久队伍 | `city` |
| `team_members` | 队伍成员 | `team_id + user_id`（唯一） |
| `posts` | 动态 | `visibility + created_at` |
| `cheers` | 鼓励 | `target_id` |
| `comments` | 评论 | `post_id` |
| `city_stats` | 城市日统计 | `city + date` |
| `achievements` | 成就 | `user_id + code` |
| `reports` | 举报 | `status + created_at` |

云函数右键「上传并部署：云端安装依赖」，三个都要部署。

---

## 五、几条不能改坏的约定

这些不是风格偏好，是产品成立的前提，改动前请先回 PRD 对应章节：

1. **不拉取微信头像与昵称**（PRD 9.1）。一律用 `utils/identity.js` 生成。
   想加「一键使用微信头像」的人，请先读第 9 章。
2. **「正在跑」只能由场次状态机推导**（PRD 4.1.1），不许写死数字，
   也不许引入实时定位。首屏大数字用「今天累计」，小数字用「此刻推导」。
3. **对外分享物料必须中性**（PRD 9.3）。分享文案一律走 `utils/share.js`，
   那里没有留塞品牌名的口子。
4. **双向屏蔽**（PRD 9.4）。任何跨用户查询都要过 `db.excludeBlocked()`，
   或走 `sessionStatus` 云函数。单向屏蔽会让屏蔽变成跟踪工具。
5. **社区内容默认不公开**（PRD 9.2）。`posts.visibility` 默认 `community`，
   `sitemap.json` 整站 disallow。

---

## 六、Tab 图标

图标由脚本生成，不要直接改 png：

```bash
python3 tools/gen_tabicons.py
```

改图标形状请编辑 `tools/gen_tabicons.py` 里的绘制函数。
