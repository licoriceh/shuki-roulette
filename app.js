/* 学园偶像大师 MV 随机 — 零依赖、零构建 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const el = {
    draw: $("#draw"),
    pool: $("#pool"),
    status: $("#status"),
    fallback: $("#fallback"),
    fbLink: $("#fallback-link"),
    meta: $("#meta"),
    auto: $("#autoplay"),
  };

  const KIND_CN = { mv: "MV", lyric: "Lyric Video", song: "单曲" };
  const kindName = (k) => KIND_CN[k] || "MV";

  /* ---------- 打点（?debug=1 才输出） ---------- */
  const DBG = new URLSearchParams(location.search).has("debug");
  const t0 = performance.now();
  let dbgPanel = null;
  let dbgLast = t0;
  function mark(name) {
    if (!DBG) return;
    const now = performance.now();
    if (!dbgPanel) {
      dbgPanel = document.createElement("pre");
      dbgPanel.id = "dbg";
      document.body.appendChild(dbgPanel);
    }
    dbgPanel.textContent +=
      `${String(Math.round(now - t0)).padStart(5)}ms  +${String(Math.round(now - dbgLast)).padStart(5)}  ${name}\n`;
    dbgLast = now;
  }

  const S = {
    videos: [],
    byId: new Map(),
    bag: [],
    last: null,
    dead: new Set(),
    player: null,
    playerReady: false,
    playing: false,
    want: null,
    preloaded: null,
    plays: 0,
    retry: 0,
    watchdog: 0,
    autoTimer: 0,
    sawBuffering: false,
    updatedAt: "",
  };

  /* ---------- YouTube IFrame API ---------- */
  // iframe_api 由 index.html 的 async script 提前加载，这里只负责等它
  let resolveApi;
  const apiReady = new Promise((r) => (resolveApi = r));
  function apiUp() {
    mark("yt-api-ready");
    resolveApi();
  }
  if (window.__ytReady || (window.YT && window.YT.Player)) apiUp();
  else window.addEventListener("ytapi", apiUp, { once: true });

  const timeout = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

  /* ---------- 数据 ---------- */
  async function loadData() {
    const res = await fetch("data/videos.json", { cache: "no-store" });
    if (!res.ok) throw new Error("data " + res.status);
    const data = await res.json();
    S.videos = (data.videos || []).filter((v) => v && v.id);
    S.byId = new Map(S.videos.map((v) => [v.id, v]));
    S.updatedAt = data.updatedAt || "";
    renderPool(data);
    mark("data-ready");
  }

  function renderPool(data) {
    const k = (data.counts || {}).byKind || {};
    const parts = [
      `${S.videos.length} 首`,
      k.mv ? `MV ${k.mv}` : "",
      k.lyric ? `Lyric Video ${k.lyric}` : "",
      k.song ? `单曲 ${k.song}` : "",
    ].filter(Boolean);
    const d = S.updatedAt ? new Date(S.updatedAt) : null;
    const stamp =
      d && !isNaN(d)
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : "";
    el.pool.textContent = parts.join(" · ") + (stamp ? `　更新 ${stamp}` : "");
  }

  /* ---------- 抽选 ---------- */
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function refill() {
    const alive = S.videos.filter((v) => !S.dead.has(v.id));
    const fresh = alive.filter((v) => v.id !== S.last?.id);
    S.bag = shuffle(fresh.length ? fresh : alive).map((v) => v.id);
  }

  function take() {
    const alive = S.videos.filter((v) => !S.dead.has(v.id));
    if (!alive.length) return null;
    if (!S.bag.length) refill();
    let pick = null;
    while (S.bag.length) {
      const cand = S.byId.get(S.bag.pop());
      if (!cand || S.dead.has(cand.id)) continue;
      if (cand.id === S.last?.id && alive.length > 1) continue;
      pick = cand;
      break;
    }
    if (!pick) {
      refill();
      const id = S.bag.pop();
      pick = (id && S.byId.get(id)) || alive[0];
    }
    return pick;
  }

  /* ---------- 封面缩略图 ---------- */
  const THUMB_STEPS = ["maxresdefault", "sddefault", "hqdefault"];
  const thumbUrl = (id, step) => `https://i.ytimg.com/vi/${id}/${step}.jpg`;

  // 取该曲可用的最大缩略图（maxres → sd → hq）；命中缓存时同步回调
  const thumbCache = new Map();
  function probeThumb(id, cb) {
    if (!id) return;
    const hit = thumbCache.get(id);
    if (hit) {
      cb(hit);
      return;
    }
    let step = 0;
    const probe = new Image();
    probe.onload = () => {
      thumbCache.set(id, probe.src);
      cb(probe.src);
    };
    probe.onerror = () => {
      step++;
      if (step < THUMB_STEPS.length) probe.src = thumbUrl(id, THUMB_STEPS[step]);
    };
    probe.src = thumbUrl(id, THUMB_STEPS[0]);
  }

  let bgTop = 0;
  // 背景要模糊 24px，640×480 足够；先用小图，避免开局等 190KB 的 maxres
  const BG_STEPS = ["sddefault", "hqdefault", "maxresdefault"];
  const bgCache = new Map();
  function probeBg(id, cb) {
    if (!id) return;
    const hit = bgCache.get(id);
    if (hit) {
      cb(hit);
      return;
    }
    let step = 0;
    const img = new Image();
    img.onload = () => {
      bgCache.set(id, img.src);
      cb(img.src);
    };
    img.onerror = () => {
      step++;
      if (step < BG_STEPS.length) img.src = thumbUrl(id, BG_STEPS[step]);
    };
    img.src = thumbUrl(id, BG_STEPS[0]);
  }

  function applyBackground(url) {
    const layers = document.querySelectorAll(".bg-layer");
    if (layers.length < 2) return;
    mark("bg-applied");
    const next = layers[bgTop];
    const prev = layers[1 - bgTop];
    next.style.backgroundImage = `url("${url}")`;
    next.classList.add("on");
    prev.classList.remove("on");
    bgTop = 1 - bgTop;
  }

  function setBackground(id) {
    probeBg(id, applyBackground);
  }

  /* ---------- 封面层 ---------- */
  function showPoster(id, text) {
    const p = document.getElementById("poster");
    if (!p) return;
    p.classList.remove("hidden");
    const t = document.getElementById("poster-text");
    if (t && text) t.textContent = text;
    if (!id) return;
    // 新曲的图还没到手时先留深色底，不要挂着上一首的封面
    if (!thumbCache.has(id)) p.style.backgroundImage = "none";
    probeThumb(id, (url) => {
      p.style.backgroundImage = `url("${url}")`;
    });
  }

  function hidePoster() {
    const p = document.getElementById("poster");
    if (p) p.classList.add("hidden");
  }

  // 点下去到出画之间只用深色底挡着，不露任何曲目信息
  function showLoading() {
    const p = document.getElementById("poster");
    if (!p) return;
    p.classList.remove("hidden");
    p.style.backgroundImage = "none";
    const t = document.getElementById("poster-text");
    if (t) t.textContent = ""; // 提示统一交给状态栏，避免两处重复
  }

  /* ---------- 播放器 ---------- */
  function playerVars(videoId) {
    const vars = { autoplay: 0, rel: 0, playsinline: 1, modestbranding: 1, hl: "zh-CN", videoId };
    if (location.origin && location.origin !== "null") vars.origin = location.origin;
    return vars;
  }

  // 预热：页面空闲时就把 iframe 建起来，点击时只剩 loadVideoById
  function mountPlayer(seed) {
    if (S.player) return;
    const v = seed || S.videos[0];
    if (!v) return;
    mark("mount-player");
    S.player = new YT.Player("player", {
      width: "100%",
      height: "100%",
      videoId: v.id,
      playerVars: playerVars(v.id),
      events: { onReady, onStateChange: onState, onError },
    });
  }

  function onReady(e) {
    S.playerReady = true;
    mark("player-ready");
    const w = S.want;
    if (!w) return; // 预热阶段：不播放
    const cur = e.target.getVideoData?.()?.video_id;
    if (w.id !== cur) e.target.loadVideoById(w.id);
    e.target.playVideo();
  }

  async function play(v) {
    S.want = v;
    S.playing = false;
    showLoading();
    // 只把背景图下载进缓存，不渲染；出画时能同步切过去
    probeBg(v.id, () => {});
    el.status.textContent = "正在打开…";
    hideFallback();
    startWatchdog(v);

    if (S.player && S.playerReady) {
      mark("load");
      const cur = S.player.getVideoData?.()?.video_id;
      if (cur === v.id) {
        mark("already-cued");
        S.player.playVideo();
      } else {
        S.player.loadVideoById(v.id);
        S.player.playVideo();
      }
      return;
    }

    if (S.player) return; // 预热中的 player 建好后由 onReady 接手

    try {
      await Promise.race([apiReady, timeout(7000, "api_timeout")]);
    } catch {
      showFallback(v);
      return;
    }
    if (S.player) return;
    mountPlayer(v);
  }

  function onState(e) {
    const st = e.data;
    if (st === 1) {
      clearInterval(S.watchdog);
      S.retry = 0;
      S.playing = true;
      mark("state-1");
      // 曲名和模糊背景等真正出画了再一起上，避免信息抢在画面前面
      const cur = e.target?.getVideoData?.()?.video_id;
      const v = (cur && S.byId.get(cur)) || S.want;
      if (v) {
        renderMeta(v);
        setBackground(v.id);
      }
      hidePoster();
      el.status.textContent = `播放中${v ? " · " + kindName(v.kind) : ""}　（第 ${S.plays} 次）`;
    } else if (st === 0) {
      S.playing = false;
      if (autoplay) {
        el.status.textContent = "播放结束 · 自动抽下一曲…";
        clearTimeout(S.autoTimer);
        S.autoTimer = setTimeout(() => {
          if (!autoplay) return;
          S.plays++;
          draw(true);
        }, 450);
      } else {
        el.status.textContent = "播放结束 · 再点一次";
      }
    } else if (st === 3) {
      mark("state-3"); // 缓冲阶段保持「正在打开…」，不额外跳字
    }
  }

  function onError() {
    const v = S.want;
    if (v) S.dead.add(v.id);
    S.retry++;
    if (S.retry <= 3 && S.videos.filter((x) => !S.dead.has(x.id)).length) {
      setTimeout(() => draw(true), 80);
    } else {
      showFallback(v);
    }
  }

  // 轮询播放状态：出现过缓冲（3）说明链路是通的，给更长的宽限；完全没反应就早点降级
  function startWatchdog(v) {
    clearInterval(S.watchdog);
    S.sawBuffering = false;
    let waited = 0;
    S.watchdog = setInterval(() => {
      waited += 2;
      if (S.playing) {
        clearInterval(S.watchdog);
        return;
      }
      let st = -1;
      try {
        st = S.player?.getPlayerState?.() ?? -1;
      } catch {
        st = -1;
      }
      if (st === 1) {
        clearInterval(S.watchdog);
        return;
      }
      if (st === 3) S.sawBuffering = true;
      const limit = S.sawBuffering ? 45 : 18;
      if (waited >= limit) {
        clearInterval(S.watchdog);
        showFallback(v);
      }
    }, 2000);
  }

  /* ---------- 界面 ---------- */
  function renderMeta(v) {
    if (!v) return;
    const kind = v.kind || "mv";
    const parts = [
      `<span class="song">${esc(v.song)}</span>`,
      `<span class="tag ${esc(kind)}">${esc(kindName(kind))}</span>`,
      v.romanized && v.romanized !== v.song ? `<span>${esc(v.romanized)}</span>` : "",
      `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">在 YouTube 打开</a>`,
    ];
    el.meta.innerHTML = parts.filter(Boolean).join(" ");
  }

  function setDegraded(on) {
    const stage = document.querySelector(".stage");
    if (stage) stage.classList.toggle("degraded", !!on);
  }

  function showFallback(v) {
    clearInterval(S.watchdog);
    try {
      S.player?.pauseVideo?.();
    } catch {}
    setDegraded(true);
    el.fallback.hidden = false;
    el.status.textContent = "播放器连不上";
    if (v) {
      renderMeta(v);
      el.fbLink.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    }
  }

  function hideFallback() {
    el.fallback.hidden = true;
    setDegraded(false);
  }

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 操作 ---------- */
  async function draw(silent = false) {
    clearTimeout(S.autoTimer);
    if (!S.videos.length) return;
    // 第一次优先播预建时已经 cue 好的那支，省掉一次 manifest 请求
    let v = null;
    if (S.preloaded && !S.dead.has(S.preloaded.id)) v = S.preloaded;
    S.preloaded = null;
    if (!v) v = take();
    if (!v) {
      el.status.textContent = "没有可播放的视频了，刷新页面重试。";
      return;
    }
    S.last = v;
    if (!silent) S.plays++;
    await play(v);
  }

  /* ---------- 自动连播开关 ---------- */
  let autoplay = false;
  try {
    autoplay = localStorage.getItem("gakumas-autoplay") === "1";
  } catch {}
  function paintAutoplay() {
    el.auto.classList.toggle("on", autoplay);
    el.auto.setAttribute("aria-pressed", autoplay ? "true" : "false");
  }
  function setAutoplay(on) {
    autoplay = !!on;
    clearTimeout(S.autoTimer);
    try {
      localStorage.setItem("gakumas-autoplay", autoplay ? "1" : "0");
    } catch {}
    paintAutoplay();
  }
  el.auto.addEventListener("click", () => setAutoplay(!autoplay));
  paintAutoplay();

  el.draw.addEventListener("click", () => {
    mark("click");
    S.plays = S.plays || 0;
    S.plays++;
    draw(true);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      mark("click");
      S.plays++;
      draw(true);
    }
  });

  /* ---------- 预热 ---------- */
  function prewarm(seed) {
    const run = () => {
      apiReady
        .then(() => {
          if (!S.player) mountPlayer(seed);
        })
        .catch(() => {});
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 800);
  }

  /* ---------- 启动 ---------- */
  loadData()
    .then(() => {
      el.status.textContent = "点按钮随机抽一支";
      if (!S.videos.length) return;
      const first = S.videos[Math.floor(Math.random() * S.videos.length)];
      S.preloaded = first;
      setBackground(first.id);
      showPoster(first.id, "点按钮开始");
      prewarm(first);
    })
    .catch((err) => {
      el.pool.textContent = "数据加载失败";
      el.status.textContent =
        location.protocol === "file:"
          ? "file:// 下无法运行，请用 http 打开或访问线上地址。"
          : "读不到 data/videos.json（" + err.message + "）";
    });
})();
