// Domain gate to ensure the script only runs on WhatsApp Web
const __WAP_ALLOWED_HOST__ = /^web\.whatsapp\.com$/;
if (!__WAP_ALLOWED_HOST__.test(location.hostname)) {
  try { chrome.runtime.sendMessage({ type: 'status', text: 'unsupported origin' }); } catch (_) {}
  throw new Error('WAP: unsupported origin');
}

let isAutomationRunning = false;
let chatsProcessedCount = 0;
let initialOffset = 0;
let lastSelectedChatIndex = -1;
let lastSelectedChatTitle = '';
const MAX_JUMP_STEP = 10;
let delaySpeedMultiplier = 1;
let extraOffsetCount = 0;
let modeAction = 'enable';

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(milliseconds * delaySpeedMultiplier))));

const reportStatus = (message) => {
  try {
    console.log("[WAP]", message);
    chrome.runtime.sendMessage({ type: "status", text: message });
  } catch (error) {
    try { console.log("[WAP] status err", error?.message || error); } catch (_) {}
  }
};

const reportProgressOffset = () => {
  try {
    chrome.runtime.sendMessage({
      type: 'offset',
      processed: chatsProcessedCount,
      offset: initialOffset + extraOffsetCount
    });
  } catch (_) {}
};

const findAdvancedPrivacyLabel = () =>
  Array.from(document.querySelectorAll("div.x1fcty0u.x14ug900.x6prxxf.x1o2sk6j"))
    .find((element) => (element.textContent || '').trim() === "Advanced chat privacy");

const findAdvancedPrivacyContainer = () => {
  const labelElement = findAdvancedPrivacyLabel();
  if (!labelElement) return null;
  let node = labelElement;
  for (let i = 0; i < 10 && node; i++) {
    const inputs = node.querySelector ? Array.from(node.querySelectorAll('input[type="checkbox"][role="switch"]')) : [];
    const focusableInput = inputs.find(input => input.getAttribute('tabindex') !== '-1') || null;
    const roleSwitches = node.querySelector ? Array.from(node.querySelectorAll('[role="switch"]')) : [];
    const focusableRole = roleSwitches.find(role => role.getAttribute('tabindex') !== '-1') || roleSwitches[0] || null;
    if (focusableInput || focusableRole) {
      return {
        container: node,
        switchElement: focusableRole || focusableInput,
        inputElement: focusableInput || (focusableRole ? focusableRole.querySelector('input[type="checkbox"][role="switch"]') : null)
      };
    }
    node = node.parentElement;
  }
  return null;
};

const clickElementAtCenter = (element) => {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const target = document.elementFromPoint(centerX, centerY) || element;
  target.dispatchEvent(new MouseEvent('mousedown', { view: window, bubbles: true, clientX: centerX, clientY: centerY }));
  target.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, clientX: centerX, clientY: centerY }));
  target.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, clientX: centerX, clientY: centerY }));
};

const getClickableListItemElement = (listItemElement) =>
  listItemElement.querySelector('div[role="none"][tabindex]') ||
  listItemElement.querySelector('div[aria-selected]') ||
  listItemElement;

const listItemHasTurnedOnMessage = (listItemElement) => {
  const text = (listItemElement?.textContent || '');
  try { return text.includes('You turned on advanced chat privacy'); } catch (_) { return false; }
};
const listItemHasTurnedOffMessage = (listItemElement) => {
  const text = (listItemElement?.textContent || '');
  try { return text.includes('You turned off advanced chat privacy'); } catch (_) { return false; }
};

const waitUntilSelectedByTitle = async (title, timeoutMs = 3000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isAutomationRunning) return false;
    const items = getChatListItems();
    const selected = items.find((li) => li.querySelector('div[aria-selected="true"]'));
    if (selected && getChatTitleFromListItem(selected) === title) return true;
    await wait(120);
  }
  return false;
};

const isInAdvancedPrivacyView = () => !!document.querySelector('span[aria-hidden="true"][data-icon="back-refreshed"]');

const openContactProfilePanel = async () => {
  if (findAdvancedPrivacyLabel()) return;
  let headerNameElement = document.querySelector('header span._ao3e');
  if (!headerNameElement) {
    const nameSpans = Array.from(document.querySelectorAll('span._ao3e'));
    let smallestTop = Infinity;
    let pick = null;
    nameSpans.forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < smallestTop) { smallestTop = rect.top; pick = element; }
    });
    headerNameElement = pick;
  }
  if (headerNameElement) {
    reportStatus("click header/name");
    headerNameElement.scrollIntoView({ block: 'center' });
    await wait(250);
    headerNameElement.click();
    await wait(650);
  } else {
    reportStatus("no contact header found");
  }
};

const ensureAdvancedPrivacyOn = async () => {
  if (!isInAdvancedPrivacyView()) { reportStatus('not in advanced'); return false; }
  let target = document.querySelector('input[type="checkbox"][role="switch"][tabindex="0"]');
  let switchElement = target;
  let inputElement = target;
  if (!target) {
    const found = findAdvancedPrivacyContainer();
    if (!found) { reportStatus('advanced label not found'); return false; }
    target = found.container.querySelector('input[type="checkbox"][role="switch"][tabindex="0"]') || found.inputElement || found.switchElement;
    switchElement = found.switchElement || target;
    inputElement = found.inputElement || (target && target.matches('input') ? target : null);
  }
  const readToggleState = () => {
    const element = target || switchElement;
    return (element && element.getAttribute && element.getAttribute('aria-checked') === 'true') || (inputElement ? inputElement.checked === true : false);
  };
  const stateBefore = readToggleState();
  reportStatus('switch state before: ' + (stateBefore ? 'on' : 'off'));
  if (stateBefore) return { ok: true, changed: false };
  (target || switchElement).scrollIntoView({ block: 'center' });
  await wait(500);
  if (!isAutomationRunning) return false;
  reportStatus('try target.click');
  try { (target || switchElement).click(); } catch (_) {}
  await wait(900);
  if (!isAutomationRunning) return false;
  if (readToggleState()) { reportStatus('switch on via target.click'); await wait(1000); return { ok: true, changed: true } }
  reportStatus('try clickElementAtCenter(target)');
  try { clickElementAtCenter(target || switchElement); } catch (_) {}
  await wait(1000);
  if (!isAutomationRunning) return false;
  if (readToggleState()) { reportStatus('switch on via clickCenter'); await wait(1000); return { ok: true, changed: true } }
  reportStatus('toggle failed');
  return { ok: false, changed: false };
};

const ensureAdvancedPrivacyOff = async () => {
  if (!isInAdvancedPrivacyView()) { reportStatus('not in advanced'); return false; }
  let target = document.querySelector('input[type="checkbox"][role="switch"][tabindex="0"]');
  let switchElement = target;
  let inputElement = target;
  if (!target) {
    const found = findAdvancedPrivacyContainer();
    if (!found) { reportStatus('advanced label not found'); return false; }
    target = found.container.querySelector('input[type="checkbox"][role="switch"][tabindex="0"]') || found.inputElement || found.switchElement;
    switchElement = found.switchElement || target;
    inputElement = found.inputElement || (target && target.matches('input') ? target : null);
  }
  const readToggleState = () => {
    const element = target || switchElement;
    return (element && element.getAttribute && element.getAttribute('aria-checked') === 'true') || (inputElement ? inputElement.checked === true : false);
  };
  const stateBefore = readToggleState();
  reportStatus('switch state before: ' + (stateBefore ? 'on' : 'off'));
  if (!stateBefore) return { ok: true, changed: false };
  (target || switchElement).scrollIntoView({ block: 'center' });
  await wait(500);
  if (!isAutomationRunning) return false;
  reportStatus('try target.click');
  try { (target || switchElement).click(); } catch (_) {}
  await wait(900);
  if (!isAutomationRunning) return false;
  if (!readToggleState()) { reportStatus('switch off via target.click'); await wait(1000); return { ok: true, changed: true } }
  reportStatus('try clickElementAtCenter(target)');
  try { clickElementAtCenter(target || switchElement); } catch (_) {}
  await wait(1000);
  if (!isAutomationRunning) return false;
  if (!readToggleState()) { reportStatus('switch off via clickCenter'); await wait(1000); return { ok: true, changed: true } }
  reportStatus('toggle failed');
  return { ok: false, changed: false };
};

const closeAdvancedPrivacyView = async () => {
  const backButton = document.querySelector('span[aria-hidden="true"][data-icon="back-refreshed"]');
  if (backButton) {
    reportStatus('exit advanced');
    backButton.click();
    await wait(600);
  } else {
    reportStatus('no back icon');
  }
};

const closeContactProfilePanel = async () => {
  const closeButton = document.querySelector('span[aria-hidden="true"][data-icon="close-refreshed"]');
  if (closeButton) {
    reportStatus('close contact panel');
    closeButton.click();
    await wait(600);
  } else {
    reportStatus('no close icon');
  }
};

const getChatListItems = () => Array.from(document.querySelectorAll('[role="listitem"]'));

const getSelectedChatIndex = (listItems) => {
  const selectedItem = listItems.find((li) => li.querySelector('div[aria-selected="true"]'));
  return selectedItem ? listItems.indexOf(selectedItem) : -1;
};

const getChatTitleFromListItem = (listItem) => {
  const titleElement = listItem.querySelector('span[dir="auto"][title]') || listItem.querySelector('span._ao3e');
  return titleElement ? (titleElement.getAttribute('title') || titleElement.textContent || '').trim() : '';
};

const selectNextChat = async () => {
  const items = getChatListItems();
  if (items.length === 0) { reportStatus('no chat items'); return; }

  let currentIndexNow = items.findIndex((li) => getChatTitleFromListItem(li) === lastSelectedChatTitle);
  if (currentIndexNow === -1) currentIndexNow = getSelectedChatIndex(items);

  const listJumpedUp = (lastSelectedChatIndex >= 0 && currentIndexNow >= 0 && currentIndexNow < lastSelectedChatIndex);
  let baseIndex;

  if (listJumpedUp) {
    let remaining = (typeof initialOffset === 'number' && initialOffset > 0) ? initialOffset : 0;
    if (typeof extraOffsetCount === 'number' && extraOffsetCount > 0) remaining += extraOffsetCount;
    let base = lastSelectedChatIndex;
    while (remaining > 0) {
      if (!isAutomationRunning) return;
      const step = Math.min(remaining, MAX_JUMP_STEP);
      const itemsNow = getChatListItems();
      if (itemsNow.length === 0) { reportStatus('no chat items'); return; }
      let targetIdx = Math.min(base + step, itemsNow.length - 1);
      let guardScan = 0;
      while (targetIdx < itemsNow.length && listItemHasTurnedOnMessage(itemsNow[targetIdx]) && guardScan < 10) { targetIdx++; guardScan++; }
      targetIdx = Math.min(targetIdx, itemsNow.length - 1);
      const li = itemsNow[targetIdx];
      const title = getChatTitleFromListItem(li);
      reportStatus('jump chunk step ' + step + ' to index ' + targetIdx + ' title ' + title);
      li.scrollIntoView({ block: 'center' });
      await wait(400);
      if (!isAutomationRunning) return;
      const clickableNow = getClickableListItemElement(li);
      try { clickableNow.focus(); } catch (_) {}
      await wait(120);
      clickElementAtCenter(clickableNow);
      await wait(700);
      if (!isAutomationRunning) return;
      await waitUntilSelectedByTitle(title, 3000);
      base = targetIdxly;
      remaining -= step;
    }
    return;
  } else {
    baseIndex = Math.min((lastSelectedChatIndex >= 0 ? lastSelectedChatIndex + 1 : 1), items.length - 1);
  }

  let nextLi = items[baseIndex];
  let guardTurned = 0;
  while (((modeAction==='enable' && listItemHasTurnedOnMessage(nextLi)) || (modeAction==='disable' && listItemHasTurnedOffMessage(nextLi))) && guardTurned < 10) {
    reportStatus('skip already-'+(modeAction==='enable'?'on':'off')+' message at index ' + baseIndex);
    baseIndex = Math.min(baseIndex + 1, items.length - 1);
    nextLi = items[baseIndex];
    guardTurned++;
  }
  reportStatus('select next chat index ' + baseIndex + ' title ' + getChatTitleFromListItem(nextLi));
  nextLi.scrollIntoView({ block: 'center' });
  await wait(500);
  if (!isAutomationRunning) return;
  const clickable = getClickableListItemElement(nextLi);
  try { clickable.focus(); } catch (_) {}
  await wait(150);
  clickElementAtCenter(clickable);
  await wait(1000);
  if (!isAutomationRunning) return;
};

const moveToNextChat = async () => {
  await closeAdvancedPrivacyView();
  await closeContactProfilePanel();
  await selectNextChat();
};

const automationLoop = async () => {
  while (isAutomationRunning) {
    try {
      reportStatus('opening contact');
      const itemsBefore = getChatListItems();
      lastSelectedChatIndex = getSelectedChatIndex(itemsBefore);
      lastSelectedChatTitle = (lastSelectedChatIndex >= 0 && itemsBefore[lastSelectedChatIndex]) ? getChatTitleFromListItem(itemsBefore[lastSelectedChatIndex]) : '';

      await openContactProfilePanel();

      reportStatus('opening advanced');
      if (!isInAdvancedPrivacyView()) {
        const label = findAdvancedPrivacyLabel();
        if (label) {
          label.scrollIntoView({ block: 'center' });
          await wait(300);
          if (!isAutomationRunning) break;
          label.click();
          await wait(800);
        } else {
          reportStatus('advanced not found');
        }
      } else {
        reportStatus('already in advanced');
      }

      reportStatus('ensuring ' + (modeAction==='enable'?'on':'off'));
      const result = modeAction==='enable' ? await ensureAdvancedPrivacyOn() : await ensureAdvancedPrivacyOff();
      if (!result.ok) {
        reportStatus('giving up on this chat');
        chatsProcessedCount += 1;
        if (result.changed) extraOffsetCount += 1;
        await moveToNextChat();
        await wait(800);
        continue;
      }

      if (result.changed) extraOffsetCount += 1;
      reportStatus('next chat');
      chatsProcessedCount += 1;
      reportProgressOffset();
      await moveToNextChat();
      await wait(1000);
      if (!isAutomationRunning) break;
    } catch (error) {
      try { console.error('[WAP] error', error); } catch (_) {}
      reportStatus('error ' + (error?.message || error));
      await wait(1200);
    }
  }
  reportStatus('stopped');
};

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === 'start') {
    if (isAutomationRunning) return;
    isAutomationRunning = true;
    chatsProcessedCount = 0;
    initialOffset = (typeof message.offset === 'number' && message.offset >= 0) ? message.offset : 0;
    delaySpeedMultiplier = (typeof message.speed === 'number' && message.speed > 0) ? message.speed : 1;
    modeAction = (message.mode === 'disable') ? 'disable' : 'enable';
    reportStatus('started');
    automationLoop();
  } else if (message.type === 'stop') {
    isAutomationRunning = false;
  }
});
