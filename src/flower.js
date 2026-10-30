import * as THREE from 'three';
import { CONFIG } from './config.js';

/*
 * 粒子花朵
 * --------------------------------------------------------------
 * 每个粒子在 CPU 端只记录“它在哪片花瓣、花瓣上的哪个位置 (u, v)”，
 * 真正的三维形状完全由顶点着色器根据 uBloom（0 = 花苞，1 = 盛开）实时计算：
 *
 *   u ∈ [0,1]  沿花瓣长度（0 = 花托，1 = 花瓣尖）
 *   v ∈ [-1,1] 沿花瓣宽度（0 = 中脉，±1 = 边缘）
 *
 * 花瓣中脉是一条“曲率恒定”的弧线：起始倾角 t0、弯曲量 curl。
 *   花苞：t0 小、curl 为负 → 花瓣向内收，尖端在轴心汇合（泪滴形花苞）
 *   盛开：t0 大、curl 为正 → 花瓣向外平展，瓣尖微微外翻
 * 宽度方向绕花轴“包裹”（横向偏移换算成方位角），花苞时自然层层裹紧。
 * 外层先开、内层后开（层间延迟），开合有层次感。
 */

const PETAL_VERT = /* glsl */ `
uniform float uTime;
uniform float uBloom;
uniform float uScatter;
uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;
uniform float uAlpha;
uniform float uIntensity;
uniform float uFingerActive;
uniform float uFingerRadius;
uniform float uFingerPush;
uniform vec3 uFingers[5];
uniform vec3 uColBase;
uniform vec3 uColMid;
uniform vec3 uColTip;

attribute float aLayer;
attribute float aAzimuth;
attribute float aPetalRand;
attribute vec2 aUV;
attribute vec4 aRand;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float u = aUV.x;
  float v = aUV.y;

  // 外层先开，内层后开
  float delay = (1.0 - aLayer) * 0.35;
  float lb = clamp((uBloom - delay) / (1.0 - delay), 0.0, 1.0);
  lb = lb * lb * (3.0 - 2.0 * lb);

  // —— 花瓣尺寸与轮廓 ——
  float len = mix(0.62, 1.0, aLayer) * (0.9 + aPetalRand * 0.2);
  float wid = mix(0.26, 0.40, aLayer) * mix(0.75, 1.0, lb);
  float shape = sin(3.14159265 * pow(max(u, 1e-4), 0.72)); // 根窄、中宽、尖收
  float notch = 0.08 * smoothstep(0.7, 1.0, u) * (1.0 - v * v); // 瓣尖心形凹口

  // —— 中脉弧线：倾角 t0 + 匀速弯曲 curl ——
  float breath = sin(uTime * 1.3 + aAzimuth * 2.0 + aLayer * 3.0) * 0.035;
  float t0c = mix(0.42, 0.58, aLayer);
  float t0 = mix(t0c, mix(0.62, 1.3, aLayer), lb) + breath + (aPetalRand - 0.5) * 0.12;
  float curl = mix(-1.9 * t0c, mix(0.2, 0.5, aLayer), lb);

  float s = u * len * (1.0 - notch);
  float k = curl / len;
  float a = t0 + k * s;
  float r;
  float y;
  if (abs(k) < 1e-3) {
    r = sin(t0) * s;
    y = cos(t0) * s;
  } else {
    r = (cos(t0) - cos(a)) / k;
    y = (sin(a) - sin(t0)) / k;
  }

  float r0 = (0.035 + aLayer * 0.06) * (1.0 - 0.8 * u);
  float rr = max(r, 0.0) + r0;

  // —— 宽度：边缘朝内上方卷起（杯状），再绕花轴包裹 ——
  float halfW = shape * wid;
  float cup = mix(0.35, 0.22, lb) * v * v * halfW;
  rr -= cos(a) * cup;
  y += sin(a) * cup;
  rr = max(rr, 0.005);
  float phi = aAzimuth + clamp(v * halfW / (rr + 0.05), -1.4, 1.4);

  vec3 pos = vec3(cos(phi) * rr, y, sin(phi) * rr);
  pos += (aRand.xyz - 0.5) * 0.012;                                    // 花瓣厚度
  pos.y += sin(uTime * 2.2 + aAzimuth * 3.0 + u * 4.0) * 0.02 * u * lb; // 瓣尖轻颤

  // —— 绽放时向外迸散 ——
  vec3 outward = normalize(vec3(pos.x, 0.35, pos.z) + (aRand.xyz - 0.5) * 0.5);
  pos += outward * uScatter * (0.15 + aRand.y * 0.6) * u;

  // 少量瓣尖粒子持续剥离、飘走（只在盛开时）
  float drifter = step(0.94, aRand.w) * step(0.5, u);
  float life = fract(uTime * (0.08 + aRand.x * 0.1) + aRand.z * 7.0);
  float drift = drifter * lb * life;
  pos += outward * drift * 1.1 + vec3(0.0, drift * 0.3, 0.0);

  // —— 指尖拨动：在屏幕平面内把粒子推开 ——
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  float glow = 0.0;
  float inv = 1.0 / max(uFingerRadius * uFingerRadius, 1e-5);
  for (int i = 0; i < 5; i++) {
    vec2 d = wp.xy - uFingers[i].xy;
    float f = exp(-dot(d, d) * inv) * uFingerActive;
    wp.xy += normalize(d + vec2(1e-4)) * f * uFingerPush * (0.4 + u);
    glow += f;
  }

  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;

  float size = (0.5 + aRand.x * 0.9) * (1.0 - 0.3 * u) * (1.0 + drifter * 0.4);
  gl_PointSize = uSize * uScale * size * uPixelRatio / max(-mv.z, 0.1);

  // —— 颜色：根部深 → 中段 → 尖端/边缘浅 ——
  vec3 col = mix(uColBase, uColMid, smoothstep(0.0, 0.5, u));
  col = mix(col, uColTip, smoothstep(0.5, 1.05, u));
  float edge = smoothstep(0.7, 1.0, abs(v));
  col = mix(col, uColTip, edge * 0.45);
  col *= mix(0.55, 1.25, smoothstep(0.0, 1.0, u)) * mix(1.05, 0.95, aLayer) * mix(0.7, 1.0, lb);
  col += vec3(1.0, 0.9, 0.95) * min(glow, 1.5) * 0.6;
  vColor = col;

  float alpha = uAlpha * uIntensity * (0.3 + 0.7 * aRand.y * aRand.y);
  alpha *= mix(1.0, 1.0 - life, drifter * lb);
  vAlpha = alpha;
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = exp(-d * 6.0) + exp(-d * 28.0) * 0.5;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

const STAMEN_VERT = /* glsl */ `
uniform float uTime;
uniform float uBloom;
uniform float uSize;
uniform float uScale;
uniform float uPixelRatio;
uniform float uAlpha;
uniform float uIntensity;
uniform vec3 uColCore;

attribute vec3 aDir;
attribute float aT;
attribute float aAnther;
attribute vec3 aRand;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float lb = smoothstep(0.2, 1.0, uBloom);
  float spread = mix(0.25, 1.0, lb);
  vec3 dir = normalize(vec3(aDir.x * spread, aDir.y, aDir.z * spread));
  float len = mix(0.14, 0.42, lb) * (0.75 + aRand.x * 0.5);

  vec3 pos = dir * len * aT;
  pos.xz *= 1.0 + aT * aT * 0.5 * lb;   // 花丝向外弯
  pos.y += 0.03;
  pos += (aRand - 0.5) * 0.035 * aAnther; // 花药成簇
  pos.x += sin(uTime * 1.7 + aRand.y * 6.2832) * 0.012 * aT;
  pos.z += cos(uTime * 1.3 + aRand.z * 6.2832) * 0.012 * aT;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(0.55, 1.5, aAnther) * (0.7 + aRand.z * 0.6);
  gl_PointSize = uSize * uScale * size * uPixelRatio / max(-mv.z, 0.1);

  vColor = mix(uColCore * 0.55, uColCore, aT) * mix(1.0, 1.7, aAnther);
  vAlpha = uAlpha * uIntensity * mix(0.35, 1.0, lb) * mix(0.5, 0.9, aAnther);
}
`;

// ---------- 几何（所有花朵共享） ----------

let petalGeometry = null;
let stamenGeometry = null;
let haloTexture = null;

function buildPetalGeometry() {
  const P = CONFIG.petalsPerLayer;
  const N = CONFIG.particlesPerPetal;
  let total = 0;
  P.forEach((n, i) => (total += n * N[i]));

  const position = new Float32Array(total * 3); // 由着色器计算，占位即可
  const aLayer = new Float32Array(total);
  const aAzimuth = new Float32Array(total);
  const aPetalRand = new Float32Array(total);
  const aUV = new Float32Array(total * 2);
  const aRand = new Float32Array(total * 4);

  let k = 0;
  const L = P.length;
  for (let l = 0; l < L; l++) {
    const layerT = L === 1 ? 1 : l / (L - 1);
    const n = P[l];
    const offset = l * 0.618 * Math.PI; // 层间错开，避免花瓣对齐
    for (let p = 0; p < n; p++) {
      const az = offset + (p / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      const pr = Math.random();
      for (let i = 0; i < N[l]; i++) {
        // 按花瓣宽度做拒绝采样，让粒子面密度更均匀
        let u;
        do {
          u = Math.random();
        } while (Math.random() > Math.sin(Math.PI * Math.pow(u, 0.72)) * 0.85 + 0.15);

        // 一部分粒子勾勒花瓣边缘和中脉，轮廓更清晰
        const pick = Math.random();
        let v;
        if (pick < 0.26) v = (Math.random() < 0.5 ? -1 : 1) * (0.86 + Math.random() * 0.14);
        else if (pick < 0.34) v = (Math.random() - 0.5) * 0.08;
        else v = Math.random() * 2 - 1;

        aLayer[k] = layerT;
        aAzimuth[k] = az;
        aPetalRand[k] = pr;
        aUV[k * 2] = u;
        aUV[k * 2 + 1] = v;
        for (let j = 0; j < 4; j++) aRand[k * 4 + j] = Math.random();
        k++;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aLayer', new THREE.BufferAttribute(aLayer, 1));
  g.setAttribute('aAzimuth', new THREE.BufferAttribute(aAzimuth, 1));
  g.setAttribute('aPetalRand', new THREE.BufferAttribute(aPetalRand, 1));
  g.setAttribute('aUV', new THREE.BufferAttribute(aUV, 2));
  g.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4));
  return g;
}

function buildStamenGeometry() {
  const strands = CONFIG.stamenStrands;
  const along = 22;
  const anther = 7;
  const total = strands * (along + anther);

  const position = new Float32Array(total * 3);
  const aDir = new Float32Array(total * 3);
  const aT = new Float32Array(total);
  const aAnther = new Float32Array(total);
  const aRand = new Float32Array(total * 3);

  let k = 0;
  for (let s = 0; s < strands; s++) {
    const az = Math.random() * Math.PI * 2;
    const theta = Math.pow(Math.random(), 0.8) * 1.1; // 偏离花轴的角度
    const dir = [Math.cos(az) * Math.sin(theta), Math.cos(theta), Math.sin(az) * Math.sin(theta)];
    const strandRand = Math.random();
    for (let j = 0; j < along + anther; j++) {
      const isAnther = j >= along;
      aDir.set(dir, k * 3);
      aT[k] = isAnther ? 1 : (j + Math.random() * 0.5) / along;
      aAnther[k] = isAnther ? 1 : 0;
      aRand[k * 3] = strandRand;
      aRand[k * 3 + 1] = Math.random();
      aRand[k * 3 + 2] = Math.random();
      k++;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(aDir, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aAnther', new THREE.BufferAttribute(aAnther, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(aRand, 3));
  return g;
}

function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

// ---------- Flower ----------

export class Flower {
  constructor(palette, pixelRatio) {
    petalGeometry ??= buildPetalGeometry();
    stamenGeometry ??= buildStamenGeometry();

    // 层级：root(位置/缩放/随手倾斜) → tilt(朝镜头俯仰) → spin(自转)
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.spin = new THREE.Group();
    this.root.add(this.tilt);
    this.tilt.add(this.spin);

    this.palette = palette;
    this.colors = {
      base: new THREE.Color(palette.base),
      mid: new THREE.Color(palette.mid),
      tip: new THREE.Color(palette.tip),
      core: new THREE.Color(palette.core),
    };
    this.targetColors = {
      base: this.colors.base.clone(),
      mid: this.colors.mid.clone(),
      tip: this.colors.tip.clone(),
      core: this.colors.core.clone(),
    };

    this.fingers = Array.from({ length: 5 }, () => new THREE.Vector3(1e4, 1e4, 0));

    const shared = {
      uTime: { value: 0 },
      uBloom: { value: 0 },
      uScale: { value: 1 },
      uPixelRatio: { value: pixelRatio },
      uAlpha: { value: 0 },
    };
    this.shared = shared;

    this.petalUniforms = {
      ...shared,
      uScatter: { value: 0 },
      uSize: { value: CONFIG.petalPointSize },
      uIntensity: { value: CONFIG.petalIntensity },
      uFingerActive: { value: 0 },
      uFingerRadius: { value: 0.3 },
      uFingerPush: { value: 0.1 },
      uFingers: { value: this.fingers },
      uColBase: { value: this.colors.base },
      uColMid: { value: this.colors.mid },
      uColTip: { value: this.colors.tip },
    };

    this.petals = new THREE.Points(
      petalGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.petalUniforms,
        vertexShader: PETAL_VERT,
        fragmentShader: POINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.petals.frustumCulled = false;
    this.spin.add(this.petals);

    this.stamens = new THREE.Points(
      stamenGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uSize: { value: CONFIG.stamenPointSize },
          uIntensity: { value: 0.5 },
          uColCore: { value: this.colors.core },
        },
        vertexShader: STAMEN_VERT,
        fragmentShader: POINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stamens.frustumCulled = false;
    this.spin.add(this.stamens);

    // 花心柔光
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: this.colors.mid,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      }),
    );
    this.root.add(this.halo);
  }

  setPalette(palette) {
    this.palette = palette;
    this.targetColors.base.set(palette.base);
    this.targetColors.mid.set(palette.mid);
    this.targetColors.tip.set(palette.tip);
    this.targetColors.core.set(palette.core);
  }

  setPixelRatio(pr) {
    this.shared.uPixelRatio.value = pr;
  }

  /**
   * @param {object} s
   *  dt, t, bloom(0~1), scatter(0~1), presence(0~1), pos(Vector3), scale, lean(弧度),
   *  fingers(Vector3[5], 世界坐标), fingerActive(0~1)
   */
  update(s) {
    this.root.visible = s.presence > 0.003;
    if (!this.root.visible) return;

    this.root.position.copy(s.pos);
    this.root.scale.setScalar(s.scale);
    this.root.rotation.z = s.lean;
    this.tilt.rotation.x = THREE.MathUtils.lerp(CONFIG.tiltClosed, CONFIG.tiltOpen, s.bloom);
    this.spin.rotation.y += s.dt * (CONFIG.spinSpeed + s.scatter * 0.8);

    // 换色时平滑过渡
    const ck = 1 - Math.exp(-s.dt * 3);
    for (const key of ['base', 'mid', 'tip', 'core']) this.colors[key].lerp(this.targetColors[key], ck);

    this.shared.uTime.value = s.t;
    this.shared.uBloom.value = s.bloom;
    this.shared.uScale.value = s.scale;
    this.shared.uAlpha.value = s.presence;

    const pu = this.petalUniforms;
    pu.uScatter.value = s.scatter;
    pu.uFingerActive.value = s.fingerActive * (0.3 + 0.7 * s.bloom);
    pu.uFingerRadius.value = CONFIG.fingerRadius * s.scale;
    pu.uFingerPush.value = CONFIG.fingerPush * s.scale;
    for (let i = 0; i < 5; i++) {
      if (s.fingers && s.fingers[i]) this.fingers[i].copy(s.fingers[i]);
      else this.fingers[i].set(1e4, 1e4, 0);
    }

    this.halo.material.color.copy(this.colors.mid);
    this.halo.scale.setScalar(1.6 + 1.6 * s.bloom);
    this.halo.material.opacity = s.presence * (0.03 + 0.08 * s.bloom);
  }
}
