#!/bin/bash
# 双击运行：启动本地服务并打开「指尖花开」
cd "$(dirname "$0")" || exit 1
PORT=5173
URL="http://localhost:$PORT"

echo ""
echo "  🌸 指尖花开 · Fingertip Bloom"
echo "  目录：$(pwd)"
echo ""

# 1) 尝试下载手部模型到本地（失败也没关系，页面会再尝试在线加载）
if [ ! -s models/hand_landmarker.task ]; then
  echo "  · 下载手部识别模型（约 7.5MB）…"
  mkdir -p models
  if curl -fL --connect-timeout 8 -m 120 -o models/hand_landmarker.task.part \
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"; then
    mv models/hand_landmarker.task.part models/hand_landmarker.task
    echo "  ✔ 模型已保存到 models/"
  else
    rm -f models/hand_landmarker.task.part
    echo "  ✘ 模型下载失败（可能需要代理），页面会尝试在线加载"
  fi
fi

# 2) 若 5173 已被占用，先结束旧进程
OLD=$(lsof -ti tcp:$PORT 2>/dev/null)
[ -n "$OLD" ] && kill $OLD 2>/dev/null && sleep 0.5

# 3) 启动服务器：优先 node，其次 python3
if command -v node >/dev/null 2>&1; then
  PORT=$PORT node server.mjs &
elif command -v python3 >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 &
else
  echo "  ✘ 没有找到 node 或 python3，请先安装 Node.js（https://nodejs.org）"
  read -n 1 -s -r -p "  按任意键退出"
  exit 1
fi
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

# 等服务就绪
for i in $(seq 1 40); do
  curl -s -o /dev/null "$URL/" && break
  sleep 0.25
done

# 4) 打开浏览器：优先 egolite，其次 Chrome，最后系统默认
if open -a "ego lite" "$URL" 2>/dev/null || open -b com.citrolabs.ego.lite "$URL" 2>/dev/null; then
  echo "  已在 ego lite 中打开 $URL"
elif open -a "Google Chrome" "$URL" 2>/dev/null; then
  echo "  已在 Chrome 中打开 $URL"
else
  open "$URL"
  echo "  已在默认浏览器中打开 $URL"
fi

echo ""
echo "  服务运行中。关闭这个窗口即可停止。"
echo ""
wait $SERVER
