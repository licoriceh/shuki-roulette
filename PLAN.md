# 学マス MV 随机播放器 — 方案

> 状态：已定稿并落地。曲目范围扩到 MV + Lyric Video + Visualiser（82 本），更新走线上 CI，播放为页面内嵌。实现细节见 [README.md](README.md)，上线步骤见 [DEPLOY.md](DEPLOY.md)。本文保留设计过程与实测数据。

## 1. 连通性结论（已实测）

| 项目 | 结果 |
|---|---|
| 直连 youtube.com / google.com | 被阻断（TLS reset） |
| 经本机 FlClash（127.0.0.1:7890） | 全部可达 |
| 系统代理 | `ProxyEnable=1` → `127.0.0.1:7890`，FlClashCore 正在监听 |
| 浏览器内嵌播放 | 已用 headless Chrome 实测：`state=1 playing`、`currentTime 6.6s`、`duration 213.9s`，无 error |

结论：页面本身的播放不依赖本机出网能力，YouTube 请求发生在用户浏览器里；但**抓取脚本必须走代理**（脚本里读 `HTTP_PROXY`，或直接指向 7890）。

## 2. 数据源

- 频道：初星学園 `@hatsuboshi_gakuen`，`UC2dXx-3RXeeP8hA5AGt8vuw`（学マス 官方音乐频道，437K 订阅）
- 上传播放列表：`UU2dXx-3RXeeP8hA5AGt8vuw`（UC 第二位换 U）
- 接口：`POST https://www.youtube.com/youtubei/v1/browse?key=<web client public key>`
  - `browseId` 首次传 `VL+uploads`，之后传 `continuation` 翻页
  - 响应里取 `lockupViewModel`（2025 后的新结构，不是旧的 `playlistVideoRenderer`）
  - 不需要注册 Google Cloud、不需要 API key、不需要 yt-dlp
- 备用：`https://www.youtube.com/feeds/videos.xml?channel_id=...` 只返回最近 15 条，适合做轻量增量

### 抓取结果（2026-11-13 实测）

```
page 1: +100    page 2: +82    uploads=182
mvRaw=78 → 同曲去重 61 → oEmbed 全通过 61
```

过滤规则（标题层面，命中率 100%）：

1. 保留：标题含 `Official Music Video`
2. 排除：含 `#shorts`（同曲的竖屏切片，占上传量一半以上）
3. 排除：`Solo ver.` / `Official shorts` / `Visualiser`
4. 按 `「曲名」` 去重，同曲保留最新一条

被规则挡掉、但需要人工判断的一类（当前 24 条，写在 `videos.json.unmatched` 里）：

- `Lyric Video` 系列（ナイワ / Let's GO!! ICHI-NO-NI!! / SUPREMACY / 冠菊 / キミとセミブルー / Campus mode!! Short Size）
- `Official Visualiser`（12 首 Remix，非 MV）
- 单独命名、没写 "Official Music Video" 的 `初星学園「標」` ← 是否算 MV 需要你定
- `Music Video Teaser`、Solo ver.、live 配信

## 3. 页面行为

```
┌──────────────────────────────────┐
│  学マス MV ランダム                 │
│  [ ランダム再生 ]   ← 常驻，不消失   │
│  現在: Roar（61 曲中 / 已播 3 回）   │
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │  16:9 YouTube プレイヤー      │  │
│  └────────────────────────────┘  │
│  曲名 / ローマ字 / YouTube で開く  │
└──────────────────────────────────┘
```

- 按钮固定在播放器上方，播放中、播完、出错都保持可见可点
- 点击 → 从池里抽一条 → `player.loadVideoById()`；已有播放器实例就复用，不重建 iframe（避免闪烁和重复加载 API）
- 随机策略：整池洗牌成环，抽完一轮再重洗，保证 61 支都轮到；同时排除「上一支」，不出现连续重复
- 出错兜底：`onError` 收到 101/150（禁止嵌入）/ 100（视频不存在）→ 该条打上 `dead` 标记、从池中剔除、自动重抽，最多连抽 3 次
- 播完 `state=0`：只更新状态文字，不自动连播（免得用户看不到按钮效果）；另给一个「続けて再生」可选
- 快捷键：空格 / 回车 = 抽下一支
- 状态栏显示 `データ更新: 2026-11-13 09:58`（读 `videos.json.updatedAt`）

## 4. 更新机制（三档，按"及时"程度递增）

**A. 手动（默认）**
- `refresh.cmd` 双击 → `node tools/refresh.mjs` → 重写 `data/videos.json`，约 25 秒
- 适合：新 MV 出了就手动刷一次

**B. 计划任务（推荐的"及时"）**
- Windows 任务计划程序，每天 12:00 跑 `refresh.cmd`
- 官方通常日本时间 12:00 / 21:00 投稿 → 最迟当天入库
- 注册命令：
  ```
  schtasks /create /tn "gakumas-mv-refresh" /tr "D:\Main\gakumas-mv\refresh.cmd" /sc daily /st 12:00 /f
  ```

**C. 打开即最新（常驻小服务）**
- `server.mjs`：零依赖 node 服务，托管静态页 + 每 6 小时后台刷新 + 提供 `GET /api/videos`
- `start.cmd` 一键启动并打开 `http://127.0.0.1:8801`
- 代价：常驻一个 node 进程；好处：永远不需要手动刷新

三档共用同一个 `refresh.mjs`，切换只改启动方式。

## 5. 目录结构

```
D:\Main\gakumas-mv\
├─ index.html            单页（原生 JS，无框架、无构建）
├─ app.js                随机 + 播放器逻辑
├─ style.css
├─ data\
│  └─ videos.json        61 条，19 KB（已生成）
├─ tools\
│  ├─ refresh.mjs        抓取 + 过滤 + oEmbed 校验（已跑通）
│  ├─ check-embed.mjs    单独的嵌入检查（已合并进 refresh）
│  └─ test-embed.html    播放链路验证页
├─ refresh.cmd
└─ start.cmd             （选 C 时才有）
```

## 6. 数据格式

```json
{
  "updatedAt": "2026-11-13T09:58:09.000Z",
  "source": { "channelId": "UC2dXx-3RXeeP8hA5AGt8vuw", "channel": "初星学園",
              "channelUrl": "https://www.youtube.com/@hatsuboshi_gakuen" },
  "counts": { "uploads": 182, "mvRaw": 78, "unique": 61, "playable": 61 },
  "videos": [
    { "id": "Mdyk3h5-TQE", "song": "Roar", "romanized": "Roar",
      "title": "初星学園 「Roar」Official Music Video (HATSUBOSHI GAKUEN - Roar)",
      "embeddable": true }
  ],
  "unmatched": [ { "id": "...", "title": "初星学園「標」 (HATSUBOSHI GAKUEN - Shirube)" } ]
}
```

## 7. 待你定的三件事

1. **曲目范围**：只收 `Official Music Video`（61 支），还是把 `Lyric Video` / `Official Visualiser`（Remix 12 首）/「標」也并进池子？合并后约 80 支。
2. **更新方式**：A 手动 / B 计划任务 / C 常驻服务，选一个。
3. **播放形态**：页面内嵌 iframe（不跳走，推荐），还是点击后新标签页打开 YouTube（不受嵌入限制，但离开页面）。

## 8. 已验证可用的 IDs（抽样）

`Mdyk3h5-TQE` Roar ／ `hSg9Yb28vZA` Agitato ／ `l1T_2zCHTk0` Campus mode!! ／ `T1GK55fsIhw` Fighting My Way ／ `Sq5Dj0U06vQ` Luna say maybe ／ `qjuXqI_xpFI` EGO
