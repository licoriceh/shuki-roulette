// 抓取「初星学園」YouTube 频道全部视频 → 归类（MV / Lyric Video / Visualiser）→ oEmbed 校验 → 写 data/videos.json
//
// 本机:   refresh.cmd（自动带 127.0.0.1:7890 代理）
// CI:     node tools/refresh.mjs（出口在境外，直连即可）
// 参数:   --no-embed-check 跳过 oEmbed 校验
//
// 双通道: 主通道 innertube browse（拿全量 180+ 条），失败时退到 RSS（最近 15 条）+ 已存在的 videos.json 合并。
import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UC2dXx-3RXeeP8hA5AGt8vuw";         // 初星学園 @hatsuboshi_gakuen
const UPLOADS = "UU" + CHANNEL_ID.slice(2);             // 上传播放列表 = UC → UU
const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";  // YouTube Web 客户端公开 innertube key
const API = `https://www.youtube.com/youtubei/v1/browse?key=${KEY}`;
const CLIENT_VERSION = "2.20241113.00.00";
const MAX_PAGES = 40;
const CHECK_EMBED = !process.argv.includes("--no-embed-check");
const OUT = path.resolve(import.meta.dirname, "..", "data", "videos.json");

// 官方播放列表：Music 是全曲目清单，其余是各角色 solo 曲。用来认出「只有一张图的单曲」
const PLAYLISTS = [
  { id: "PL8AmPgz38WkXIiEnqf-Q5XkWpQgm5UiuF", name: "Music" },
  { id: "PL8AmPgz38WkWs35NYbSsrnwsd2pPeOn38", name: "Discovery" },
  { id: "PL8AmPgz38WkWG_0-nkHs8Ob3Po1T79x9u", name: "咲季" },
  { id: "PL8AmPgz38WkW7RkoS2_Dk19cpQJbGnOGO", name: "手毬" },
  { id: "PL8AmPgz38WkVqwfdjwaPsP8d6Dd1AlShU", name: "ことね" },
  { id: "PL8AmPgz38WkU3ayVUhUkFEbzZxx5RtPfc", name: "麻央" },
  { id: "PL8AmPgz38WkUk3w_JXjAQkIvPAjQ6jEBj", name: "リーリャ" },
  { id: "PL8AmPgz38WkX4L8G9KHiCWXJUAp52UI71", name: "千奈" },
  { id: "PL8AmPgz38WkWq4EkQO8W2Aj1NA3XSQZgI", name: "清夏" },
  { id: "PL8AmPgz38WkVLERdb6sxhv9criSCq_qSg", name: "広" },
  { id: "PL8AmPgz38WkUU3DqCJLHMkq69mRMZm1PK", name: "莉波" },
  { id: "PL8AmPgz38WkUdMQrX0hWyXRFJBpWzbcZJ", name: "佑芽" },
  { id: "PL8AmPgz38WkUkBI8bW5iLW4ibSdnLEtr9", name: "星南" },
];

const ctx = { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "ja", gl: "JP" } };
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-language": "ja",
      "user-agent": UA,
      origin: "https://www.youtube.com",
      cookie: "CONSENT=YES+cb; SOCS=CAI",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function collect(node, videos, tokens) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collect(n, videos, tokens));
  const l = node.lockupViewModel;
  if (l?.contentId && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
    videos.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content ?? "" });
  }
  const c = node.continuationCommand?.token ?? node.continuationEndpoint?.continuationCommand?.token;
  if (typeof c === "string" && c.length > 40) tokens.add(c);
  for (const k in node) collect(node[k], videos, tokens);
}

// ---------- 通道 1: innertube 全量 ----------
async function fetchUploads() {
  const seen = new Set();
  const all = [];
  const usedTokens = new Set();
  const tokens = new Set();
  let body = { context: ctx, browseId: "VL" + UPLOADS };
  let pages = 0;
  while (pages < MAX_PAGES) {
    const json = await post(body);
    pages++;
    const found = [];
    collect(json, found, tokens);
    let added = 0;
    for (const v of found) if (!seen.has(v.id)) { seen.add(v.id); all.push(v); added++; }
    console.log(`page ${pages}: +${added} (total ${all.length})`);
    const next = [...tokens].find((t) => !usedTokens.has(t));
    if (!next || added === 0) break;
    usedTokens.add(next);
    body = { context: ctx, continuation: next };
    await sleep(400 + Math.random() * 500);
  }
  return all;
}

// ---------- 通道 1.5: 官方播放列表（用来认出静态图单曲） ----------
async function fetchPlaylist(pid) {
  const out = [];
  const seen = new Set();
  const used = new Set();
  let body = { context: ctx, browseId: "VL" + pid };
  let pages = 0;
  while (pages < 12) {
    const json = await post(body);
    pages++;
    const found = [];
    const tokens = new Set();
    collect(json, found, tokens);
    let added = 0;
    for (const v of found) if (!seen.has(v.id)) { seen.add(v.id); out.push(v); added++; }
    const next = [...tokens].find((t) => !used.has(t));
    if (!next || added === 0) break;
    used.add(next);
    body = { context: ctx, continuation: next };
    await sleep(250 + Math.random() * 250);
  }
  return out;
}

async function fetchAllPlaylists() {
  const members = new Map(); // videoId -> { title, lists: Set }
  for (const pl of PLAYLISTS) {
    try {
      const items = await fetchPlaylist(pl.id);
      for (const v of items) {
        const cur = members.get(v.id);
        if (cur) cur.lists.add(pl.name);
        else members.set(v.id, { title: v.title, lists: new Set([pl.name]) });
      }
      console.log(`playlist ${pl.name}: ${items.length} videos (total ${members.size})`);
    } catch (e) {
      console.warn(`playlist ${pl.name} failed: ${e.message}`);
    }
  }
  return members;
}

// ---------- 通道 2: RSS 兜底（最近 15 条） ----------
const unxml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function fetchRss() {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, {
    headers: { "accept-language": "ja", "user-agent": UA },
  });
  if (!r.ok) throw new Error(`RSS HTTP ${r.status}`);
  const xml = await r.text();
  const items = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(m[1])?.[1];
    const title = /<media:title[^>]*>([^<]*)<\/media:title>/.exec(m[1])?.[1] ?? /<title[^>]*>([^<]*)<\/title>/.exec(m[1])?.[1];
    if (id && title) items.push({ id, title: unxml(title) });
  }
  console.log(`rss: ${items.length} entries`);
  return items;
}

// ---------- 1. 取原始列表 ----------
let raw = [];
let mode = "innertube";
let playlistMembers = new Map();
if (process.env.FORCE_RSS === "1") {
  mode = "rss";
  raw = await fetchRss();
} else {
  try {
    raw = await fetchUploads();
    if (!raw.length) throw new Error("empty uploads list");
  } catch (e) {
    console.warn(`innertube failed (${e.message}) → fallback to RSS`);
    mode = "rss";
    raw = await fetchRss();
  }
  try {
    playlistMembers = await fetchAllPlaylists();
  } catch (e) {
    console.warn(`playlists failed: ${e.message}`);
  }
}
if (!raw.length) throw new Error("no videos fetched from any channel");

// 播放列表里出现、上传列表里没有的，补进 raw
if (playlistMembers.size) {
  const known = new Set(raw.map((v) => v.id));
  let added = 0;
  for (const [id, m] of playlistMembers) {
    if (!known.has(id)) {
      raw.push({ id, title: m.title });
      added++;
    }
  }
  if (added) console.log(`playlists added ${added} videos not in uploads`);
}

// ---------- 2. 归类 ----------
const clean = (s) => s.replace(/\s+/g, " ").trim();
const isShort = (t) => /#shorts/i.test(t);
const SONG = /「(.+?)」/;
const KIND_LABEL = { mv: "MV", lyric: "Lyric Video", song: "单曲" };

function classify(title, inPlaylist) {
  if (isShort(title)) return null;
  if (/Solo ver\.|Official shorts/i.test(title)) return null;
  if (/Music Video Teaser|\bTeaser\b/i.test(title)) return null;
  if (/Visualis[ez]r/i.test(title)) return null; // Remix Visualiser 整类不收
  if (/Official\s*Music\s*Video/i.test(title)) return "mv";
  if (/Lyric\s*Video/i.test(title)) return "lyric";
  if (SONG.test(title) && /HATSUBOSHI GAKUEN/i.test(title)) return "mv"; // 未标注类型的本编 MV
  if (inPlaylist) return "song"; // 官方音乐列表里的纯曲名视频 = 一张图的单曲
  return null;
}

function toEntry(v) {
  const inPlaylist = playlistMembers.has(v.id);
  const kind = classify(v.title, inPlaylist);
  if (!kind) return null;
  const song = clean(SONG.exec(v.title)?.[1] ?? v.title);
  const bracket = clean(/\(([^()]*)\)\s*$/.exec(v.title)?.[1] ?? "");
  const roman = bracket.replace(/^HATSUBOSHI GAKUEN\s*-\s*/i, "").trim();
  return {
    id: v.id,
    kind,
    song,
    romanized: kind === "song" || /^HATSUBOSHI GAKUEN$/i.test(roman) ? "" : roman,
    label: KIND_LABEL[kind],
    title: clean(v.title),
  };
}

let picked = raw.map(toEntry).filter(Boolean);

// RSS 通道只覆盖最近 15 条，用已有快照补齐其余部分
if (mode === "rss") {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const known = new Set(picked.map((p) => p.id));
    for (const v of prev.videos || []) if (v?.id && !known.has(v.id)) { picked.push(v); known.add(v.id); }
    console.log(`merged ${picked.length - raw.length} entries from previous snapshot`);
  } catch {}
}

// ---------- 2.5 时长 / 画幅 ----------
// 竖屏的宣传短片、十几秒的预览 MV 要挡掉：从 player 端点拿 lengthSeconds 与视频宽高
const MIN_SECONDS = 120;
const PLAYER_API = `https://www.youtube.com/youtubei/v1/player?key=${KEY}`;

async function fetchVideoMeta(id) {
  try {
    const r = await fetch(PLAYER_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "ja",
        "user-agent": UA,
        origin: "https://www.youtube.com",
        cookie: "CONSENT=YES+cb; SOCS=CAI",
      },
      body: JSON.stringify({ context: ctx, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    });
    if (!r.ok) return { lengthSeconds: NaN, width: 0, height: 0 };
    const j = await r.json();
    const vd = j.videoDetails || {};
    const mf = j.microformat?.playerMicroformatRenderer || {};
    const len = Number(vd.lengthSeconds ?? mf.lengthSeconds ?? NaN);
    let width = 0;
    let height = 0;
    const fmts = [...(j.streamingData?.adaptiveFormats || []), ...(j.streamingData?.formats || [])];
    for (const f of fmts) {
      if (f.width && f.height && f.height > height) {
        width = f.width;
        height = f.height;
      }
    }
    if (!width && mf.width) {
      width = Number(mf.width);
      height = Number(mf.height);
    }
    return { lengthSeconds: len, width, height };
  } catch {
    return { lengthSeconds: NaN, width: 0, height: 0 };
  }
}

// 已有快照里的时长/画幅直接复用，只有新出现的 id 才请求
let prevById = new Map();
try {
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const v of prev.videos || []) if (v?.id && typeof v.lengthSeconds === "number") prevById.set(v.id, v);
} catch {}
for (const v of picked) {
  const c = prevById.get(v.id);
  if (c) {
    v.lengthSeconds = c.lengthSeconds;
    v.width = c.width;
    v.height = c.height;
  }
}

const metaQueue = picked.filter((v) => typeof v.lengthSeconds !== "number");
console.log(`meta: ${picked.length - metaQueue.length} cached, ${metaQueue.length} to fetch`);
if (metaQueue.length) {
  process.stdout.write("meta fetch: ");
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (metaQueue.length) {
        const v = metaQueue.shift();
        Object.assign(v, await fetchVideoMeta(v.id));
        process.stdout.write(".");
        await sleep(80);
      }
    })
  );
  console.log();
}

const dropped = [];
picked = picked.filter((v) => {
  const sec = v.lengthSeconds;
  if (typeof sec === "number" && sec > 0 && sec < MIN_SECONDS) {
    dropped.push({ id: v.id, title: v.title, why: `short ${sec}s` });
    return false;
  }
  if (v.width && v.height && v.height > v.width) {
    dropped.push({ id: v.id, title: v.title, why: `portrait ${v.width}x${v.height}` });
    return false;
  }
  return true;
});
for (const d of dropped) console.log(`drop ${d.why.padEnd(18)} ${d.id}  ${d.title.slice(0, 44)}`);

// 单曲只留原版：曲名去掉括号内容后归一化，与 MV / Lyric Video 撞名的一律剔除；
// 单曲之间同名的也只留一条（优先标题不带括号的原版）
const normSong = (s) =>
  String(s)
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s\u3000]+/g, "")
    .trim() || String(s).trim();

const visualNorm = new Set(picked.filter((v) => v.kind !== "song").map((v) => normSong(v.song)));
const songGroups = new Map(); // 归一化曲名 -> 条目数组
for (const v of picked) {
  if (v.kind !== "song") continue;
  const n = normSong(v.song);
  if (visualNorm.has(n)) continue;
  if (!songGroups.has(n)) songGroups.set(n, []);
  songGroups.get(n).push(v);
}

const keepSongIds = new Set();
for (const group of songGroups.values()) {
  const plain = group.filter((v) => !/[（(]/.test(v.song));
  if (plain.length) {
    // 有原版：只留原版（多原版取时长最长）
    plain.sort((a, b) => (Number(b.lengthSeconds) || 0) - (Number(a.lengthSeconds) || 0));
    keepSongIds.add(plain[0].id);
  } else {
    // 整首只有阵容版：全部保留
    for (const v of group) keepSongIds.add(v.id);
  }
}

const beforeSongDrop = picked.length;
picked = picked.filter((v) => {
  if (v.kind !== "song") return true;
  const n = normSong(v.song);
  if (visualNorm.has(n)) {
    dropped.push({ id: v.id, title: v.title, why: "duplicate of MV" });
    return false;
  }
  if (!keepSongIds.has(v.id)) {
    dropped.push({ id: v.id, title: v.title, why: "other ver." });
    return false;
  }
  return true;
});
const songDropped = beforeSongDrop - picked.length;
if (songDropped) console.log(`drop songs (duplicate of MV / non-original ver.): ${songDropped}`);

// 去重：同一首曲 + 同一类型只留一条，优先保留时长最长的（完整版压过剪辑版）
const byKey = new Map();
for (const v of picked) {
  const key = `${v.song}||${v.kind}`;
  const cur = byKey.get(key);
  if (!cur || (Number(v.lengthSeconds) || 0) > (Number(cur.lengthSeconds) || 0)) byKey.set(key, v);
}
const videos = [...byKey.values()].sort(
  (a, b) => a.kind.localeCompare(b.kind) || a.song.localeCompare(b.song, "ja")
);

const matched = new Set(picked.map((v) => v.id));
const unmatched =
  mode === "innertube"
    ? raw.filter((v) => !isShort(v.title) && !matched.has(v.id)).map((v) => ({ id: v.id, title: clean(v.title) }))
    : [];

// ---------- 3. oEmbed 校验可嵌入 ----------
async function checkEmbed(id) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    "https://www.youtube.com/watch?v=" + id
  )}&format=json`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (r.status === 200) return { embeddable: true };
      if (r.status === 401 || r.status === 403) return { embeddable: false, reason: "embed-disabled" };
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (r.status === 404) return { embeddable: false, reason: "not-found" };
      return { embeddable: false, reason: "http-" + r.status };
    } catch {
      if (i === 2) return { embeddable: false, reason: "net" };
      await sleep(1200);
    }
  }
  return { embeddable: false, reason: "unknown" };
}

if (CHECK_EMBED) {
  const queue = [...videos];
  process.stdout.write("embed check: ");
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const v = queue.shift();
        const res = await checkEmbed(v.id);
        v.embeddable = res.embeddable;
        if (!res.embeddable) v.blocked = res.reason;
        process.stdout.write(res.embeddable ? "." : "x");
        await sleep(120);
      }
    })
  );
  console.log();
}

const playable = videos.filter((v) => v.embeddable !== false);
const byKind = playable.reduce((m, v) => ((m[v.kind] = (m[v.kind] || 0) + 1), m), {});

const payload = {
  updatedAt: new Date().toISOString(),
  source: {
    channelId: CHANNEL_ID,
    channel: "初星学園",
    channelUrl: "https://www.youtube.com/@hatsuboshi_gakuen",
    uploadsPlaylist: UPLOADS,
    fetchedVia: mode,
    rules: { minSeconds: MIN_SECONDS, skipPortrait: true, kinds: ["mv", "lyric", "song"], playlists: PLAYLISTS.length },
  },
  counts: { uploads: raw.length, picked: picked.length, unique: videos.length, playable: playable.length, dropped: dropped.length, byKind },
  videos: playable,
  dropped,
  unmatched,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(
  `mode=${mode} uploads=${raw.length} picked=${picked.length} unique=${videos.length} playable=${playable.length} byKind=${JSON.stringify(byKind)}`
);
console.log("-> " + OUT);
