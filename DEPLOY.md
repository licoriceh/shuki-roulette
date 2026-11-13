# 上线方案 — 学マス MV 随机播放

## 目标形态

- 纯静态站点：`index.html` + `app.js` + `data/videos.json`，无数据库、无常驻服务器
- 抓取逻辑跑在 CI 里，不占用任何本机资源
- 访问者打开网址 → 点按钮 → iframe 内播放，URL 长期有效

## 托管对比

| 方案 | 抓取执行位置 | 站点托管 | 需要配置的 Secret | 大陆可达性 | 成本 |
|---|---|---|---|---|---|
| A. GitHub Actions + GitHub Pages | Actions runner | `*.github.io` | 无 | 一般，github.io 常被干扰 | 免费（公开仓库无构建分钟限制） |
| B. GitHub Actions + Cloudflare Pages | Actions runner | `*.pages.dev` | `CF_API_TOKEN`、`CF_ACCOUNT_ID` | 较好 | 免费（500 build/月） |
| C. Cloudflare Worker Cron + KV | Worker 自身 | Worker 或 Pages | 无（同账号绑定） | 较好 | 免费（10 万请求/天） |
| D. Vercel + Cron | Vercel Function | `*.vercel.app` | 无 | 差，域名常被打 | 免费 |

选 **B**。Actions runner 出口在境外，直连 YouTube 不需要任何代理；抓取代码就是现成的 `tools/refresh.mjs`，CI 里一行 `node` 就能跑；CF Pages 免费且到大陆的链路通常好过 github.io。

只想零配置、不注册第二家服务，选 **A**，workflow 已按 A 写好，开 Pages 即用，之后要换域名再迁到 B 只需替换最后一个 step。

## 站点结构（线上版）

```
repo/
├─ index.html
├─ app.js
├─ style.css
├─ data/videos.json          ← 兜底快照，CI 失败时用它继续部署
├─ tools/refresh.mjs         ← 抓取 + 归类 + oEmbed 校验
├─ .nojekyll
└─ .github/workflows/deploy.yml
```

`videos.json` 的生成产物不提交回仓库（避免提交历史噪音），只提交一份兜底快照。CI 每次跑出来的新数据直接进部署产物 `dist/`。

## 上线步骤

1. 新建仓库，推送以上文件（`.github/workflows/deploy.yml` 已就位）
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. Actions 页签手动跑一次 `build-and-deploy`，确认首次部署成功
4. 之后按 `schedule` 自动更新；要改时间就改 `cron`
5. 切 Cloudflare Pages：`wrangler pages project create gakumas-mv`，把 `CF_API_TOKEN`（模板 Pages:Edit）和 `CF_ACCOUNT_ID` 加进仓库 Secrets，注释掉 `deploy-pages` 两个 step，启用 `wrangler` step，`deploy/cloudflare-pages.yml.sample` 里有可直接粘贴的版本

## 更新节奏

```yaml
schedule:
  - cron: '17 */6 * * *'   # 每 6 小时，UTC
```

官方投稿集中在 JST 12:00 和 21:00，即 UTC 03:00 / 12:00。每 6 小时跑一次，最迟 6 小时内入库。GitHub 的高峰期 schedule 可能延迟十几分钟到半小时，属正常。`workflow_dispatch` 留手动触发，新 MV 出了可以立刻刷。

一次构建耗时约 3 分钟，其中抓取 20 秒、元数据 85 条约 40 秒、oEmbed 校验 111 条约 55 秒、部署 30 秒。曲目池当前为 MV 62 + Lyric Video 6 + 单曲 43 = 111 支。

## 容错设计

| 故障 | 现象 | 处理 |
|---|---|---|
| innertube 响应结构变了 | `refresh.mjs` 抛 `empty uploads list` | 自动退到 RSS 通道（最近 15 条）并与仓库里的 `videos.json` 合并；两级都失败时脚本退出非 0，workflow 用快照继续部署，站点不空 |
| YouTube 对 CI 出口 IP 限流 | `HTTP 403` / `429` | 同上；或设 `FORCE_RSS=1` 直接走 RSS 通道 |
| 某支视频改为禁止嵌入 | 播放器 error 101/150 | 前端 `onError` 标记 dead、从池中剔除、自动重抽；下次抓取时 oEmbed 返回 401/403 会直接把它挡在 JSON 外 |
| 视频被删除 | error 100 | 同上 |
| 访问者所在网络连不上 YouTube | iframe 空白 | 前端 14 秒内没进 `state=1` → 隐藏播放器，显示「在 YouTube 打开」直链 |

`tools/refresh.mjs` 的双通道已实测：正常走 innertube 拿到 182 条；强制 `FORCE_RSS=1` 时 15 条新数据 + 53 条快照合并成同样的 68 条。

## 访问者前提

iframe 内播放走的是 `youtube.com/embed`，访问者浏览器必须能连上 YouTube。站点本身能打开、但播放器空白，就是这一条没满足。页面上放一个校验：`player` 8 秒内没进 `state=1` 就切到直链降级视图。这是唯一无法在站点侧解决的问题。

## 成本与配额

- 公开仓库的 GitHub Actions 不计构建分钟；私有仓库每月 2000 分钟，每 6 小时一次 ≈ 每天 8 分钟，一个月约 240 分钟，够用
- Cloudflare Pages 免费版 500 次 build/月，每 6 小时一次 ≈ 120 次/月
- 无需域名也能用 `*.pages.dev` / `*.github.io`；要自定义域名时，CF 侧绑定的域名在大陆不备案也能解析，但被干扰的可能性和裸 pages.dev 同级
