import { CONFIG } from './config.js';

/*
 * MediaPipe Hands（Tasks Vision 版 HandLandmarker）封装 + 手势计算。
 *
 * 21 个关键点：
 *   0 手腕
 *   1-4 拇指 (CMC, MCP, IP, TIP)
 *   5-8 食指  9-12 中指  13-16 无名指  17-20 小指  (MCP, PIP, DIP, TIP)
 */

export const FINGERTIPS = [4, 8, 12, 16, 20];

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// 探测资源是否可用（排除开发服务器把 404 回退成 index.html 的情况）
async function reachable(url, ms = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctl.signal });
    const type = r.headers.get('content-type') || '';
    return r.ok && !type.includes('text/html');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function pickFirst(urls, suffix = '') {
  for (let i = 0; i < urls.length - 1; i++) {
    if (await reachable(urls[i] + suffix)) return urls[i];
  }
  return urls[urls.length - 1];
}

async function loadVisionModule() {
  try {
    // 由 index.html 的 importmap（或 Vite）解析到本地 / CDN
    return await import('@mediapipe/tasks-vision');
  } catch (err) {
    console.warn('[hands] 默认入口加载失败，尝试备用 CDN', err);
  }
  for (const url of CONFIG.visionModuleFallbacks) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (err) {
      console.warn('[hands] 备用地址失败：', url);
    }
  }
  throw new Error('无法加载 MediaPipe Tasks Vision 运行库');
}

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.delegate = '';
  }

  get ready() {
    return !!this.landmarker;
  }

  async init(numHands, onStatus = () => {}) {
    onStatus('加载 MediaPipe 运行库…');
    const { HandLandmarker, FilesetResolver } = await loadVisionModule();

    const wasmBase = await pickFirst(CONFIG.wasmUrls, '/vision_wasm_internal.js');
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);

    onStatus('加载手部识别模型…');
    const modelPath = await pickFirst(CONFIG.modelUrls);

    const options = (delegate) => ({
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('[hands] GPU 推理不可用，改用 CPU', err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
    console.info(`[hands] 就绪：${this.delegate}，模型 ${modelPath}`);
  }

  /** 有新视频帧时返回识别结果，否则返回 null（沿用上一帧状态） */
  detect(video) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;

    let ts = performance.now();
    if (ts <= this.lastTimestamp) ts = this.lastTimestamp + 1; // VIDEO 模式要求时间戳严格递增
    this.lastTimestamp = ts;
    return this.landmarker.detectForVideo(video, ts);
  }
}

// ---------- 手势：张开程度 0（握拳）~ 1（完全张开） ----------

const sub = (a, b) => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => norm(sub(a, b));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function angleBetween(a, b) {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b) + 1e-9);
  return Math.acos(Math.min(1, Math.max(-1, d)));
}

const FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * 用“关节弯曲角之和”判断每根手指的伸展程度。
 * 角度与手的远近、朝向无关，比“指尖到手腕距离”更稳。
 * 伸直的手指三个关节总弯曲约 0.3~0.7 rad，握拳约 3.3~4 rad。
 * 输入优先用 worldLandmarks（米制三维坐标）。
 */
export function measureOpenness(lm) {
  let sum = 0;
  for (const [m, p, d, t] of FINGERS) {
    const bend =
      angleBetween(sub(lm[m], lm[0]), sub(lm[p], lm[m])) +
      angleBetween(sub(lm[p], lm[m]), sub(lm[d], lm[p])) +
      angleBetween(sub(lm[d], lm[p]), sub(lm[t], lm[d]));
    sum += 1 - clamp01((bend - 0.7) / 2.5);
  }
  // 拇指：拇指尖到中指根的距离 / 掌宽
  const palmWidth = dist(lm[5], lm[17]) + 1e-6;
  const thumb = clamp01((dist(lm[4], lm[9]) / palmWidth - 0.55) / 0.75);

  const raw = (sum + 0.5 * thumb) / 4.5;
  const x = clamp01((raw - 0.1) / 0.8);
  return x * x * (3 - 2 * x);
}
