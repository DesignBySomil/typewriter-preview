import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createSceneSystem } from './scene.js';
import { buildMachineChassis } from './machine.js';
import { buildKeysSystem } from './keys.js';
import { buildTypebarsSystem } from './typebars.js';
import { buildCarriageSystem } from './carriage.js';
import { createPaperSystem } from './paper.js';
import { TypewriterAudio } from './audio.js';
import { createHudSystem } from './hud.js';
import { createInputSystem } from './input.js';
import { createControlsSystem } from './controls.js';
import { createExportSystem } from './export.js';

const container = document.getElementById('webgl-container');
const sound = new TypewriterAudio();

const sceneSys = createSceneSystem(container);
const { renderer, scene, camera, bgScene, bgCamera, basketLight } = sceneSys;

const chassis = buildMachineChassis(scene);
const keysSys = buildKeysSystem(chassis.machineRoot, chassis.materials);

const typebarsSys = buildTypebarsSystem(
  chassis.machineRoot,
  chassis.materials,
  keysSys.printableControllers
);

const carriageSys = buildCarriageSystem(
  chassis.machineRoot,
  chassis.materials,
  keysSys.clickableMeshes
);

const paperSys = createPaperSystem(carriageSys.carriageGroup);
const hudSys = createHudSystem(camera, carriageSys.carriageGroup);
const exportSys = createExportSystem(paperSys);

window.typewriter = {
  export: exportSys,
  sheetStatus: () => paperSys.getSheetStatus()
};

const userMargins = {
  leftCol: 0,
  rightCol: CONFIG.maxCols
};

function getActiveColumnBounds() {
  const isPortrait = (window.innerWidth / Math.max(1, window.innerHeight)) < 0.92;
  const defaultMin = isPortrait ? Math.floor((CONFIG.maxCols - CONFIG.portraitCols) * 0.5) : 0;
  const defaultMax = isPortrait ? defaultMin + CONFIG.portraitCols : CONFIG.maxCols;

  const minCol = Math.max(defaultMin, userMargins.leftCol);
  const maxCol = Math.min(defaultMax, userMargins.rightCol);
  return {
    minCol,
    maxCol,
    totalCols: Math.max(1, maxCol - minCol)
  };
}

const initialBounds = getActiveColumnBounds();
carriageSys.setMarginStopPositions(userMargins.leftCol, userMargins.rightCol);

const telemetry = {
  col: initialBounds.minCol,
  fractionalCol: initialBounds.minCol,
  pageLine: 0,
  fractionalLine: 0,
  totalLinesTyped: 0,
  strikes: 0,
  lastKeyLabel: '[NONE]',
  shiftDown: false,
  shiftLockedNext: false,
  paperReleased: false,
  marginLocked: false,
  ribbonColor: 'black',
  ribbonInk: 100.0,
  spoolAngle: 0.0,
  spoolDirection: 1,
  vibratorLiftY: 0,
  cameraShake: 0,
  cameraNudgeY: 0,
  lastStrikeTime: performance.now(),
  strikeIntervals: [175, 160, 185, 150, 170, 155, 145, 165, 150, 160],
  introDismissed: false
};

let lastPlatenTickLine = 0;

carriageSys.advanceToCol(telemetry.col, 0);

function dismissIntroPrompt() {
  if (telemetry.introDismissed) return;
  telemetry.introDismissed = true;
  const el = document.getElementById('intro-prompt');
  if (el) el.classList.add('hidden');
}

function updateShiftBasketVisuals() {
  const active = telemetry.shiftDown || telemetry.shiftLockedNext;
  typebarsSys.setBasketShift(active);
  const sl = keysSys.keyMap.get('ShiftLeft');
  const sr = keysSys.keyMap.get('ShiftRight');
  if (sl) sl.targetPress = active ? 0.24 : 0;
  if (sr) sr.targetPress = active ? 0.24 : 0;
}

function handlePrintableKey(ctrl, explicitChar = null) {
  sound.init();
  dismissIntroPrompt();

  const bounds = getActiveColumnBounds();
  if (telemetry.col < bounds.minCol) telemetry.col = bounds.minCol;

  keysSys.depressKey(ctrl, 0.34);
  sound.playKeyClack(0.95 + Math.random() * 0.1);

  const isUpper = telemetry.shiftDown || telemetry.shiftLockedNext;
  const charToPrint = explicitChar
    ? (telemetry.shiftLockedNext ? explicitChar.toUpperCase() : explicitChar)
    : (isUpper ? ctrl.upper : ctrl.lower);

  if (telemetry.shiftLockedNext) {
    telemetry.shiftLockedNext = false;
    updateShiftBasketVisuals();
  }

  telemetry.lastKeyLabel = `'${charToPrint}'`;

  if (telemetry.col >= bounds.maxCol) {
    telemetry.marginLocked = true;
    typebarsSys.triggerBarSwing(ctrl, true, null, telemetry.ribbonColor);
    sound.playCarriageAdvanceClick(0.01);
    hudSys.triggerBellFlash();
    return;
  }

  const now = performance.now();
  const dtMs = Math.min(500, Math.max(25, now - telemetry.lastStrikeTime));
  telemetry.lastStrikeTime = now;
  telemetry.strikeIntervals.push(dtMs);
  if (telemetry.strikeIntervals.length > 18) telemetry.strikeIntervals.shift();

  const targetCol = telemetry.col;
  const targetLineId = telemetry.totalLinesTyped;
  const targetRibbon = telemetry.ribbonColor;

  if (paperSys.isSheetPresent()) {
    paperSys.stampCharacter(charToPrint, targetCol, 0, targetRibbon, targetLineId);
  }

  telemetry.strikes++;
  telemetry.ribbonInk = Math.max(10.0, 100.0 - telemetry.strikes * 0.035);
  if (telemetry.strikes % 46 === 0) telemetry.spoolDirection *= -1;
  telemetry.spoolAngle += 0.095 * telemetry.spoolDirection;
  chassis.spoolGroupLeft.rotation.y = telemetry.spoolAngle;
  chassis.spoolGroupRight.rotation.y = telemetry.spoolAngle;

  telemetry.col = Math.min(bounds.maxCol, telemetry.col + 1);
  telemetry.fractionalCol = telemetry.col;
  carriageSys.advanceToCol(telemetry.col, -0.42);

  if (telemetry.col === bounds.maxCol - CONFIG.bellOffset) {
    sound.playMarginBell();
    hudSys.triggerBellFlash();
  }
  if (telemetry.col >= bounds.maxCol) {
    telemetry.marginLocked = true;
  }

  typebarsSys.triggerBarSwing(ctrl, false, () => {
    carriageSys.triggerPlatenRecoil();
    if (targetRibbon !== 'stencil') {
      typebarsSys.triggerInkDustPuff(targetRibbon);
    }
    telemetry.vibratorLiftY = targetRibbon === 'red' ? 0.22 : (targetRibbon === 'stencil' ? 0.0 : 0.13);
    telemetry.cameraShake = 0.012;
    telemetry.cameraNudgeY = -0.020;
    sound.playStrikeImpact();
  }, targetRibbon);
}

function handleSpace() {
  sound.init();
  dismissIntroPrompt();

  const bounds = getActiveColumnBounds();
  const sc = keysSys.keyMap.get('Space');
  keysSys.depressKey(sc, 0.26);
  telemetry.lastKeyLabel = 'SPACE';
  sound.playKeyClack(0.82);

  if (telemetry.col >= bounds.maxCol) {
    telemetry.marginLocked = true;
    hudSys.triggerBellFlash();
    return;
  }

  telemetry.col++;
  telemetry.fractionalCol = telemetry.col;
  carriageSys.advanceToCol(telemetry.col, -0.34);
  sound.playCarriageAdvanceClick(0.02);

  if (telemetry.col === bounds.maxCol - CONFIG.bellOffset) {
    sound.playMarginBell();
    hudSys.triggerBellFlash();
  }
  if (telemetry.col >= bounds.maxCol) {
    telemetry.marginLocked = true;
  }
}

function handleBackspace() {
  sound.init();
  dismissIntroPrompt();

  const bounds = getActiveColumnBounds();
  const bc = keysSys.keyMap.get('Backspace');
  keysSys.depressKey(bc, 0.28);
  telemetry.lastKeyLabel = 'BACK';
  sound.playKeyClack(1.08);

  if (telemetry.col > bounds.minCol) {
    telemetry.col--;
    telemetry.fractionalCol = telemetry.col;
    telemetry.marginLocked = false;
    carriageSys.advanceToCol(telemetry.col, 0.34);
    sound.playCarriageAdvanceClick(0.02);
  }
}

function handleCarriageReturn() {
  sound.init();
  dismissIntroPrompt();

  const bounds = getActiveColumnBounds();
  const ec = keysSys.keyMap.get('Enter');
  keysSys.depressKey(ec, 0.28);
  telemetry.lastKeyLabel = 'CR / LF';

  const distanceRatio = Math.max(0.2, (telemetry.col - bounds.minCol) / bounds.totalCols);
  sound.playCarriageReturn(distanceRatio);

  telemetry.col = bounds.minCol;
  telemetry.fractionalCol = bounds.minCol;
  telemetry.marginLocked = false;
  telemetry.totalLinesTyped++;

  carriageSys.triggerCarriageReturnMotion(bounds.minCol);

  if (!paperSys.isSheetPresent()) {
    paperSys.triggerNewSheetInsert();
    telemetry.pageLine = 0;
    telemetry.fractionalLine = 0;
    lastPlatenTickLine = 0;
    return;
  }

  telemetry.pageLine++;
  if (telemetry.pageLine >= CONFIG.maxLinesPerPage) {
    telemetry.pageLine = 0;
    telemetry.fractionalLine = 0;
    lastPlatenTickLine = 0;
    paperSys.triggerNewSheetInsert();
  } else {
    paperSys.rollCanvasTextUpOneLine();
    paperSys.triggerLineFeedWave();
    telemetry.fractionalLine = telemetry.pageLine;
    lastPlatenTickLine = telemetry.pageLine;
  }
}

function handleShiftChange(mode) {
  if (mode === 'toggle') {
    handleShiftToggleLock();
    return;
  }
  const nextState = Boolean(mode);
  if (telemetry.shiftDown === nextState) return;
  telemetry.shiftDown = nextState;
  updateShiftBasketVisuals();

  if (nextState) {
    sound.init();
    sound.playKeyClack(0.76);
  }
}

function handleShiftToggleLock() {
  sound.init();
  dismissIntroPrompt();
  telemetry.shiftLockedNext = !telemetry.shiftLockedNext;
  telemetry.lastKeyLabel = telemetry.shiftLockedNext ? 'SHIFT LOCK' : 'SHIFT UNLK';
  sound.playKeyClack(0.78);
  updateShiftBasketVisuals();
}

function handleCycleRibbonMode() {
  sound.init();
  dismissIntroPrompt();
  const tc = keysSys.keyMap.get('Tab');
  keysSys.depressKey(tc, 0.24);
  sound.playKeyClack(1.12);

  const order = ['black', 'red', 'stencil'];
  const nextIdx = (order.indexOf(telemetry.ribbonColor) + 1) % order.length;
  telemetry.ribbonColor = order[nextIdx];

  chassis.setRibbonModeVisual(telemetry.ribbonColor);

  const labelMap = { black: 'RIB: BLK', red: 'RIB: RED', stencil: 'RIB: STN' };
  const btnMap = { black: 'RIBBON: BLK', red: 'RIBBON: RED', stencil: 'RIBBON: STN' };
  telemetry.lastKeyLabel = labelMap[telemetry.ribbonColor];

  const btnRibbon = document.getElementById('btn-ribbon');
  if (btnRibbon) {
    btnRibbon.textContent = btnMap[telemetry.ribbonColor];
    btnRibbon.classList.toggle('warn', telemetry.ribbonColor === 'red');
    btnRibbon.classList.toggle('active', telemetry.ribbonColor === 'stencil');
  }
}

function handlePlatenLineFeed(deltaLines, snapToLine = false) {
  sound.init();
  dismissIntroPrompt();
  carriageSys.rotatePlatenByLines(deltaLines, !snapToLine);

  if (paperSys.isSheetPresent()) {
    const newLine = paperSys.scrollByLines(deltaLines, snapToLine);
    telemetry.fractionalLine = newLine;
    const rounded = Math.round(newLine);
    if (rounded !== lastPlatenTickLine) {
      lastPlatenTickLine = rounded;
      if (!telemetry.paperReleased || snapToLine) {
        sound.playCarriageAdvanceClick(0.0);
      }
    }
    telemetry.pageLine = Math.max(0, Math.min(CONFIG.maxLinesPerPage - 1, rounded));
  } else {
    telemetry.fractionalLine = THREE.MathUtils.clamp(
      telemetry.fractionalLine + deltaLines,
      0,
      CONFIG.maxLinesPerPage - 1
    );
    telemetry.pageLine = Math.round(telemetry.fractionalLine);
    if (snapToLine) {
      sound.playCarriageAdvanceClick(0.0);
    }
  }
  telemetry.lastKeyLabel = deltaLines >= 0 ? 'ROLL UP' : 'ROLL DN';
}

function handlePlatenSnapLine() {
  if (paperSys.isSheetPresent()) {
    const snappedLine = paperSys.snapToNearestLine();
    telemetry.pageLine = Math.max(0, Math.min(CONFIG.maxLinesPerPage - 1, snappedLine));
    telemetry.fractionalLine = telemetry.pageLine;
  } else {
    telemetry.pageLine = Math.round(telemetry.fractionalLine);
    telemetry.fractionalLine = telemetry.pageLine;
  }
  lastPlatenTickLine = telemetry.pageLine;
  sound.playCarriageAdvanceClick(0.0);
}

function handleCarriageSlideContinuous(pixelDx) {
  sound.init();
  dismissIntroPrompt();
  const bounds = getActiveColumnBounds();
  const colDelta = -pixelDx / 14.0;
  telemetry.fractionalCol = THREE.MathUtils.clamp(
    telemetry.fractionalCol + colDelta,
    bounds.minCol,
    bounds.maxCol
  );
  const newRoundedCol = Math.round(telemetry.fractionalCol);

  if (newRoundedCol !== telemetry.col) {
    telemetry.col = newRoundedCol;
    sound.playCarriageAdvanceClick(0.0);
    if (telemetry.col === bounds.maxCol - CONFIG.bellOffset) {
      sound.playMarginBell();
      hudSys.triggerBellFlash();
    }
  }

  telemetry.marginLocked = telemetry.col >= bounds.maxCol;
  carriageSys.setCarriageColContinuous(telemetry.fractionalCol);
  telemetry.lastKeyLabel = `COL ${telemetry.col + 1}`;
}

function handleCarriageSlideSnap() {
  const bounds = getActiveColumnBounds();
  telemetry.col = THREE.MathUtils.clamp(Math.round(telemetry.fractionalCol), bounds.minCol, bounds.maxCol);
  telemetry.fractionalCol = telemetry.col;
  telemetry.marginLocked = telemetry.col >= bounds.maxCol;
  carriageSys.advanceToCol(telemetry.col, 0);
  sound.playCarriageAdvanceClick(0.0);
}

function handleUpdateMargins(side, targetCol) {
  sound.init();
  if (side === 'left') {
    userMargins.leftCol = THREE.MathUtils.clamp(targetCol, 0, userMargins.rightCol - 10);
  } else {
    userMargins.rightCol = THREE.MathUtils.clamp(targetCol, userMargins.leftCol + 10, CONFIG.maxCols);
  }
  carriageSys.setMarginStopPositions(userMargins.leftCol, userMargins.rightCol);

  const bounds = getActiveColumnBounds();
  if (telemetry.col < bounds.minCol) {
    telemetry.col = bounds.minCol;
    telemetry.fractionalCol = bounds.minCol;
    carriageSys.advanceToCol(telemetry.col, 0.15);
  } else if (telemetry.col > bounds.maxCol) {
    telemetry.col = bounds.maxCol;
    telemetry.fractionalCol = bounds.maxCol;
    telemetry.marginLocked = true;
    carriageSys.advanceToCol(telemetry.col, -0.15);
  } else {
    telemetry.marginLocked = false;
  }
  telemetry.lastKeyLabel = `MRG ${userMargins.leftCol + 1}-${userMargins.rightCol}`;
}

function handleTogglePaperRelease() {
  sound.init();
  dismissIntroPrompt();
  telemetry.paperReleased = !telemetry.paperReleased;
  carriageSys.setPaperReleased(telemetry.paperReleased);
  sound.playKeyClack(1.18);
  telemetry.lastKeyLabel = telemetry.paperReleased ? 'PAPER FREE' : 'PAPER LOCK';
}

function handleRemoveOrInsertPaper(mode = 'toggle') {
  sound.init();
  dismissIntroPrompt();
  const bounds = getActiveColumnBounds();

  if (mode === 'insert' || (mode === 'toggle' && !paperSys.isSheetPresent())) {
    sound.playCarriageReturn(0.5);
    telemetry.col = bounds.minCol;
    telemetry.fractionalCol = bounds.minCol;
    telemetry.pageLine = 0;
    telemetry.fractionalLine = 0;
    lastPlatenTickLine = 0;
    telemetry.marginLocked = false;
    carriageSys.triggerCarriageReturnMotion(bounds.minCol);
    paperSys.triggerNewSheetInsert();
    telemetry.lastKeyLabel = 'SHEET IN';
  } else if (mode === 'eject' || mode === 'toggle') {
    if (paperSys.triggerPaperEject()) {
      sound.playCarriageReturn(0.35);
      telemetry.lastKeyLabel = 'SHEET OUT';
    }
  }
}

function handleToggleHudVisibility() {
  document.body.classList.toggle('hud-hidden');
}

const printSavePanel = document.getElementById('print-save-panel');
function isExportPanelOpen() {
  return printSavePanel && !printSavePanel.classList.contains('hidden');
}
function closeExportPanel() {
  if (printSavePanel) printSavePanel.classList.add('hidden');
}
function toggleExportPanel() {
  if (!printSavePanel) return;
  if (printSavePanel.classList.contains('hidden')) {
    exportSys.renderPreview(document.getElementById('export-preview'));
    const t = document.getElementById('export-title');
    if (t) t.textContent = paperSys.isExportingArchived() ? 'THE CURRENT SHEET IS BLANK. SHOWING YOUR LAST REMOVED SHEET.' : 'EXPORT TYPED SHEET';
  }
  printSavePanel.classList.toggle('hidden');
}

const exportBackdrop = document.getElementById('export-backdrop');
if (printSavePanel && exportBackdrop) {
  new MutationObserver(() => {
    exportBackdrop.classList.toggle('hidden', printSavePanel.classList.contains('hidden'));
  }).observe(printSavePanel, { attributes: true, attributeFilter: ['class'] });
  exportBackdrop.addEventListener('click', closeExportPanel);
}

document.getElementById('btn-print-save')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleExportPanel();
});
document.getElementById('btn-print-save-m')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleExportPanel();
});
document.getElementById('btn-export-close')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeExportPanel();
});
document.getElementById('btn-export-png')?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportSys.downloadPNG();
  closeExportPanel();
});
document.getElementById('btn-export-pdf')?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportSys.downloadPDF();
  closeExportPanel();
});
document.getElementById('btn-export-print')?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportSys.printPage();
  closeExportPanel();
});

const inputSys = createInputSystem({
  rendererDom: renderer.domElement,
  keyMap: keysSys.keyMap,
  charToKeyMap: keysSys.charToKeyMap,
  onPrintableKey: handlePrintableKey,
  onSpace: handleSpace,
  onBackspace: handleBackspace,
  onCarriageReturn: handleCarriageReturn,
  onShiftChange: handleShiftChange,
  onToggleRibbonColor: handleCycleRibbonMode,
  onToggleHudVisibility: handleToggleHudVisibility,
  onPrintShortcut: () => exportSys.printPage(),
  isExportPanelOpen,
  onCloseExportPanel: closeExportPanel
});

// ---- AUTO: types a short note on a fresh sheet; click again to stop ----
const AUTO_TEXT = 'Hello.\n\nI am a typewriter.\nPress a key. I will put it on paper.';
const autoBtn = document.getElementById('btn-auto');
let autoToken = 0;
let autoRunning = false;

function setAutoUi(running) {
  autoRunning = running;
  if (!autoBtn) return;
  autoBtn.textContent = running ? 'STOP' : 'AUTO';
  autoBtn.classList.toggle('active', running);
}

function stopAuto() {
  autoToken++;
  setAutoUi(false);
}

function startAuto() {
  const token = ++autoToken;
  setAutoUi(true);
  const alive = () => token === autoToken;
  let i = 0;

  const typeNext = () => {
    if (!alive()) return;
    if (i >= AUTO_TEXT.length) { setAutoUi(false); return; }
    const ch = AUTO_TEXT[i++];
    let delay = 95 + Math.random() * 70;
    if (ch === ' ') {
      handleSpace();
    } else if (ch === '\n') {
      handleCarriageReturn();
      delay = 380;
    } else {
      const ctrl = keysSys.charToKeyMap.get(ch) || keysSys.charToKeyMap.get(ch.toLowerCase());
      if (ctrl) handlePrintableKey(ctrl, ch);
      if (ch === '.') delay = 260;
    }
    setTimeout(typeNext, delay);
  };

  const begin = () => {
    if (!alive()) return;
    typeNext();
  };

  // Always start on a fresh blank sheet so the note lands at the top of the page.
  if (paperSys.isSheetPresent()) {
    handleRemoveOrInsertPaper('eject');
    setTimeout(() => {
      if (!alive()) return;
      handleRemoveOrInsertPaper('insert');
      setTimeout(begin, 700);
    }, 600);
  } else {
    handleRemoveOrInsertPaper('insert');
    setTimeout(begin, 700);
  }
}

autoBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (autoRunning) stopAuto(); else startAuto();
});
// Manual typing or New Sheet interrupts Auto.
window.addEventListener('keydown', (e) => {
  if (autoRunning && e.key !== 'Shift') stopAuto();
}, true);
document.getElementById('btn-sheet')?.addEventListener('click', () => { if (autoRunning) stopAuto(); }, true);
document.getElementById('btn-sheet-m')?.addEventListener('click', () => { if (autoRunning) stopAuto(); }, true);
window.typewriter.autoRunning = () => autoRunning;

createControlsSystem({
  rendererDom: renderer.domElement,
  camera,
  chassis,
  keysSys,
  carriageSys,
  paperSys,
  onPrintableKey: handlePrintableKey,
  onSpace: handleSpace,
  onBackspace: handleBackspace,
  onCarriageReturn: handleCarriageReturn,
  onShiftToggleLock: handleShiftToggleLock,
  onCycleRibbonMode: handleCycleRibbonMode,
  onPlatenLineFeed: handlePlatenLineFeed,
  onPlatenSnapLine: handlePlatenSnapLine,
  onCarriageSlideContinuous: handleCarriageSlideContinuous,
  onCarriageSlideSnap: handleCarriageSlideSnap,
  onUpdateMargins: handleUpdateMargins,
  onTogglePaperRelease: handleTogglePaperRelease,
  onRemoveOrInsertPaper: handleRemoveOrInsertPaper,
  onTouchCanvasFocus: () => inputSys.focusMobileKeyboard()
});

document.getElementById('btn-return')?.addEventListener('click', () => handleCarriageReturn());
document.getElementById('btn-ribbon')?.addEventListener('click', () => handleCycleRibbonMode());
let newSheetPending = false;
function handleNewSheetButton() {
  if (newSheetPending) return;
  if (paperSys.isSheetPresent()) {
    handleRemoveOrInsertPaper('eject');
    newSheetPending = true;
    setTimeout(() => {
      newSheetPending = false;
      handleRemoveOrInsertPaper('insert');
    }, 600);
  } else {
    handleRemoveOrInsertPaper('insert');
  }
}
document.getElementById('btn-sheet')?.addEventListener('click', handleNewSheetButton);
document.getElementById('btn-sheet-m')?.addEventListener('click', handleNewSheetButton);

const btnMute = document.getElementById('btn-mute');
const btnMuteM = document.getElementById('btn-mute-m');
function syncMuteUi(isMuted) {
  if (btnMute) {
    btnMute.textContent = isMuted ? 'AUDIO: MUTED' : 'AUDIO: ON';
    btnMute.classList.toggle('active', !isMuted);
    btnMute.classList.toggle('warn', isMuted);
  }
  if (btnMuteM) {
    btnMuteM.classList.toggle('muted', isMuted);
    btnMuteM.setAttribute('aria-label', isMuted ? 'Sound off' : 'Sound on');
  }
}
function onMuteClick() {
  sound.init();
  syncMuteUi(sound.toggleMute());
}
btnMute?.addEventListener('click', onMuteClick);
btnMuteM?.addEventListener('click', onMuteClick);

// Unlock audio on the first real gesture (phones block audio until then).
const unlockAudio = () => sound.init();
['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => {
  window.addEventListener(ev, unlockAudio, { passive: true });
});

window.addEventListener('resize', () => {
  sceneSys.handleResize();
  hudSys.layoutHud();
  const b = getActiveColumnBounds();
  if (telemetry.col < b.minCol) {
    telemetry.col = b.minCol;
    telemetry.fractionalCol = b.minCol;
    carriageSys.advanceToCol(telemetry.col, 0);
  } else if (telemetry.col > b.maxCol) {
    telemetry.col = b.maxCol;
    telemetry.fractionalCol = b.maxCol;
    carriageSys.advanceToCol(telemetry.col, 0);
  }
});

const clock = new THREE.Clock();
let elapsedTotal = 0;
const smoothPointer = new THREE.Vector2(0, 0);
const currentLookAt = new THREE.Vector3();
const camOffsetVec = new THREE.Vector3();
const spherical = new THREE.Spherical();

function animate() {
  requestAnimationFrame(animate);

  inputSys.processQueue();

  const dt = Math.min(0.05, clock.getDelta());
  elapsedTotal += dt;

  sceneSys.bgUniforms.uTime.value = elapsedTotal;

  basketLight.intensity = 0.38 + Math.sin(elapsedTotal * 1.6) * 0.03;

  keysSys.updateKeys(dt);
  typebarsSys.updateTypebars(dt);
  carriageSys.updateCarriage(dt);
  chassis.updateMachineLevers(dt);
  paperSys.updatePaper(dt, elapsedTotal);

  telemetry.vibratorLiftY *= Math.exp(-dt * 24.0);
  chassis.vibratorGroup.position.y = 2.66 + telemetry.vibratorLiftY;

  const introProgress = Math.min(1.0, elapsedTotal / 2.0);
  const introEase = 1.0 - Math.pow(1.0 - introProgress, 3.0);

  smoothPointer.x += (inputSys.pointerNDC.x - smoothPointer.x) * Math.min(1.0, dt * 5.0);
  smoothPointer.y += (inputSys.pointerNDC.y - smoothPointer.y) * Math.min(1.0, dt * 5.0);

  const basePose = sceneSys.computeFittedCameraPose();
  const introPush = (1.0 - introEase) * 1.4;

  camOffsetVec.copy(basePose.pos).sub(basePose.lookAt);
  spherical.setFromVector3(camOffsetVec);

  const maxParallaxRad = THREE.MathUtils.degToRad(3.0);
  const idleDriftAzimuth = Math.sin(elapsedTotal * 0.45) * 0.005;
  const idleDriftPolar   = Math.cos(elapsedTotal * 0.35) * 0.004;

  spherical.theta += smoothPointer.x * maxParallaxRad + idleDriftAzimuth;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi - smoothPointer.y * maxParallaxRad * 0.75 + idleDriftPolar,
    0.25,
    Math.PI * 0.46
  );
  spherical.radius += introPush;

  camOffsetVec.setFromSpherical(spherical);

  telemetry.cameraShake *= Math.exp(-dt * 30.0);
  telemetry.cameraNudgeY *= Math.exp(-dt * 22.0);
  const shakeX = (Math.random() - 0.5) * telemetry.cameraShake;
  const shakeY = (Math.random() - 0.5) * telemetry.cameraShake + telemetry.cameraNudgeY;

  camera.position.copy(basePose.lookAt).add(camOffsetVec);
  camera.position.x += shakeX;
  camera.position.y += shakeY;

  currentLookAt.copy(basePose.lookAt);
  currentLookAt.x += smoothPointer.x * 0.10;
  currentLookAt.y += smoothPointer.y * 0.06 + shakeY * 0.65;
  camera.lookAt(currentLookAt);

  hudSys.updateHud(telemetry, getActiveColumnBounds());

  renderer.clear();
  renderer.render(bgScene, bgCamera);
  renderer.clearDepth();
  renderer.render(scene, camera);
}

animate();
