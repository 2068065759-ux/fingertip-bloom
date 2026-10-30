import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG, PALETTES, IS_MOBILE, IN_APP_BROWSER } from './config.js';
import { Flower } from './flower.js';
import { Pollen } from './pollen.js';
import { createVideoBackground } from './background.js';
import { HandTracker, measureOpenness, FINGERTIPS, HAND_CONNECTIONS } from './hands.js';
import { createUI } from './ui.js';

// =============================================================
// 渲染基础
// =============================================================

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const video = document.getElementById('video');

let W = innerWidth;
let H = innerHeight;
let pixelRatio = Math.min(devicePixelRatio || 1, CONFIG.maxPixelRatio);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.fov, W / H, 0.1, 50);
camera.position.set(0, 0, CONFIG.cameraZ);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(pixelRatio);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(W, H),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const bg = createVideoBackground(video, CONFIG.videoDim);
scene.add(bg.mesh);

const pollen = new Pollen(CONFIG.pollenMax, pixelRatio);
scene.add(pollen.points);

const tracker = new HandTracker();
const clock = new THREE.Clock();

const state = {
  mode: 'idle', // idle（开场演示）| camera | mouse
  inApp: false,
  showSkeleton: true,
  detections: [],
  lastHandsSeenAt: -10,
  greetedHand: false,
  facing: 'user', // user 前置 | environment 后置
  mirror: true,
};

const pointer = { x: W / 2, y: H / 2, vx: 0, down: false, time: performance.now() };

// =============================================================
// 坐标工具
// =============================================================

const _ray = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** 屏幕像素 → z=0 平面上的世界坐标 */
function screenToWorld(x, y, out) {
  _ray.set((x / W) * 2 - 1, -(y / H) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = -camera.position.z / _ray.z;
  return out.copy(camera.position).addScaledVector(_ray, t);
}

/** MediaPipe 归一化坐标 → 屏幕像素（与背景一致：cover 裁切 + 镜像） */
function landmarkToScreen(p) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s;
  const dh = vh * s;
  const x = state.mirror ? 1 - p.x : p.x;
  return { x: x * dw + (W - dw) / 2, y: p.y * dh + (H - dh) / 2 };
}

/** 视野短边在 z=0 平面上的世界长度，用来给演示/鼠标模式定花朵尺寸 */
function viewMin() {
  const vh = 2 * CONFIG.cameraZ * Math.tan(THREE.MathUtils.degToRad(CONFIG.fov / 2));
  return Math.min(vh, (vh * W) / H);
}

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
function dampAngle(a, b, rate, dt) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * (1 - Math.exp(-rate * dt));
}

function average(pts, ids) {
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += pts[i].x;
    y += pts[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

// =============================================================
// 每只手对应一个槽位（一朵花）
// =============================================================

class Slot {
  constructor(index, flower) {
    this.index = index;
    this.flower = flower;
    this.pos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.scale = 0.8;
    this.targetScale = 0.8;
    this.lean = 0;
    this.targetLean = 0;
    this.bloom = 0;
    this.targetBloom = 0;
    this.scatter = 0;
    this.presence = 0;
    this.tracked = false;
    this.demo = false;
    this.tips = FINGERTIPS.map(() => new THREE.Vector3(1e4, 1e4, 0));
    this.anchorScreen = { x: 0, y: 0 };
    this.lastClosedAt = -10;
    this.burstArmed = false;
    this.pendingBurst = false;
    this.emitAcc = 0;
  }

  /** 收到一帧识别结果 */
  observe(det) {
    const p = det.pts;
    screenToWorld(det.anchor.x, det.anchor.y, this.targetPos);

    // 手腕 → 中指根：决定花朵大小与倾斜方向
    screenToWorld(p[0].x, p[0].y, _a);
    screenToWorld(p[9].x, p[9].y, _b);
    const dx = _b.x - _a.x;
    const dy = _b.y - _a.y;
    this.targetScale = THREE.MathUtils.clamp(Math.hypot(dx, dy) * CONFIG.flowerScale, 0.3, viewMin() * 0.5);
    this.targetLean = Math.atan2(-dx, dy);

    FINGERTIPS.forEach((id, k) => screenToWorld(p[id].x, p[id].y, this.tips[k]));
    this.targetBloom = det.openness;
    this.anchorScreen.x = det.anchor.x;
    this.anchorScreen.y = det.anchor.y;

    // 新出现的手：直接落在手上，从花苞开始
    if (this.presence < 0.05) {
      this.pos.copy(this.targetPos);
      this.scale = this.targetScale;
      this.lean = this.targetLean;
      this.bloom = 0;
    }
    this.tracked = true;
  }

  update(dt, t) {
    const mouse = state.mode === 'mouse' && this.index === 0;
    this.demo =
      this.index === 0 &&
      !mouse &&
      !this.tracked &&
      (state.mode === 'idle' || t - state.lastHandsSeenAt > CONFIG.demoDelay);

    if (mouse) {
      screenToWorld(pointer.x, pointer.y, this.targetPos);
      this.targetScale = viewMin() * 0.3;
      this.targetBloom = pointer.down ? 0 : 1;
      this.targetLean = THREE.MathUtils.clamp(-pointer.vx * 0.0006, -0.5, 0.5);
    } else if (this.demo) {
      // 没有手时：画面中央自己开合，提示玩法
      this.targetPos.set(Math.sin(t * 0.31) * 0.15, -0.1 + Math.sin(t * 0.5) * 0.06, 0);
      this.targetScale = viewMin() * 0.3;
      this.targetBloom = 0.5 - 0.5 * Math.cos(t * 0.55);
      this.targetLean = Math.sin(t * 0.4) * 0.12;
    }

    const live = this.tracked || mouse;
    const presTarget = live ? 1 : this.demo ? 0.85 : 0;
    this.presence = damp(this.presence, presTarget, presTarget > this.presence ? 5 : 2.5, dt);

    this.pos.lerp(this.targetPos, 1 - Math.exp(-(live ? 14 : 2.2) * dt));
    this.scale = damp(this.scale, this.targetScale, 8, dt);
    this.lean = dampAngle(this.lean, this.targetLean, 10, dt);

    // 开合：张开稍慢更优雅，闭合更干脆
    const prev = this.bloom;
    const rate = this.targetBloom > this.bloom ? CONFIG.openSpeed : CONFIG.closeSpeed;
    this.bloom = damp(this.bloom, this.targetBloom, rate, dt);
    const vel = (this.bloom - prev) / Math.max(dt, 1e-4);
    if (vel > 0) this.scatter = Math.max(this.scatter, Math.min(1, vel * 0.45));
    this.scatter *= Math.exp(-dt * 1.6);

    // 快速“握拳 → 张开”触发花粉爆发
    if (this.targetBloom < 0.25) {
      this.lastClosedAt = t;
      this.burstArmed = true;
    } else if (this.burstArmed && this.targetBloom > 0.75) {
      this.burstArmed = false;
      if (t - this.lastClosedAt < 0.7 && this.presence > 0.4) this.pendingBurst = true;
    }

    this.flower.update({
      dt,
      t,
      bloom: this.bloom,
      scatter: this.scatter,
      presence: this.presence,
      pos: this.pos,
      scale: this.scale,
      lean: this.lean,
      fingers: this.tips,
      fingerActive: this.tracked ? this.presence : 0,
    });

    // 花粉
    const radius = this.scale * (0.35 + 0.75 * this.bloom);
    this.emitAcc += this.presence * (this.bloom * this.bloom * CONFIG.pollenRate + this.scatter * 60) * dt;
    const n = Math.floor(this.emitAcc);
    if (n > 0) {
      this.emitAcc -= n;
      pollen.emit(this.pos, radius, n, this.flower.palette, 0.35 * this.scale);
    }
    if (this.pendingBurst) {
      this.pendingBurst = false;
      pollen.emit(this.pos, radius, CONFIG.burstCount, this.flower.palette, 1.4 * this.scale);
    }
  }
}

let paletteIndex = 0;
const slots = [];
for (let i = 0; i < CONFIG.maxHands; i++) {
  const flower = new Flower(PALETTES[(paletteIndex + i) % PALETTES.length], pixelRatio);
  scene.add(flower.root);
  slots.push(new Slot(i, flower));
}

// =============================================================
// 识别结果 → 槽位
// =============================================================

function buildDetection(lm, wl) {
  const pts = lm.map(landmarkToScreen);
  const palm = average(pts, [0, 5, 9, 13, 17]);
  const tips = average(pts, [8, 12, 16, 20]);
  const k = CONFIG.anchorToTips;
  return {
    pts,
    anchor: { x: palm.x + (tips.x - palm.x) * k, y: palm.y + (tips.y - palm.y) * k },
    openness: measureOpenness(wl && wl.length === 21 ? wl : lm),
  };
}

function processResult(res, t) {
  const lms = res.landmarks || [];
  const wls = res.worldLandmarks || [];
  const dets = lms.map((lm, i) => buildDetection(lm, wls[i]));
  state.detections = dets;

  // 贪心匹配：已跟踪的槽位按距离就近认领，避免两朵花互换
  const pairs = [];
  slots.forEach((s, si) =>
    dets.forEach((d, di) => {
      const cost = s.tracked
        ? Math.hypot(s.anchorScreen.x - d.anchor.x, s.anchorScreen.y - d.anchor.y)
        : 1e5 + si * 10 + di;
      pairs.push({ si, di, cost });
    }),
  );
  pairs.sort((a, b) => a.cost - b.cost);
  const usedS = new Set();
  const usedD = new Set();
  for (const p of pairs) {
    if (usedS.has(p.si) || usedD.has(p.di)) continue;
    usedS.add(p.si);
    usedD.add(p.di);
    slots[p.si].observe(dets[p.di]);
  }
  slots.forEach((s, si) => {
    if (!usedS.has(si)) s.tracked = false;
  });

  if (dets.length) {
    state.lastHandsSeenAt = t;
    if (!state.greetedHand) {
      state.greetedHand = true;
      ui.toast('试试握拳 ✊ 再张开 🖐', 2600);
    }
  }
}

// =============================================================
// 骨骼调试层
// =============================================================

let overlayDirty = false;
function drawOverlay() {
  if (!state.showSkeleton || state.mode !== 'camera') {
    if (overlayDirty) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      overlayDirty = false;
    }
    return;
  }
  overlayDirty = true;
  octx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  octx.clearRect(0, 0, W, H);
  const accent = slots[0].flower.palette.mid;
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  for (const d of state.detections) {
    const p = d.pts;
    const bones = () => {
      octx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        octx.moveTo(p[a].x, p[a].y);
        octx.lineTo(p[b].x, p[b].y);
      }
    };
    // 外层彩色光晕
    octx.shadowColor = accent;
    octx.shadowBlur = 18;
    octx.strokeStyle = accent;
    octx.globalAlpha = 0.55;
    octx.lineWidth = 7;
    bones();
    octx.stroke();
    // 内层白色骨线
    octx.globalAlpha = 1;
    octx.shadowBlur = 8;
    octx.shadowColor = '#ffffff';
    octx.strokeStyle = '#ffffff';
    octx.lineWidth = 2.2;
    bones();
    octx.stroke();
    // 关节
    for (let i = 0; i < 21; i++) {
      const tip = FINGERTIPS.includes(i);
      octx.shadowColor = tip ? accent : '#ffffff';
      octx.shadowBlur = tip ? 20 : 6;
      octx.fillStyle = tip ? accent : '#ffffff';
      octx.beginPath();
      octx.arc(p[i].x, p[i].y, tip ? 6.5 : i === 0 ? 5 : 3.6, 0, Math.PI * 2);
      octx.fill();
      if (tip) {
        octx.shadowBlur = 0;
        octx.fillStyle = '#ffffff';
        octx.beginPath();
        octx.arc(p[i].x, p[i].y, 2.6, 0, Math.PI * 2);
        octx.fill();
      }
    }
    octx.shadowBlur = 0;
  }
}

// =============================================================
// UI / 交互
// =============================================================

const ui = createUI({
  onStart: () => startCamera(),
  onMouse: () => {
    enterApp();
    setMode('mouse');
  },
  onAction: (action) => runAction(action),
});

// 触屏设备的文案
const TOUCH_TEXT = IS_MOBILE
  ? { tryIt: '先用手指体验', mode: '触摸模式', modeTip: '按住屏幕：花合 · 松开：花开' }
  : { tryIt: '先用鼠标体验', mode: '鼠标模式', modeTip: '按住鼠标：花合 · 松开：花开' };
document.getElementById('btn-mouse').textContent = TOUCH_TEXT.tryIt;
document.getElementById('mode-label').textContent = TOUCH_TEXT.mode;

if (IN_APP_BROWSER) {
  ui.showError(
    '当前是 App 内置浏览器（如微信），通常无法使用摄像头。请点右上角「···」选择「在浏览器中打开」：iPhone 用 Safari，安卓用 Chrome 或系统浏览器。也可以先用手指体验。',
  );
}

// 电脑端通过 https 打开时，显示二维码方便手机扫码
async function showQrCode() {
  if (IS_MOBILE || location.protocol !== 'https:') return;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    const qr = window.qrcode(0, 'M');
    qr.addData(location.href.split('#')[0]);
    qr.make();
    document.getElementById('qr-img').src = qr.createDataURL(4, 2);
    document.getElementById('qr').hidden = false;
  } catch {
    /* 二维码只是锦上添花，失败就不显示 */
  }
}
showQrCode();

function enterApp() {
  if (state.inApp) return;
  state.inApp = true;
  ui.enterApp();
}

function setMode(mode) {
  state.mode = mode;
  state.detections = [];
  slots.forEach((s) => (s.tracked = false));
  ui.setToggle('mode', mode === 'mouse');
  ui.toast(mode === 'mouse' ? TOUCH_TEXT.modeTip : '张开手掌，让花在指尖绽放', 2600);
}

function runAction(action) {
  switch (action) {
    case 'palette': {
      paletteIndex = (paletteIndex + 1) % PALETTES.length;
      slots.forEach((s, i) => s.flower.setPalette(PALETTES[(paletteIndex + i) % PALETTES.length]));
      ui.setPaletteName(PALETTES[paletteIndex].name);
      ui.toast(`花色 · ${PALETTES[paletteIndex].name}`, 1400);
      break;
    }
    case 'video':
      bg.setVisible(!bg.visible);
      ui.setToggle('video', bg.visible);
      break;
    case 'skeleton':
      state.showSkeleton = !state.showSkeleton;
      ui.setToggle('skeleton', state.showSkeleton);
      break;
    case 'mode':
      if (state.mode === 'mouse') {
        if (tracker.ready && video.srcObject) setMode('camera');
        else startCamera();
      } else {
        setMode('mouse');
      }
      break;
    case 'hide':
      ui.toggleHidden();
      break;
    case 'flip':
      flipCamera();
      break;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.();
      break;
  }
}

const KEYS = { c: 'palette', v: 'video', s: 'skeleton', m: 'mode', h: 'hide', f: 'fullscreen' };
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !state.inApp) return;
  const action = KEYS[e.key.toLowerCase()];
  if (action) runAction(action);
});

window.addEventListener('pointermove', (e) => {
  const now = performance.now();
  const dts = Math.max(8, now - pointer.time) / 1000;
  pointer.vx = pointer.vx * 0.6 + ((e.clientX - pointer.x) / dts) * 0.4;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.time = now;
});
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .intro-card, .dock')) return;
  pointer.down = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
window.addEventListener('pointerup', () => (pointer.down = false));
window.addEventListener('pointercancel', () => (pointer.down = false));

// =============================================================
// 摄像头 + 模型启动
// =============================================================

const tag = (code, cause) => Object.assign(new Error(code), { code, cause });
let starting = false;

async function startCamera() {
  if (starting) return;
  starting = true;
  ui.setBusy(true);
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw tag('INSECURE');

    ui.setStatus('请求摄像头权限…');
    const camP = (
      video.srcObject
        ? Promise.resolve(video.srcObject)
        : navigator.mediaDevices.getUserMedia(cameraConstraints())
    ).catch((e) => {
      throw tag('CAMERA', e);
    });
    // 模型与摄像头并行加载
    const trackerP = (tracker.ready ? Promise.resolve() : tracker.init(CONFIG.maxHands, ui.setStatus)).catch((e) => {
      throw tag('MODEL', e);
    });
    trackerP.catch(() => {}); // 摄像头先失败时避免未处理的 rejection

    const stream = await camP;
    if (video.srcObject !== stream) video.srcObject = stream;
    await video.play();
    bg.setReady(true);
    if (!tracker.ready) ui.setStatus('摄像头已开启，正在加载手部模型…');

    await trackerP;
    ui.setStatus('');
    applyMirror();
    enterApp();
    setMode('camera');
    keepAwake();
    showFlipButton();
  } catch (err) {
    console.error(err);
    const msg = describeError(err);
    if (state.inApp) ui.toast(msg.replace(/<[^>]+>/g, ''), 5000);
    else ui.showError(msg);
  } finally {
    starting = false;
    ui.setBusy(false);
  }
}

function cameraConstraints() {
  return {
    audio: false,
    video: {
      facingMode: state.facing,
      width: { ideal: CONFIG.videoWidth },
      height: { ideal: CONFIG.videoHeight },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

function applyMirror() {
  state.mirror = state.facing === 'user';
  bg.setMirror(state.mirror);
}

// 前置 ↔ 后置。iPhone 同一时间只允许一路摄像头，必须先停掉旧的
let flipping = false;
async function flipCamera() {
  if (flipping || !video.srcObject) return;
  flipping = true;
  const prev = state.facing;
  const next = prev === 'user' ? 'environment' : 'user';
  const stop = () => video.srcObject?.getTracks().forEach((t) => t.stop());
  try {
    stop();
    state.facing = next;
    video.srcObject = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    await video.play();
    applyMirror();
    ui.toast(next === 'user' ? '前置镜头' : '后置镜头', 1200);
  } catch (err) {
    console.warn('[camera] 切换失败', err);
    state.facing = prev;
    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      await video.play();
    } catch {}
    applyMirror();
    ui.toast('这台设备无法切换镜头', 2400);
  } finally {
    flipping = false;
  }
}

async function showFlipButton() {
  let many = IS_MOBILE;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    many = many || devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {}
  document.getElementById('btn-flip').hidden = !many;
}

// 手机上防止息屏
let wakeLock = null;
async function keepAwake() {
  try {
    if (document.visibilityState === 'visible' && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.mode === 'camera') keepAwake();
});

function describeError(err) {
  const name = err.cause?.name || '';
  switch (err.code) {
    case 'INSECURE':
      return IS_MOBILE
        ? '手机上只有通过 <b>https://</b> 开头的链接打开，才能使用摄像头。请使用部署后的 https 地址。'
        : '摄像头只能在 <b>http://localhost</b> 或 https 页面中使用。请运行 <code>npm start</code> 后访问 http://localhost:5173。';
    case 'CAMERA':
      if (name === 'NotAllowedError' || name === 'SecurityError')
        return IS_MOBILE
          ? '摄像头权限被拒绝。iPhone：设置 → Safari → 相机 → 允许；安卓：浏览器的网站设置里允许相机。然后刷新重试。'
          : '摄像头权限被拒绝。请点击地址栏左侧的图标允许摄像头，然后重试；也可以先用鼠标体验。';
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        return '没有找到可用的摄像头。可以先用鼠标体验。';
      if (name === 'NotReadableError')
        return '摄像头被其他程序占用（如会议软件），关闭后重试。';
      return `摄像头打开失败：${err.cause?.message || name}`;
    case 'MODEL':
      return '手部识别模型加载失败，可能是网络无法访问模型或 CDN。请换个网络刷新重试；现在可以先用' + (IS_MOBILE ? '手指' : '鼠标') + '体验。';
    default:
      return `启动失败：${err.message}`;
  }
}

// =============================================================
// 尺寸 & 主循环
// =============================================================

function resize() {
  W = innerWidth;
  H = innerHeight;
  pixelRatio = Math.min(devicePixelRatio || 1, CONFIG.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  overlay.width = Math.round(W * pixelRatio);
  overlay.height = Math.round(H * pixelRatio);
  overlayDirty = true;
  bg.resize(W, H);
  pollen.setPixelRatio(pixelRatio);
  slots.forEach((s) => s.flower.setPixelRatio(pixelRatio));
}
window.addEventListener('resize', resize);
resize();

let hudTimer = 0;
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

function updateHud() {
  const tracked = slots.filter((s) => s.tracked).length;
  const main = slots.reduce((a, s) => (s.presence > a.presence ? s : a), slots[0]);
  const b = main.bloom;
  let label = b < 0.2 ? '花苞 · 闭合' : b < 0.75 ? '含苞 · 半开' : '绽放';
  if (state.mode === 'camera' && !tracked) label = '等待手掌…';
  const modeName = state.mode === 'mouse' ? '鼠标' : state.mode === 'camera' ? '摄像头' : '演示';
  const parts = [modeName];
  if (state.mode === 'camera') parts.push(`手 ${tracked}`, tracker.delegate);
  parts.push(`${fps} fps`);
  ui.updateHud({
    label,
    bloom: b,
    live: tracked > 0 || state.mode === 'mouse',
    info: parts.join(' · '),
  });
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (state.mode === 'camera') {
    const res = tracker.detect(video);
    if (res) processResult(res, t);
  }
  pointer.vx *= Math.exp(-dt * 6);

  for (const s of slots) s.update(dt, t);
  pollen.update(dt, t);
  bg.update(dt);
  drawOverlay();
  composer.render(dt);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  hudTimer -= dt;
  if (hudTimer <= 0 && state.inApp) {
    hudTimer = 0.1;
    updateHud();
  }
}

frame();

// 调试用：在控制台里 window.bloom 可以访问内部对象
window.bloom = { CONFIG, slots, renderer, bloomPass, tracker, state };
