import * as THREE from 'three';
import { CONFIG } from './config.js';
import { PAPER_VERTEX_SHADER, PAPER_FRAGMENT_SHADER } from './shaders/paper.js';

const LINE0_Y = CONFIG.LINE0_Y || 250;
const MAX_LINE = CONFIG.MAX_LINE || 24;
// Total physical sheet arc-length (11.5 world units) so at Line 0 the top edge stands 2.95 units
// above the platen (sTop = 4.10) AND at Line 24 (raised by 24 * 0.26 = 6.24 units, sTop = 10.34)
// the bottom edge (sBot = 10.34 - 11.50 = -1.16) STILL stays tucked behind/below the platen with zero gap!
const TOTAL_SHEET_LEN = 11.50;
const LINE_STEP_WORLD = 0.26;

export function createPaperSystem(carriageGroup) {
  const paperCanvas = document.createElement('canvas');
  paperCanvas.width = CONFIG.paperCanvasW;
  paperCanvas.height = CONFIG.paperCanvasH;
  const paperCtx = paperCanvas.getContext('2d');

  // Snapshot canvas preserves the last completed/removed sheet so PRINT / SAVE still works after ejecting a sheet
  const lastArchivedCanvas = document.createElement('canvas');
  lastArchivedCanvas.width = CONFIG.paperCanvasW;
  lastArchivedCanvas.height = CONFIG.paperCanvasH;
  const lastArchivedCtx = lastArchivedCanvas.getContext('2d');
  let hasArchivedSheet = false;
  let currentSheetHasInk = false;

  const strikeGrid = new Map();

  let currentCanvasLine = 0.0;
  let scrollVCurrent = 0.0;
  let scrollVTarget = 0.0;
  let scrollVVel = 0.0;

  // Sheet presence state: 'seated' | 'inserting' | 'pulling' | 'settling' | 'ejecting' | 'removed'
  let sheetStatus = 'inserting';
  let insertAnimProgress = 0.0;

  function archiveCurrentCanvasIfInked() {
    if (currentSheetHasInk) {
      lastArchivedCtx.clearRect(0, 0, lastArchivedCanvas.width, lastArchivedCanvas.height);
      lastArchivedCtx.drawImage(paperCanvas, 0, 0);
      hasArchivedSheet = true;
    }
  }

  function clearPaperCanvas() {
    archiveCurrentCanvasIfInked();
    paperCtx.fillStyle = '#000000';
    paperCtx.fillRect(0, 0, paperCanvas.width, paperCanvas.height);
    strikeGrid.clear();
    currentCanvasLine = 0.0;
    scrollVCurrent = 0.0;
    scrollVTarget = 0.0;
    scrollVVel = 0.0;
    currentSheetHasInk = false;
  }
  clearPaperCanvas();

  const paperTexture = new THREE.CanvasTexture(paperCanvas);
  paperTexture.flipY = true;
  paperTexture.minFilter = THREE.LinearFilter;
  paperTexture.magFilter = THREE.LinearFilter;
  paperTexture.anisotropy = 4;

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      paperTexture.needsUpdate = true;
    });
  }

  /**
   * Stamps a typewriter glyph onto the 2048x2048 CanvasTexture:
   * Line 0 is drawn near the top of the texture (LINE0_Y = 250px) and subsequent lines
   * advance DOWNWARD (+paperLinePxY per line) so the page reads top-to-bottom in typing order,
   * while the vertex shader slides the physical sheet up by `LINE_STEP_WORLD` per line so
   * `currentCanvasLine` is always positioned right at the platen strike point (s = 1.02)!
   */
  function stampCharacter(char, col, _unusedOffset = 0, ribbonColor = 'black', absoluteLineId = 0) {
    if (sheetStatus === 'removed' || sheetStatus === 'ejecting') return;

    const lineKey = Math.round(currentCanvasLine);
    const key = `${absoluteLineId}:${lineKey}:${col}`;
    const prevStrikes = strikeGrid.get(key) || 0;
    strikeGrid.set(key, prevStrikes + 1);

    const isPortrait = (window.innerWidth / Math.max(1, window.innerHeight)) < 0.92;
    let centerX = CONFIG.paperCol0PxX + col * CONFIG.paperCharPxX;
    let fontSizePx = 66;

    if (isPortrait) {
      const relCol = Math.max(0, col - 5);
      const portraitStepPx = (CONFIG.paperCanvasW - 220) / CONFIG.portraitCols;
      centerX = 110 + relCol * portraitStepPx;
      fontSizePx = 76;
    }

    const baselineY = LINE0_Y + currentCanvasLine * CONFIG.paperLinePxY;

    const jitterX = (Math.random() - 0.5) * 2.0;
    const jitterY = (Math.random() - 0.5) * 2.8;
    const rotJitter = (Math.random() - 0.5) * 0.032;
    const baseDensity = Math.min(255, Math.floor(228 + Math.random() * 27 + prevStrikes * 35));

    const rVal = ribbonColor === 'black' ? baseDensity : 0;
    const gVal = ribbonColor === 'red'   ? baseDensity : 0;
    const bVal = baseDensity;

    paperCtx.save();
    paperCtx.globalCompositeOperation = 'lighter';
    paperCtx.translate(centerX + jitterX, baselineY + jitterY);
    paperCtx.rotate(rotJitter);

    paperCtx.font = `bold ${fontSizePx}px "Courier Prime", "Special Elite", "Courier New", Courier, monospace`;
    paperCtx.textAlign = 'center';
    paperCtx.textBaseline = 'alphabetic';

    paperCtx.shadowColor = `rgb(${Math.floor(rVal * 0.65)}, ${Math.floor(gVal * 0.65)}, ${Math.floor(bVal * 0.72)})`;
    paperCtx.shadowBlur = 4.5;
    paperCtx.fillStyle = `rgb(${Math.floor(rVal * 0.85)}, ${Math.floor(gVal * 0.85)}, ${Math.floor(bVal * 0.85)})`;
    paperCtx.fillText(char, 0, 0);

    paperCtx.shadowBlur = 0;
    paperCtx.fillStyle = `rgb(${rVal}, ${gVal}, ${bVal})`;
    paperCtx.fillText(char, 0, 0);
    paperCtx.lineWidth = 1.8;
    paperCtx.strokeStyle = `rgb(${rVal}, ${gVal}, ${bVal})`;
    paperCtx.strokeText(char, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7);

    if (ribbonColor !== 'stencil') {
      const speckCount = 3 + Math.floor(Math.random() * 4);
      for (let s = 0; s < speckCount; s++) {
        const sx = (Math.random() - 0.5) * (fontSizePx * 0.78);
        const sy = -fontSizePx * 0.35 + (Math.random() - 0.5) * (fontSizePx * 0.82);
        const sRad = 0.8 + Math.random() * 1.4;
        const sIntensity = Math.floor(baseDensity * (0.45 + Math.random() * 0.45));
        const sr = ribbonColor === 'black' ? sIntensity : 0;
        const sg = ribbonColor === 'red'   ? sIntensity : 0;
        paperCtx.fillStyle = `rgb(${sr}, ${sg}, ${sIntensity})`;
        paperCtx.beginPath();
        paperCtx.arc(sx, sy, sRad, 0, Math.PI * 2);
        paperCtx.fill();
      }
    }

    paperCtx.restore();
    currentSheetHasInk = true;
    paperTexture.needsUpdate = true;
  }

  function rollCanvasTextUpOneLine() {
    const lineStepV = CONFIG.paperLinePxY / CONFIG.paperCanvasH;
    currentCanvasLine = Math.round(currentCanvasLine);

    if (currentCanvasLine >= MAX_LINE) {
      const dy = CONFIG.paperLinePxY;
      const w = paperCanvas.width;
      const h = paperCanvas.height;
      const imageData = paperCtx.getImageData(0, dy, w, h - dy);
      paperCtx.fillStyle = '#000000';
      paperCtx.fillRect(0, 0, w, h);
      paperCtx.putImageData(imageData, 0, 0);
      paperTexture.needsUpdate = true;
      scrollVCurrent += lineStepV;
    } else {
      currentCanvasLine = Math.min(MAX_LINE, currentCanvasLine + 1);
    }

    scrollVTarget = -currentCanvasLine * lineStepV;
    scrollVVel -= lineStepV * 4.8;
  }

  /**
   * Continuous fractional or snapped line scrolling (clamped 0..MAX_LINE).
   * Drives `uScrollV` which physically feeds the entire paper mesh up/down over the curved platen
   * in the vertex shader so even a completely blank sheet visibly rises and lowers as one piece!
   */
  function scrollByLines(deltaLines, snapToLine = false) {
    const lineStepV = CONFIG.paperLinePxY / CONFIG.paperCanvasH;
    currentCanvasLine = THREE.MathUtils.clamp(currentCanvasLine + deltaLines, 0, MAX_LINE);
    if (snapToLine) {
      currentCanvasLine = Math.round(currentCanvasLine);
      scrollVTarget = -currentCanvasLine * lineStepV;
    } else {
      scrollVTarget = -currentCanvasLine * lineStepV;
      scrollVCurrent = scrollVTarget;
      scrollVVel = 0;
      paperUniforms.uScrollV.value = scrollVCurrent;
    }
    paperUniforms.uFeedWave.value = Math.min(0.85, Math.abs(deltaLines) * 0.45);
    return currentCanvasLine;
  }

  function snapToNearestLine() {
    const lineStepV = CONFIG.paperLinePxY / CONFIG.paperCanvasH;
    currentCanvasLine = THREE.MathUtils.clamp(Math.round(currentCanvasLine), 0, MAX_LINE);
    scrollVTarget = -currentCanvasLine * lineStepV;
    return currentCanvasLine;
  }

  function setPullOutOffset(pullRatio) {
    if (sheetStatus === 'removed' || sheetStatus === 'ejecting') return;
    sheetStatus = 'pulling';
    insertAnimProgress = 1.0 + Math.max(0, pullRatio);
    paperUniforms.uInsertProgress.value = insertAnimProgress;
    paperUniforms.uFeedWave.value = Math.min(1.0, pullRatio * 0.9);
  }

  function settlePulledPaperBack() {
    if (sheetStatus === 'pulling') {
      sheetStatus = 'settling';
    }
  }

  const paperUniforms = {
    uTextMap: { value: paperTexture },
    uTime: { value: 0 },
    uScrollV: { value: 0.0 },
    uFeedWave: { value: 0.0 },
    uInsertProgress: { value: 1.0 },
    uPaperRadius: { value: CONFIG.platenRadius + 0.022 },
    uPaperWidth: { value: CONFIG.paperWidth },
    uTotalSheetLen: { value: TOTAL_SHEET_LEN },
    uLineStepWorld: { value: LINE_STEP_WORLD },
    uLightDir: { value: new THREE.Vector3(-8.5, 11.5, 6.2).normalize() }
  };

  const paperShaderMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: paperUniforms,
    vertexShader: PAPER_VERTEX_SHADER,
    fragmentShader: PAPER_FRAGMENT_SHADER
  });

  /**
   * Builds a high-density 128-segment mesh whose vertices are dynamically slid along the curved
   * platen path in `PAPER_VERTEX_SHADER` as `uScrollV` / `uInsertProgress` change.
   * Initializes the CPU geometry at the Line 0 seated position so raycasting hits the visible
   * 2.95-unit sheet above the platen immediately on load.
   */
  function createCurvedPaperGeometry(width, heightSegments = 128) {
    const geo = new THREE.PlaneGeometry(width, 1.0, 48, heightSegments);
    const posAttr = geo.attributes.position;
    const r = CONFIG.platenRadius + 0.022;
    const wrapBottomLen = 0.86;
    const wrapTopLen = 0.29;
    const tableStartS = wrapBottomLen + wrapTopLen; // 1.15
    const sTopAtLine0 = 1.15 + 2.95; // 4.10

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const u = posAttr.getY(i) + 0.5;
      const s = sTopAtLine0 - (1.0 - u) * TOTAL_SHEET_LEN;
      let py = 0;
      let pz = 0;

      if (s < 0.0) {
        const d = -s;
        const angle = -Math.PI * 0.52;
        py = Math.sin(angle) * r - d * 0.85;
        pz = Math.cos(angle) * r - d * 0.52;
      } else if (s < wrapBottomLen) {
        const t = s / wrapBottomLen;
        const angle = -Math.PI * 0.52 * (1.0 - t);
        py = Math.sin(angle) * r;
        pz = Math.cos(angle) * r;
      } else if (s < tableStartS) {
        const t = (s - wrapBottomLen) / wrapTopLen;
        const angle = t * (Math.PI * 0.21);
        py = Math.sin(angle) * r;
        pz = Math.cos(angle) * r;
      } else {
        const distAbove = s - tableStartS;
        const baseAngle = Math.PI * 0.21;
        const startY = Math.sin(baseAngle) * r;
        const startZ = Math.cos(baseAngle) * r;
        const hNorm = Math.min(1.0, Math.max(0.0, distAbove / 2.95));

        const topCurlZ = Math.pow(hNorm, 2.4) * 0.24 - Math.sin(hNorm * Math.PI) * 0.05;
        const topCurlY = -Math.pow(hNorm, 3.0) * 0.10;
        const edgeLiftZ = Math.pow(vx / (width * 0.5), 2.0) * Math.pow(hNorm, 1.8) * 0.075;

        py = startY + distAbove * Math.cos(0.20) + topCurlY;
        pz = startZ - distAbove * Math.sin(0.20) - topCurlZ + edgeLiftZ;
      }

      posAttr.setY(i, py);
      posAttr.setZ(i, pz);
    }

    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (geo.boundingSphere) {
      geo.boundingSphere.radius += 6.0;
    }
    return geo;
  }

  const paperMesh = new THREE.Mesh(createCurvedPaperGeometry(CONFIG.paperWidth), paperShaderMaterial);
  paperMesh.frustumCulled = false;
  paperMesh.castShadow = true;
  paperMesh.receiveShadow = true;
  carriageGroup.add(paperMesh);

  function triggerNewSheetInsert() {
    clearPaperCanvas();
    paperTexture.needsUpdate = true;
    sheetStatus = 'inserting';
    insertAnimProgress = 0.0;
    paperMesh.visible = true;
    paperUniforms.uFeedWave.value = 1.2;
    paperUniforms.uScrollV.value = 0.0;
  }

  function triggerPaperEject() {
    if (sheetStatus === 'removed' || sheetStatus === 'ejecting') return false;
    archiveCurrentCanvasIfInked();
    sheetStatus = 'ejecting';
    insertAnimProgress = Math.max(1.0, insertAnimProgress);
    paperUniforms.uFeedWave.value = 1.3;
    return true;
  }

  function getExportSourceCanvas() {
    if (currentSheetHasInk) return paperCanvas;
    if (hasArchivedSheet) return lastArchivedCanvas;
    return paperCanvas;
  }

  function triggerLineFeedWave() {
    paperUniforms.uFeedWave.value = 1.05;
  }

  function updatePaper(dt, elapsedTotal) {
    paperUniforms.uTime.value = elapsedTotal;

    if (sheetStatus === 'inserting') {
      insertAnimProgress = Math.min(1.0, insertAnimProgress + dt * 1.65);
      const eased = 1.0 - Math.pow(1.0 - insertAnimProgress, 3.0);
      paperUniforms.uInsertProgress.value = eased;
      if (insertAnimProgress >= 1.0) {
        insertAnimProgress = 1.0;
        paperUniforms.uInsertProgress.value = 1.0;
        sheetStatus = 'seated';
      }
    } else if (sheetStatus === 'settling') {
      insertAnimProgress = Math.max(1.0, insertAnimProgress - dt * 3.2);
      paperUniforms.uInsertProgress.value = insertAnimProgress;
      if (insertAnimProgress <= 1.001) {
        insertAnimProgress = 1.0;
        paperUniforms.uInsertProgress.value = 1.0;
        sheetStatus = 'seated';
      }
    } else if (sheetStatus === 'ejecting') {
      insertAnimProgress += dt * 2.5;
      paperUniforms.uInsertProgress.value = insertAnimProgress;
      if (insertAnimProgress >= 2.25) {
        sheetStatus = 'removed';
        paperMesh.visible = false;
      }
    }

    const stiffness = 175.0;
    const damping = 13.5;
    const force = (scrollVTarget - scrollVCurrent) * stiffness;
    scrollVVel = (scrollVVel + force * dt) * Math.exp(-damping * dt);
    scrollVCurrent += scrollVVel * dt;
    paperUniforms.uScrollV.value = scrollVCurrent;

    paperUniforms.uFeedWave.value *= Math.exp(-dt * 7.5);
  }

  return {
    paperMesh,
    paperCanvas,
    paperUniforms,
    stampCharacter,
    rollCanvasTextUpOneLine,
    scrollByLines,
    snapToNearestLine,
    setPullOutOffset,
    settlePulledPaperBack,
    triggerNewSheetInsert,
    triggerPaperEject,
    getExportSourceCanvas,
    isExportingArchived: () => !currentSheetHasInk && hasArchivedSheet,
    isSheetPresent: () => sheetStatus === 'seated' || sheetStatus === 'inserting' || sheetStatus === 'pulling' || sheetStatus === 'settling',
    getSheetStatus: () => sheetStatus,
    getCurrentLine: () => Math.round(currentCanvasLine),
    getFractionalLine: () => currentCanvasLine,
    triggerLineFeedWave,
    updatePaper
  };
}
