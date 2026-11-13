# 学マス MV ランダム

初星学園（学園アイドルマスター）公式チャンネルの動画をランダムに 1 本再生する静的サイト。

- ボタンは常時表示。押すたびに 1 本抽選して iframe 内で再生
- 抽選はシャッフルバッグ方式（全曲一巡してから再シャッフル・直前の 1 本は除外）
- 曲池是 MV 62 支 + Lyric Video 6 支 + 单曲 43 支 = 111 支（Remix Visualiser 整类不收；时长 < 120s 或画面竖屏的宣传短片在抓取阶段剔除；同曲名已有 MV 的静态图单曲剔除，整首只有阵容版的则全部保留）
- YouTube 側で埋め込み不可 / 削除済みになった動画は `onError` で自動的に除外して引き直す
- 8 秒以内に再生が始まらない場合は「YouTube で開く」に切り替える

## ローカルで動かす

```
serve.cmd            → http://127.0.0.1:8801/ を開く
```

`file://` では動かない（`fetch(data/videos.json)` が CORS で落ちる）。必ず http 経由で開く。

## データを更新する

```
refresh.cmd
```

`tools/refresh.mjs` が走って `data/videos.json` を書き換える。所要 25 秒前後。

- チャンネルの全アップロードを innertube（`youtubei/v1/browse`）でページング取得
- 从标题判定 MV / Lyric Video，Shorts・Solo ver.・Teaser・Visualiser 一律跳过
- 另抓官方 13 个播放列表（Music + 12 名角色的 solo 曲），列表里出现、标题是纯曲名的视频归类为「单曲」（一张图的静态封面 + 音频）
- 逐条查 player 端点拿 `lengthSeconds` 与视频宽高，`< 120s` 或竖屏的剔除（结果写在 `videos.json.dropped` 里备查）
- 同じ曲 × 同じ種別は最新 1 本に集約
- oEmbed で埋め込み可否を検証し、不可のものは出力しない
- innertube が失敗したら RSS（最新 15 本）に退避し、既存の `videos.json` とマージする

本機の通信は Clash 系プロキシ（`127.0.0.1:7890`）経由。`refresh.cmd` はその前提で proxy を export している。別ポートなら `refresh.cmd` の 3 行を書き換える。

## 背景封面

图源用每支视频在 YouTube 上的缩略图：`https://i.ytimg.com/vi/<videoId>/maxresdefault.jpg`（1280×720）。111 首里 105 首有 maxres，剩下 6 首只有 `sddefault`（640×480），前端按 `maxresdefault → sddefault → hqdefault` 依次探测，取第一个能加载的。

- 打开页面时随机铺一张，模糊 24px + 压暗后作为整页背景；播放器区域内同时铺原图，避免未播放时的大黑块
- 抽到新歌时背景跟着换成那首的图，两层交叉淡入 1.1 秒
- 不用 Apple Music / iTunes 的方形封面：那些能拉到 3000×3000，但曲名是罗马字英译（`Garakuta Road - Single`），跟日文标题对不上，且只覆盖已发单曲的部分曲目

## 首播延迟

点击到出画面：**约 8s → 约 2.5s**（headless + Clash 代理环境实测）。三条改动：

1. **预建播放器**：`loadData()` 之后用 `requestIdleCallback` 把 `YT.Player` 建好并 `cue` 一支（不播放），点击时只走 `loadVideoById` / `playVideo`。首次抽卡直接复用预建的那支，连 manifest 都不用重新拉。
2. **提前加载 iframe_api**：`<script async src="https://www.youtube.com/iframe_api">` 放在 `<head>`，与 `app.js` 并行下载，`onYouTubeIframeAPIReady` 由一段 inline script 提前接管（`window.__ytReady` 兜住加载早于 app.js 的情况）。另外给 `www.youtube.com`、`i.ytimg.com` 加了 `preconnect` / `dns-prefetch`。
3. **封面过渡**：封面层 `.poster` 独立于 `#player` 叠在上面。点击后它切成纯深色底（不带任何曲目图），只由状态栏显示「正在打开…」，遮住加载黑屏但不提前泄露抽到了什么；`onStateChange` 收到 `1` 时封面层淡出，曲名、模糊背景、新封面三样同时更新。

分段耗时用 `?debug=1` 看右下角面板：

```
   4ms  +    4  data-ready
 422ms  +  418  yt-api-ready
 422ms  +    0  mount-player
2140ms  + 1717  player-ready
8024ms  + 5884  click
8024ms  +    0  already-cued
8061ms  +   37  state-3
10549ms  + 2488  state-1      ← 这一段是首片下载，网络决定
```

剩下的 2.5s 全是 `state=3 → 1` 的首个视频分片下载。再想压只能降码率（`suggestedQuality: 'large'`），代价是画质，看带宽再决定。

## 公開する

[`DEPLOY.md`](DEPLOY.md) 参照。GitHub Actions が 6 時間ごとにデータを更新し、Cloudflare Pages（または GitHub Pages）に配置する。CI の runner は境外に出るので proxy 設定は不要。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` / `style.css` / `app.js` | サイト本体。フレームワーク・ビルド無し |
| `data/videos.json` | 抽選プール（生成物。CI 失敗時のフォールバックも兼ねる） |
| `tools/refresh.mjs` | 取得 + 分類 + 埋め込み検証 |
| `tools/test-embed.html` | 埋め込み再生の動作確認用の最小ページ |
| `.github/workflows/deploy.yml` | GitHub Pages へのビルド & デプロイ |
| `deploy/cloudflare-pages.yml.sample` | Cloudflare Pages 版のワークフロー |
