// 把 MediaPipe 手部模型下载到 models/，之后页面会优先读取本地模型。
// 用法：npm run fetch-model

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'models', 'hand_landmarker.task');

try {
  console.log('下载中：', URL_);
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log(`✔ 已保存到 models/hand_landmarker.task（${(buf.length / 1024 / 1024).toFixed(1)} MB）`);
} catch (err) {
  console.error('✘ 下载失败：', err.message);
  console.error('  storage.googleapis.com 在部分网络下无法访问。');
  console.error('  请用能访问的网络/代理手动下载上面的链接，放到 models/hand_landmarker.task 即可。');
  process.exitCode = 1;
}
