import * as THREE from 'three';

/*
 * 摄像头背景：全屏四边形，直接写裁剪空间坐标（不受相机影响）。
 * 做了 object-fit: cover 等比裁切 + 镜像 + 压暗 + 轻度去饱和 + 暗角，
 * 让花朵成为画面主角；压暗后亮度低于辉光阈值，背景不会“发光”。
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uVideoAspect;
uniform float uScreenAspect;
uniform float uDim;
uniform float uMirror;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  if (uScreenAspect > uVideoAspect) {
    uv.y = (uv.y - 0.5) * (uVideoAspect / uScreenAspect) + 0.5;
  } else {
    uv.x = (uv.x - 0.5) * (uScreenAspect / uVideoAspect) + 0.5;
  }
  uv.x = mix(uv.x, 1.0 - uv.x, uMirror); // 前置镜头镜像，像照镜子一样

  vec3 c = texture2D(uTex, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.55) * vec3(0.86, 0.88, 1.05);
  float vig = 1.0 - smoothstep(0.35, 1.25, length(vUv - 0.5) * 1.6);
  gl_FragColor = vec4(c * uDim * vig, 1.0);
}
`;

export function createVideoBackground(video, dim = 0.3) {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;

  const uniforms = {
    uTex: { value: texture },
    uVideoAspect: { value: 16 / 9 },
    uScreenAspect: { value: innerWidth / innerHeight },
    uDim: { value: 0 },
    uMirror: { value: 1 },
  };

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  let ready = false;
  let visible = false; // 默认隐藏摄像头画面，按 V 显示

  return {
    mesh,
    setReady(v) {
      ready = v;
    },
    setMirror(v) {
      uniforms.uMirror.value = v ? 1 : 0;
    },
    setVisible(v) {
      visible = v;
    },
    get visible() {
      return visible;
    },
    resize(w, h) {
      uniforms.uScreenAspect.value = w / h;
    },
    update(dt) {
      if (video.videoWidth) uniforms.uVideoAspect.value = video.videoWidth / video.videoHeight;
      const target = ready && visible ? dim : 0;
      uniforms.uDim.value += (target - uniforms.uDim.value) * (1 - Math.exp(-dt * 4));
    },
  };
}
