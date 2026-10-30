// 所有可调参数集中在这里。改完刷新页面即可看到效果。

const CDN = 'https://cdn.jsdelivr.net/npm/';
const CDN2 = 'https://fastly.jsdelivr.net/npm/';
const MIRROR = 'https://registry.npmmirror.com/';
const MP_VER = '0.10.14';

// 手机 / 平板（触屏）检测：用于降低粒子数、切换文案
export const IS_MOBILE = (() => {
  try {
    return (
      /Android|iPhone|iPad|iPod|HarmonyOS|OpenHarmony|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
      matchMedia('(pointer: coarse)').matches
    );
  } catch {
    return false;
  }
})();

// App 内置浏览器（微信、QQ、微博、抖音等）通常拿不到摄像头
export const IN_APP_BROWSER = /MicroMessenger|QQ\/|Weibo|DingTalk|AlipayClient|aweme|Douyin|Lark|XiaoHongShu/i.test(
  navigator.userAgent,
);

export const CONFIG = {
  // —— 识别 ——
  maxHands: 2,                 // 同时识别的手数（每只手一朵花）
  videoWidth: 1280,            // 摄像头分辨率
  videoHeight: 720,

  // —— 相机 / 渲染 ——
  fov: 45,
  cameraZ: 5,
  maxPixelRatio: 1.75,         // 高分屏上限，性能不足可降到 1

  // —— 花朵结构（由内到外每层） ——
  petalsPerLayer: [5, 7, 9, 11],
  particlesPerPetal: [650, 750, 850, 950],
  petalPointSize: 20,          // 花瓣粒子基础尺寸
  petalIntensity: 0.32,         // 花瓣亮度（叠加混合，过高会发白）
  stamenStrands: 64,           // 花蕊丝数量
  stamenPointSize: 22,

  // —— 姿态 ——
  tiltClosed: 0.35,            // 花苞时朝镜头倾斜（弧度，偏侧视）
  tiltOpen: 1.0,               // 盛开时朝镜头倾斜（弧度，偏俯视）
  spinSpeed: 0.12,             // 自转速度
  openSpeed: 3.2,              // 张开跟随速度（越大越跟手）
  closeSpeed: 5.5,             // 闭合跟随速度

  // —— 跟随手 ——
  flowerScale: 1.15,           // 花朵尺寸 = 手掌长度 × 该系数
  anchorToTips: 0.5,           // 花心位置：0 在掌心，1 在指尖中心
  fingerRadius: 0.32,          // 指尖拨动半径（相对花朵尺寸）
  fingerPush: 0.16,            // 指尖拨动力度

  // —— 花粉 ——
  pollenMax: 1600,
  pollenRate: 26,              // 盛开时每秒飘散数量
  pollenSize: 20,
  burstCount: 140,             // 快速“握拳→张开”时的爆发数量

  // —— 后期辉光 ——
  bloomStrength: 0.7,
  bloomRadius: 0.35,
  bloomThreshold: 0.62,

  videoDim: 0.22,               // 摄像头背景亮度（0~1）
  demoDelay: 1.5,              // 多久看不到手后进入演示动画（秒）

  // —— 资源（按顺序尝试，前面的失败才用后面的） ——
  modelUrls: [
    './models/hand_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  ],
  wasmUrls: [
    './node_modules/@mediapipe/tasks-vision/wasm',
    `${CDN}@mediapipe/tasks-vision@${MP_VER}/wasm`,
    `${CDN2}@mediapipe/tasks-vision@${MP_VER}/wasm`,
    `${MIRROR}@mediapipe/tasks-vision/${MP_VER}/files/wasm`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/wasm`,
  ],
  visionModuleFallbacks: [
    `${CDN}@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
    `${CDN2}@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
    `${MIRROR}@mediapipe/tasks-vision/${MP_VER}/files/vision_bundle.mjs`,
    `https://unpkg.com/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`,
  ],
};

// 手机：单手、更少粒子、更低分辨率，保证流畅和不发烫
if (IS_MOBILE) {
  Object.assign(CONFIG, {
    maxHands: 1,
    videoWidth: 640,
    videoHeight: 480,
    maxPixelRatio: 1.5,
    particlesPerPetal: [380, 440, 500, 560],
    stamenStrands: 44,
    pollenMax: 900,
    pollenRate: 18,
    burstCount: 90,
  });
}

// 花色：base 花瓣根部 / mid 花瓣中段 / tip 花瓣边缘与尖端 / core 花蕊
export const PALETTES = [
  { name: '樱粉', base: '#7a0634', mid: '#ff3d8b', tip: '#fff0f6', core: '#ffc93d' },
  { name: '睡莲', base: '#33106b', mid: '#9a6bff', tip: '#f4f7ff', core: '#ffd75e' },
  { name: '赤焰', base: '#6e070b', mid: '#ff3a10', tip: '#ffe0a3', core: '#fff3b0' },
  { name: '冰晶', base: '#061f5c', mid: '#14a8ff', tip: '#effdff', core: '#a8fff0' },
  { name: '金桂', base: '#5c2a04', mid: '#ff9d0a', tip: '#fff6dc', core: '#ffffff' },
];
