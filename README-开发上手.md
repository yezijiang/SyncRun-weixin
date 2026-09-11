# 同频跑 · 开发上手

> 微信小程序（原生框架 + 云开发）· 首发深圳 · 权威需求见 `docs/PRD-同频跑-v1.3.md`

---

## 一、开工前必须先办掉的事（阻塞）

| # | 事项 | 状态 |
|---|---|---|
| 1 | **注册个体工商户**，用它注册小程序拿 AppID | 进行中 |
| 2 | AppID 填进 `project.config.json` | ✅ 已填 |
| 3 | **建云开发环境**，把环境 ID 填进 `miniprogram/config.js` → `cloudEnv` | ✅ 已填（`cloud1-…`） |
| 4 | 从**仓库根目录**导入项目（不是 `miniprogram/`） | ⬜ **下一步** |
| 5 | 在云开发控制台建 12 个集合 + 索引（见第四节） | ⬜ |
| 6 | 右键云函数「上传并部署：云端安装依赖」，共 **9 个**（见第五节） | ⬜ |
| 7 | 小程序后台**名称占位**（同频跑） | ⬜ |
| 8 | 中国商标网检索同名近似，建议注册 9/42/41/45 四类 | ⬜ |

**当前阻塞项是建集合与部署云函数，不是 AppID。**

```js
// miniprogram/config.js
cloudEnv: 'cloud1-d8godskat83eddb47'   // 已填，换环境时改这里
```

> 第 4 步容易错：如果导入时选的是 `miniprogram/` 目录，`cloudfunctions/` 会落在
> 项目目录外面，云函数永远部署不上去。开发者工具会在 `miniprogram/` 下自动生成
> 一份 `project.config.json`——看到这个文件，就说明导错了目录。
> 这两份文件已写进 `.gitignore`，不会进版本库。

> 隐私备注：`wx.cloud.init` 的 `traceUser` 已显式设为 `false`——
> 它会在云开发控制台留下用户访问轨迹，没必要留的就不留。

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
  login/                     换取 openid（作为身份种子）+ 服务端生成昵称
  checkin/                   打卡写入 + 生成动态 + 城市统计
  sessionStatus/             场次状态汇总 + 双向屏蔽（首页唯一数据源）
  sessionAction/             场次的创建 / 取消 / 加入 / 退出
  feed/                      动态流（强制双向屏蔽，不外泄 openid）
  search/                    活动 / 跑友 / 队伍 三档搜索
  interact/                  鼓励 / 举报 / 双向屏蔽
  getMe/                     我的数据聚合 + 昵称修改
  team/                      队伍的创建 / 加入 / 列表
tools/
  gen_tabicons.py            生成 Tab 图标（纯标准库）
```

---

## 三、本地跑起来

1. 打开微信开发者工具 → 导入项目 → 选择仓库根目录
   （AppID 已在 `project.config.json` 里填好，导入时会自动带出）
2. 工具栏「云开发」→ 新建环境（建议建 `dev` 与 `prod` 两个）
3. 把环境 ID 填进 `miniprogram/config.js` → `cloudEnv`
4. 建集合 + 索引（第四节），上传云函数（第五节）

在填环境 ID 之前，工程会自动降级到本地 mock：界面能点、数据不通。

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

**权限怎么设**（这是最容易踩的坑）：

- 跨用户要读的（`users` / `sessions` / `session_members` / `teams` / `posts` /
  `city_stats` / `reports`）→ **仅管理端可读写**，读取只能走云函数
- 只跟自己有关的（`checkins` / `cheers` / `achievements`）→ **仅创建者可读写**
- **不要开「所有用户可读」**，那等于任何人都能在前端拉全表

原因是两条硬约束：小程序端一次最多取 20 条（上限改不动），且只能读自己创建的记录。

---

## 五、部署云函数

在开发者工具里对 `cloudfunctions/` 下每个目录右键 → 「上传并部署：云端安装依赖」。
**9 个都要部署**，漏一个的表现是「按钮点了没反应」，而且控制台不一定报错：

| 云函数 | 作用 | 漏了会怎样 |
|---|---|---|
| `login` | 换 openid，并在服务端生成昵称与渐变色 | 身份变成本地随机串，换设备认不出 |
| `checkin` | 打卡写库 + 自动生成动态 + 城市统计累加 | 打卡按钮报错 |
| `sessionStatus` | 首页数据 + 推导「此刻正在跑」 + 双向屏蔽 | 首页降级到 mock 假数据 |
| `sessionAction` | 场次的创建 / 取消 / 加入 / 退出 | 加入、发起全部失败 |
| `feed` | 动态流，强制双向屏蔽 | 动态页一直是 mock 的三条 |
| `search` | 活动 / 跑友 / 队伍 三档搜索 | 搜索无结果 |
| `interact` | 鼓励 / 举报 / 双向屏蔽 | 点赞、屏蔽无效果 |
| `getMe` | 我的数据聚合 + 昵称修改 | 我的页数字为 0 |
| `team` | 队伍的创建 / 加入 / 列表 | 队伍列表空，创建失败 |

新增云函数后记得同步更新这里。

**部署完的自检顺序**（一步一步走，能直接定位到是哪个函数没起来）：

1. 编译后看控制台，不应出现 `[同频跑] 云函数调用失败`
2. 「我的」页数字不再来自 mock → `getMe` 通了
3. 「去跑」页发起一场，列表里出现你刚发的 → `sessionAction` 通了
4. 打卡一次，「动态」页出现这一条 → `checkin` + `feed` 通了
5. 首页「今天 N 人跑过」变成 1 → `sessionStatus` + `city_stats` 通了

> **内容安全**：`sessionAction` / `getMe` / `team` / `checkin` 会调用
> `openapi.security.msgSecCheck`。没在云开发控制台开通这个权限时，函数会打一条
> warning 并放行（不会拦住开发和测试），正式上线前必须开通，否则等于没校验。

---

## 六、几条不能改坏的约定

这些不是风格偏好，是产品成立的前提，改动前请先回 PRD 对应章节：

1. **不拉取微信头像与昵称**（PRD 9.1）。一律用 `utils/identity.js` 生成。
   想加「一键使用微信头像」的人，请先读第 9 章。
2. **「正在跑」只能由场次状态机推导**（PRD 4.1.1），不许写死数字，
   也不许引入实时定位。首屏大数字用「今天累计」，小数字用「此刻推导」。
3. **对外分享物料必须中性**（PRD 9.3）。分享文案一律走 `utils/share.js`，
   那里没有留塞品牌名的口子。
4. **双向屏蔽**（PRD 9.4）。执行点是云函数：`feed` / `search` / `sessionStatus`
   都会先算出「我屏蔽的人 + 屏蔽了我的人」再过滤。只写一侧的 `blocked_ids`，
   读的时候两个方向都排除。前端 `db.excludeBlocked()` 只服务 mock 预览。
5. **不把 openid 送出云函数**。跨用户接口一律只返回 `users._id`，
   前端要屏蔽、要查看都用它。把别人的 openid 发到客户端是隐私事故。
6. **社区内容默认不公开**（PRD 9.2）。`posts.visibility` 默认 `community`，
   `sitemap.json` 整站 disallow。
7. **跨用户读取只能走云函数**。小程序端一次最多取 20 条，且「仅管理端可读写」
   的集合前端读到的是空数组——直连数据库不会报错，只会静默返回空，
   这是本项目最难查的一类 bug。

---

## 七、Tab 图标

图标由脚本生成，不要直接改 png：

```bash
python3 tools/gen_tabicons.py
```

改图标形状请编辑 `tools/gen_tabicons.py` 里的绘制函数。
