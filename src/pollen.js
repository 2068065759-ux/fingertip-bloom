import * as THREE from 'three';
import { CONFIG } from './config.js';

/*
 * 花粉 / 光尘：CPU 端模拟，世界坐标。
 * 花朵移动时花粉留在原地，自然形成拖尾。
 * 使用环形缓冲区，新粒子覆盖最旧的粒子。
 */

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
attribute float aLife;
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float alive = step(0.0001, aLife);
  float fade = smoothstep(0.0, 0.3, aLife) * (1.0 - smoothstep(0.92, 1.0, aLife));
  float twinkle = 0.65 + 0.35 * sin(uTime * 11.0 + aSize * 37.0);
  gl_PointSize = alive * uSize * aSize * (0.45 + 0.55 * aLife) * uPixelRatio / max(-mv.z, 0.1);
  vColor = aColor;
  vAlpha = alive * fade * twinkle;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = exp(-d * 4.5) + exp(-d * 30.0) * 0.6;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
const tmpC = new THREE.Color();

export class Pollen {
  constructor(max = CONFIG.pollenMax, pixelRatio = 1) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.seed = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLife', this.aLife);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aColor);

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: CONFIG.pollenSize },
      uPixelRatio: { value: pixelRatio },
    };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  setPixelRatio(pr) {
    this.uniforms.uPixelRatio.value = pr;
  }

  /**
   * 从花朵周围的圆环区域发射花粉
   * @param {THREE.Vector3} center 花心（世界坐标）
   * @param {number} radius 发射半径
   * @param {number} count 数量
   * @param {object} palette 当前花色
   * @param {number} speed 初速度
   */
  emit(center, radius, count, palette, speed) {
    tmpA.set(palette.core);
    tmpB.set(palette.tip);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;

      const ang = Math.random() * Math.PI * 2;
      const r = radius * (0.25 + Math.random() * 0.75);
      const cx = Math.cos(ang);
      const cy = Math.sin(ang);
      this.pos[i * 3] = center.x + cx * r;
      this.pos[i * 3 + 1] = center.y + cy * r * 0.85;
      this.pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * radius * 0.3;

      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = cx * sp + (Math.random() - 0.5) * 0.1;
      this.vel[i * 3 + 1] = cy * sp + speed * 0.15 + (Math.random() - 0.5) * 0.1;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;

      this.life[i] = 1;
      this.span[i] = 1.4 + Math.random() * 1.8;
      this.size[i] = 0.5 + Math.random() * 1.2;
      this.seed[i] = Math.random() * 100;

      if (palette.rainbow) {
        tmpC.setHSL(Math.random(), 1, 0.6 + Math.random() * 0.25);
      } else {
        tmpC.copy(tmpA).lerp(tmpB, Math.random());
      }
      this.color[i * 3] = tmpC.r * 1.4;
      this.color[i * 3 + 1] = tmpC.g * 1.4;
      this.color[i * 3 + 2] = tmpC.b * 1.4;
    }
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  update(dt, t) {
    this.uniforms.uTime.value = t;
    const drag = Math.exp(-dt * 1.2);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / this.span[i]);
      const j = i * 3;
      const sd = this.seed[i];
      // 阻尼 + 轻微上浮 + 旋涡状扰动
      this.vel[j] = this.vel[j] * drag + Math.sin(t * 1.3 + this.pos[j + 1] * 3.0 + sd) * 0.18 * dt;
      this.vel[j + 1] = this.vel[j + 1] * drag + 0.09 * dt + Math.cos(t * 1.1 + this.pos[j] * 2.6 + sd) * 0.1 * dt;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
  }
}
