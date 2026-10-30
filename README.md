# 指尖花开 · Fingertip Bloom

摄像头识别手势，粒子花朵在指尖开合：**握拳 → 花瓣收拢成花苞，张开手掌 → 花瓣由外向内层层绽放、花粉飞散**。花朵跟随手掌移动、随手的方向倾斜，指尖还能拨开花瓣。

- Three.js（r170）：约 2.7 万粒子/朵，GLSL 顶点着色器实时计算花形，UnrealBloom 辉光
- MediaPipe Hands（Tasks Vision `HandLandmarker`，21 关键点，最多 2 只手 = 2 朵花）
- 原生 ES Module，无需打包；本地依赖优先，CDN 自动兜底

## 快速开始

摄像头只能在 `http://localhost` 或 `https` 下使用，**不能直接双击 index.html**。任选一种：

```bash
# A. 推荐：零依赖 Node 服务器（Node 18+）
node server.mjs            # 打开 http://localhost:5173

# B. Python
python -m http.server 5173

# C. Vite（可选，带热更新）
npm install
npm run dev
```

依赖加载顺序：

| 资源 | 优先 | 兜底 |
|---|---|---|
| three / three/addons | `./node_modules/three`（`npm install` 后） | jsDelivr → fastly.jsdelivr → npmmirror → unpkg |
| MediaPipe 运行库 + wasm | `./node_modules/@mediapipe/tasks-vision` | jsDelivr → fastly.jsdelivr → npmmirror → unpkg |
| 手部模型 `hand_landmarker.task` | `./models/hand_landmarker.task` | storage.googleapis.com |

## 手机版

同一套代码，手机打开会自动切换成手机模式：单手识别、约 1.5 万粒子、640×480 摄像头、可切换前后镜头、防息屏，鼠标模式变为“触摸模式”（按住屏幕花合，松开花开）。

**手机只能通过 `https://` 链接使用摄像头**，所以需要把项目部署到一个 HTTPS 网址（二选一）：

1. **GitHub Pages（自动）**：把项目推到 GitHub 仓库的 `main` 分支，在仓库 Settings → Pages → Source 选 “GitHub Actions”。`.github/workflows/pages.yml` 会自动安装依赖、下载模型并发布，地址是 `https://<用户名>.github.io/<仓库名>/`。所有资源同源，手机端不依赖外部 CDN。
2. **Netlify Drop（手动，1 分钟）**：先确保 `models/hand_landmarker.task` 在项目里（运行过一次 `start.command` 就有），然后打开 https://app.netlify.com/drop ，登录后把整个 `fingertip-bloom` 文件夹拖进去，得到 `https://xxx.netlify.app` 链接。

部署后用电脑打开该链接，开场卡片里会出现二维码，手机扫码即可。

手机上注意：
- 微信、QQ 等 App 内置浏览器通常拿不到摄像头，页面会提示；点右上角「···」→「在浏览器中打开」。iPhone 用 Safari，安卓用 Chrome 或系统浏览器。
- 第一次打开要允许相机权限；拒绝后 iPhone 在 设置 → Safari → 相机 里改回“允许”。
- 手机握在一只手里、另一只手在前置镜头前做手势最方便；也可以点「翻转」用后置镜头对着别人的手。

> **国内网络注意**：模型默认从 `storage.googleapis.com` 下载，可能打不开。运行 `npm run fetch-model`（需能访问谷歌），或用浏览器下载下面的链接，放到 `models/hand_landmarker.task` 即可，之后完全离线可用（配合 `npm install` 本地依赖）：
> `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

## 操作

| 动作 / 按键 | 效果 |
|---|---|
| 张开手掌 | 绽放（外层先开，内层后开），持续飘散花粉 |
| 握拳 | 收拢为花苞 |
| 快速 握拳 → 张开 | 花瓣迸散 + 花粉爆发 |
| 移动 / 转动手 | 花跟随，并沿手的方向倾斜 |
| 指尖靠近花瓣 | 花瓣被拨开并发亮 |
| `C` | 切换花色（樱粉 / 睡莲 / 赤焰 / 冰晶 / 金桂） |
| `V` | 显示 / 隐藏摄像头画面 |
| `S` | 显示手部骨骼与张开度（调试） |
| `M` | 鼠标模式：按住 = 合，松开 = 开 |
| `H` / `F` | 隐藏界面 / 全屏 |

看不到手 1.5 秒后，花会回到画面中央自己缓慢开合，提示玩法。

## 目录

```
index.html          页面 + 依赖加载器（动态 importmap：本地优先、CDN 兜底）
style.css
server.mjs          零依赖静态服务器（正确的 .wasm/.task MIME）
scripts/fetch-model.mjs
models/             放 hand_landmarker.task（可选）
src/
  config.js         所有可调参数、花色
  main.js           渲染管线、手→花的映射、交互、主循环
  flower.js         花瓣/花蕊着色器与几何
  pollen.js         花粉（CPU 世界坐标粒子，移动时有拖尾）
  hands.js          HandLandmarker 封装、张开度计算
  background.js     摄像头背景（cover 裁切、镜像、压暗）
  ui.js             界面
```

## 实现要点

**1. 张开度（hands.js）** — 对四根手指分别累加 MCP、PIP、DIP 三处关节的弯曲角（用 `worldLandmarks` 三维坐标）。伸直约 0.3–0.7 rad，握拳约 3.3–4 rad，映射到 0–1；拇指用“拇指尖到中指根距离 / 掌宽”。角度与手离镜头远近、手的朝向无关，比“指尖到手腕距离”稳定。

**2. 花形完全在 GPU 上算（flower.js）** — CPU 只给每个粒子分配“第几层、第几片、花瓣上的位置 (u, v)”。顶点着色器把花瓣中脉当成一条匀曲率弧线：

- 花苞：起始倾角小、弯曲为负，瓣尖在轴心汇合 → 泪滴形
- 盛开：倾角大、弯曲为正 → 向外平展、瓣尖微卷
- 宽度方向换算成绕花轴的方位角，花苞时自然层层包裹；边缘向内上方卷起成杯状
- 层间延迟：外层先开、内层后开
- 26% 粒子落在花瓣边缘、8% 落在中脉，轮廓清楚

**3. 指尖交互** — 5 个指尖的世界坐标传入 uniform，在着色器里按屏幕平面距离做高斯衰减的排斥，并给附近粒子加亮。

**4. 绽放的冲击感** — 张开速度转为 `uScatter` 冲量，粒子沿径向迸散后回弹；快速“握拳→张开”额外触发花粉爆发；盛开时少量瓣尖粒子周期性剥离飘走。

**5. 坐标对齐** — 背景视频用 cover 方式铺满并镜像，关键点用同一套换算映射到屏幕像素，再投射到 z=0 平面，保证花正好在手上。

## 调参（src/config.js）

| 参数 | 作用 |
|---|---|
| `petalsPerLayer` / `particlesPerPetal` | 花瓣层数、片数、粒子数（性能主要取决于此） |
| `petalIntensity` / `bloomStrength` | 亮度 / 辉光，发白就调低 |
| `flowerScale` / `anchorToTips` | 花的大小 / 花心在掌心还是指尖 |
| `openSpeed` / `closeSpeed` | 开合跟手程度 |
| `fingerRadius` / `fingerPush` | 指尖拨动范围与力度 |
| `maxHands` | 1 = 单花，更省性能 |
| `maxPixelRatio` | 卡顿时设为 1 |

## 常见问题

- **黑屏 / 一直“加载模型”**：打开控制台看网络请求，多半是模型或 CDN 访问不了，按上面方法放本地。
- **权限被拒**：点击地址栏左侧图标允许摄像头后刷新。
- **卡顿**：`maxPixelRatio: 1`、`maxHands: 1`、减少 `particlesPerPetal`；HUD 显示 `CPU` 说明 GPU 推理不可用。
- **识别不稳**：光线充足、手完整出现在画面中、掌心朝向镜头效果最好；按 `S` 可看实时张开度。
- **手机**：需 https 才能用摄像头（如 `vite --host` 配合 https 插件或内网穿透）。
