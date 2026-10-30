// 界面：开场卡片、状态 HUD、操作坞、提示

const $ = (id) => document.getElementById(id);

export function createUI(handlers) {
  const intro = $('intro');
  const status = $('status');
  const error = $('error');
  const hud = $('hud');
  const dock = $('dock');
  const stateDot = $('state-dot');
  const stateLabel = $('state-label');
  const stateBar = $('state-bar');
  const meta = $('meta');
  const toastEl = $('toast');
  const paletteName = $('palette-name');
  const btnStart = $('btn-start');
  const btnMouse = $('btn-mouse');

  btnStart.addEventListener('click', handlers.onStart);
  btnMouse.addEventListener('click', handlers.onMouse);
  dock.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn) handlers.onAction(btn.dataset.action);
  });

  let toastTimer = 0;

  return {
    setStatus(text) {
      status.textContent = text || '';
    },
    setBusy(busy) {
      btnStart.disabled = busy;
      btnMouse.disabled = busy;
      if (busy) error.hidden = true;
    },
    showError(html) {
      error.innerHTML = html;
      error.hidden = false;
      status.textContent = '';
    },
    enterApp() {
      intro.classList.add('gone');
      hud.hidden = false;
      dock.hidden = false;
    },
    setToggle(action, on) {
      const btn = dock.querySelector(`[data-action="${action}"]`);
      if (btn) btn.classList.toggle('on', !!on);
    },
    setPaletteName(name) {
      paletteName.textContent = name;
    },
    toggleHidden() {
      document.body.classList.toggle('ui-hidden');
    },
    toast(text, ms = 2200) {
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
    },
    updateHud({ label, bloom, live, info }) {
      stateLabel.textContent = label;
      stateBar.style.width = `${Math.round(bloom * 100)}%`;
      stateDot.classList.toggle('live', live);
      meta.textContent = info;
    },
  };
}
