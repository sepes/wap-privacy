const select = (selector) => document.querySelector(selector);
const statusElement = select('#status');
const offsetSummaryElement = select('#offsetView');
const versionElement = select('#version');
const helpBtn = select('#helpBtn');
const helpModal = select('#helpModal');
const helpBackdrop = select('#helpBackdrop');
const helpClose = select('#helpClose');
const startBtn = select('#start');
const stopBtn = select('#stop');
const signalBtn = select('#signalBtn');
const modeToggleBtn = select('#modeToggle');

let isRunning = false;

const applyRunningUi = () => {
  if (!startBtn || !stopBtn) return;
  if (isRunning) {
    startBtn.classList.remove('btn-primary');
    startBtn.classList.add('btn-secondary');
    stopBtn.classList.remove('btn-secondary');
    stopBtn.classList.add('btn-danger');
  } else {
    startBtn.classList.remove('btn-secondary');
    startBtn.classList.add('btn-primary');
    stopBtn.classList.remove('btn-danger');
    stopBtn.classList.add('btn-secondary');
  }
};

const setStatusText = (text) => {
  statusElement.textContent = text;
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const startAutomation = async () => {
  const tab = await getActiveTab();
  if (!tab || !/^https:\/\/web\.whatsapp\.com\//.test(tab.url || '')) {
    setStatusText('Open https://web.whatsapp.com and try again.');
    isRunning = false;
    applyRunningUi();
    return;
  }
  const offset = parseInt(select('#offset')?.value || '0', 10) || 0;
  const speed = Math.max(0.1, parseFloat(select('#speed')?.value || '1') || 1);
  const mode = (modeToggleBtn?.dataset.mode === 'disable') ? 'disable' : 'enable';
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.storage.local.set({ wap_offset: offset, wap_speed: speed, wap_mode: mode });
  await chrome.tabs.sendMessage(tab.id, { type: 'start', offset, speed, mode });
  isRunning = true;
  applyRunningUi();
};

const stopAutomation = async () => {
  const tab = await getActiveTab();
  try { await chrome.tabs.sendMessage(tab.id, { type: 'stop' }); } catch (_) {}
  isRunning = false;
  applyRunningUi();
};

select('#start').addEventListener('click', startAutomation);
select('#stop').addEventListener('click', stopAutomation);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message) return;
  getActiveTab().then((tab) => {
    if (!(sender.tab && tab && sender.tab.id === tab.id)) return;
    if (message.type === 'status') setStatusText(message.text);
    if (message.type === 'status') {
      const text = (message.text || '').toLowerCase();
      if (text.includes('started')) { isRunning = true; applyRunningUi(); }
      if (text.includes('stopped')) { isRunning = false; applyRunningUi(); }
    }
    if (message.type === 'offset' && offsetSummaryElement) {
      offsetSummaryElement.textContent = `processed ${message.processed} / offset ${message.offset}`;
    }
  });
});

// Display extension version dynamically
try {
  const manifest = chrome.runtime.getManifest?.();
  if (manifest && versionElement) {
    versionElement.textContent = manifest.version || versionElement.textContent;
  }
} catch (_) {}

// Help modal open/close
const setHelpVisible = (visible) => {
  const v = !!visible;
  if (helpModal) helpModal.setAttribute('aria-hidden', String(!v));
  if (helpBackdrop) helpBackdrop.setAttribute('aria-hidden', String(!v));
};
helpBtn?.addEventListener('click', () => setHelpVisible(true));
helpClose?.addEventListener('click', () => setHelpVisible(false));
helpBackdrop?.addEventListener('click', () => setHelpVisible(false));

// Open Signal download page in new tab
signalBtn?.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: 'https://signal.org/download/' });
  } catch (_) {
    window.open('https://signal.org/download/', '_blank');
  }
});

// Keep status box within popup height
const resizeStatus = () => {
  try {
    const body = document.body;
    const headerHeight = document.querySelector('.header')?.offsetHeight || 0;
    const buttonsHeight = document.querySelector('.buttons')?.offsetHeight || 0;
    const rows = Array.from(document.querySelectorAll('.row'));
    const rowsHeight = rows.reduce((s, el) => s + (el.offsetHeight || 0), 0);
    const footerHeight = document.querySelector('.footer')?.offsetHeight || 0;
    const verticalMargins = 20; // approximate
    const available = body.clientHeight - (headerHeight + buttonsHeight + rowsHeight + footerHeight + verticalMargins);
    const min = 60;
    const max = Math.max(min, available);
    if (statusElement) {
      statusElement.style.maxHeight = `${max}px`;
    }
  } catch (_) {}
};
window.addEventListener('resize', resizeStatus);
window.addEventListener('load', resizeStatus);
setTimeout(resizeStatus, 0);

// Initialize default button states
applyRunningUi();

// Mode toggle behavior
modeToggleBtn?.addEventListener('click', () => {
  const current = modeToggleBtn.dataset.mode || 'enable';
  const next = current === 'enable' ? 'disable' : 'enable';
  modeToggleBtn.dataset.mode = next;
  modeToggleBtn.textContent = next === 'enable' ? 'Enable' : 'Disable';
});

// Initialize default mode
if (modeToggleBtn) {
  modeToggleBtn.dataset.mode = 'enable';
  modeToggleBtn.textContent = 'Enable';
}
