const TARGET_SUM = 10;
const GAME_DURATION_SECONDS = 60;
const TIMER_WARNING_SECONDS = 10;
const MAX_TILE_VALUE = 9;
const MIN_NODE_COUNT = 14;
const MAX_NODE_COUNT = 64;
const DENSITY_STEPS = Object.freeze([
  { boardSize: 980, nodeCount: 44, minDistance: 12.2 },
  { boardSize: 860, nodeCount: 39, minDistance: 12.8 },
  { boardSize: 740, nodeCount: 34, minDistance: 13.6 },
  { boardSize: 620, nodeCount: 30, minDistance: 14.4 },
  { boardSize: 500, nodeCount: 25, minDistance: 15.4 },
  { boardSize: 0, nodeCount: MIN_NODE_COUNT + 2, minDistance: 16.4 }
]);
const BOARD_MARGIN_PERCENT = 9;
const MIN_BOARD_MARGIN_PERCENT = 4.5;
const GAME_MODES = Object.freeze({
  mobile: {
    label: '모바일',
    nodeDelta: -4,
    minNodes: 14,
    maxNodes: 25,
    minNodeGapPx: 22,
    startHitRadius: 4.6,
    moveHitRadius: 3.8,
    trailPointMinDistance: 8,
    maxEffectElements: 42
  },
  tablet: {
    label: '태블릿',
    nodeDelta: 0,
    minNodes: 18,
    maxNodes: 44,
    minNodeGapPx: 18,
    startHitRadius: 3.8,
    moveHitRadius: 3.1,
    trailPointMinDistance: 7,
    maxEffectElements: 70
  },
  board: {
    label: '웹/전자칠판',
    nodeDelta: 6,
    minNodes: 28,
    maxNodes: MAX_NODE_COUNT,
    minNodeGapPx: 20,
    startHitRadius: 3.4,
    moveHitRadius: 2.8,
    trailPointMinDistance: 9,
    maxEffectElements: 70
  }
});
const SIZE_TIERS = Object.freeze([
  {
    key: 'compact',
    label: '작은 화면',
    maxShortSide: 560,
    nodeDelta: -3,
    minNodeDelta: -2,
    maxNodeDelta: -4,
    gapDeltaPx: 4,
    hitRadiusDelta: 0.35,
    trailPointDelta: 1,
    effectDelta: -18
  },
  {
    key: 'standard',
    label: '표준 화면',
    maxShortSide: 820,
    nodeDelta: 0,
    minNodeDelta: 0,
    maxNodeDelta: 0,
    gapDeltaPx: 0,
    hitRadiusDelta: 0,
    trailPointDelta: 0,
    effectDelta: 0
  },
  {
    key: 'wide',
    label: '넓은 화면',
    maxShortSide: 1100,
    nodeDelta: 2,
    minNodeDelta: 1,
    maxNodeDelta: 2,
    gapDeltaPx: 1,
    hitRadiusDelta: -0.1,
    trailPointDelta: 1,
    effectDelta: 0
  },
  {
    key: 'large',
    label: '대형 화면',
    maxShortSide: Infinity,
    nodeDelta: 5,
    minNodeDelta: 2,
    maxNodeDelta: 6,
    gapDeltaPx: 2,
    hitRadiusDelta: -0.25,
    trailPointDelta: 2,
    effectDelta: 0
  }
]);
const BASE_SCORE = 100;
const EXTRA_NODE_SCORE = 45;
const COMBO_SCORE = 25;
const MAX_COMBO_BONUS = 100;
const SPAWN_POSITION_ATTEMPTS = 640;
const MAX_ACTIVE_INPUTS = 10;
const READY_COLOR = '#d88416';
const OVER_TARGET_COLOR = '#cf4d5e';
const EFFECT_COLORS = Object.freeze(['#16805c', '#d88416', '#3774a5', '#cf4d5e']);
const INPUT_COLORS = Object.freeze([
  '#3774a5',
  '#16805c',
  '#d88416',
  '#cf4d5e',
  '#6d5bd0',
  '#008b8b',
  '#c05621',
  '#2563eb',
  '#7c3aed',
  '#0f766e'
]);

const boardEl = document.getElementById('board');
const effectsLayerEl = document.getElementById('effectsLayer');
const lineLayerEl = document.getElementById('lineLayer');
const scoreEl = document.getElementById('scoreValue');
const comboEl = document.getElementById('comboValue');
const timerEl = document.getElementById('timerValue');
const feedbackEl = document.getElementById('feedback');
const progressFillEl = document.getElementById('progressFill');
const newBoardButton = document.getElementById('newBoardButton');
const modeButtons = [...document.querySelectorAll('[data-mode-button]')];

let nodes = [];
let score = 0;
let combo = 0;
let remainingSeconds = GAME_DURATION_SECONDS;
let gameActive = true;
let currentModeKey = getInitialModeKey();
let currentSizeTierKey = getSizeTierKey();
let focusedPointerId = null;
let resolvingIds = new Set();
const activeInputs = new Map();
let nextInputColorIndex = 0;
let audioContext = null;
let resizeFrameId = null;
let pointerMoveFrameId = null;
let timerIntervalId = null;
let timerDeadline = 0;
let tuningCache = null;
let boardMetricsCache = null;
let boardRectCache = null;
let surfaceRectCache = null;
const effectElements = [];
const cellElements = new Map();
const nodeLookup = new Map();
const rgbaCache = new Map();
const pendingPointerMoves = new Map();

function randomValue() {
  return 1 + Math.floor(Math.random() * MAX_TILE_VALUE);
}

function setFeedback(message, tone = 'neutral') {
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback${tone === 'success' ? ' success' : ''}${tone === 'error' ? ' error' : ''}`;
}

function formatTimer(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  timerEl.textContent = formatTimer(remainingSeconds);
  timerEl.parentElement?.classList.toggle('timer-ending', gameActive && remainingSeconds <= TIMER_WARNING_SECONDS);
}

function stopTimer() {
  if (timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function endGame() {
  if (!gameActive) return;
  gameActive = false;
  remainingSeconds = 0;
  stopTimer();
  clearAllInputs();
  syncBoardInteractionState();
  updateStats();
  updateTimerDisplay();
  setFeedback(`시간 끝! 최종 점수는 ${score}점입니다. 새 판을 누르면 다시 시작합니다.`);
}

function tickTimer() {
  if (!gameActive) return;
  const nextRemainingSeconds = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
  if (nextRemainingSeconds === remainingSeconds) return;
  remainingSeconds = nextRemainingSeconds;
  updateTimerDisplay();
  if (remainingSeconds === 0) endGame();
}

function startTimer() {
  stopTimer();
  gameActive = true;
  remainingSeconds = GAME_DURATION_SECONDS;
  timerDeadline = Date.now() + GAME_DURATION_SECONDS * 1000;
  updateTimerDisplay();
  timerIntervalId = window.setInterval(tickTimer, 1000);
}

function hexToRgba(hex, alpha) {
  const cacheKey = `${hex}:${alpha}`;
  if (rgbaCache.has(cacheKey)) return rgbaCache.get(cacheKey);

  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const rgba = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  rgbaCache.set(cacheKey, rgba);
  return rgba;
}

function getInitialModeKey() {
  if (window.innerWidth <= 700) return 'mobile';
  if (window.innerWidth >= 1180) return 'board';
  return 'tablet';
}

function getShortViewportSide() {
  return Math.min(window.innerWidth, window.innerHeight);
}

function getSizeTierKey() {
  const shortSide = getShortViewportSide();
  return SIZE_TIERS.find((tier) => shortSide <= tier.maxShortSide)?.key || 'large';
}

function getMode() {
  return GAME_MODES[currentModeKey];
}

function getSizeTier() {
  return SIZE_TIERS.find((tier) => tier.key === currentSizeTierKey) || SIZE_TIERS[1];
}

function getTuning() {
  if (tuningCache) return tuningCache;

  const mode = getMode();
  const tier = getSizeTier();
  tuningCache = {
    modeLabel: mode.label,
    sizeLabel: tier.label,
    nodeDelta: mode.nodeDelta + tier.nodeDelta,
    minNodes: clampNumber(mode.minNodes + tier.minNodeDelta, MIN_NODE_COUNT, MAX_NODE_COUNT),
    maxNodes: clampNumber(mode.maxNodes + tier.maxNodeDelta, MIN_NODE_COUNT, MAX_NODE_COUNT),
    minNodeGapPx: Math.max(14, mode.minNodeGapPx + tier.gapDeltaPx),
    startHitRadius: Math.max(2.4, mode.startHitRadius + tier.hitRadiusDelta),
    moveHitRadius: Math.max(2.1, mode.moveHitRadius + tier.hitRadiusDelta),
    trailPointMinDistance: Math.max(6, mode.trailPointMinDistance + tier.trailPointDelta),
    maxEffectElements: clampNumber(mode.maxEffectElements + tier.effectDelta, 32, 80)
  };
  return tuningCache;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createBoardMetrics(rect) {
  const width = rect.width || window.innerWidth || 1;
  const height = rect.height || window.innerHeight || 1;
  const shortSide = Math.max(1, Math.min(width, height));
  const longSide = Math.max(width, height);
  return {
    width,
    height,
    shortSide,
    longSide,
    areaFactor: Math.min(2.8, (width * height) / (shortSide * shortSide))
  };
}

function invalidateLayoutCache() {
  boardMetricsCache = null;
  boardRectCache = null;
  surfaceRectCache = null;
}

function getBoardRect() {
  if (!boardRectCache) {
    boardRectCache = boardEl.getBoundingClientRect();
  }
  return boardRectCache;
}

function getSurfaceRect() {
  if (!surfaceRectCache) {
    surfaceRectCache = boardEl.parentElement.getBoundingClientRect();
  }
  return surfaceRectCache;
}

function getBoardMetrics(rect = getBoardRect()) {
  if (rect === boardRectCache && boardMetricsCache) return boardMetricsCache;
  const metrics = createBoardMetrics(rect);
  if (rect === boardRectCache) boardMetricsCache = metrics;
  return metrics;
}

function getBoardPixelSize() {
  return getBoardMetrics().shortSide;
}

function getDensityForBoardSize(boardSize) {
  return DENSITY_STEPS.find((step) => boardSize >= step.boardSize) || DENSITY_STEPS[DENSITY_STEPS.length - 1];
}

function getResponsiveNodeCount() {
  const tuning = getTuning();
  const metrics = getBoardMetrics();
  const density = getDensityForBoardSize(metrics.shortSide);
  const areaBonus = Math.round((metrics.areaFactor - 1) * 10);
  const baseCount = density.nodeCount + areaBonus + tuning.nodeDelta;
  return clampNumber(baseCount, Math.max(MIN_NODE_COUNT, tuning.minNodes), tuning.maxNodes);
}

function getCellDiameterPixels() {
  const cell = boardEl.querySelector('.cell');
  if (cell) {
    const computedWidth = Number.parseFloat(window.getComputedStyle(cell).width);
    if (Number.isFinite(computedWidth)) return computedWidth;
  }

  const viewportMin = Math.min(window.innerWidth, window.innerHeight);
  if (currentModeKey === 'mobile') return Math.min(64, Math.max(48, viewportMin * 0.12));
  if (currentModeKey === 'board') return Math.min(62, Math.max(42, viewportMin * 0.052));
  return Math.min(60, Math.max(40, viewportMin * 0.07));
}

function getMinimumNodeDistance(count) {
  const matchedStep = DENSITY_STEPS.find((step) => count >= step.nodeCount);
  const tuning = getTuning();
  const densityDistance = matchedStep?.minDistance || DENSITY_STEPS[DENSITY_STEPS.length - 1].minDistance;
  const visualDistance = ((getCellDiameterPixels() + tuning.minNodeGapPx) / getBoardMetrics().shortSide) * 100;
  return Math.max(densityDistance, visualDistance);
}

function getBoardMarginsPercent(metrics = getBoardMetrics()) {
  const safePixels = getCellDiameterPixels() / 2 + 8;
  return {
    x: clampNumber((safePixels / metrics.width) * 100, MIN_BOARD_MARGIN_PERCENT, BOARD_MARGIN_PERCENT),
    y: clampNumber((safePixels / metrics.height) * 100, MIN_BOARD_MARGIN_PERCENT, BOARD_MARGIN_PERCENT)
  };
}

function createRandomBoardPoint(margin = getBoardMarginsPercent()) {
  return {
    x: margin.x + Math.random() * (100 - margin.x * 2),
    y: margin.y + Math.random() * (100 - margin.y * 2)
  };
}

function getBoardDistance(first, second, metrics = getBoardMetrics()) {
  return Math.hypot(
    ((first.x - second.x) / 100) * metrics.width,
    ((first.y - second.y) / 100) * metrics.height
  ) / metrics.shortSide * 100;
}

function getNearestBoardDistance(candidate, points, metrics = getBoardMetrics()) {
  let nearestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const pointDistance = getBoardDistance(points[index], candidate, metrics);
    if (pointDistance < nearestDistance) {
      nearestDistance = pointDistance;
      if (nearestDistance === 0) break;
    }
  }
  return Number.isFinite(nearestDistance) ? nearestDistance : 100;
}

function createScatterPositions(count) {
  const positions = [];
  const minDistance = getMinimumNodeDistance(count);
  const metrics = getBoardMetrics();
  const margin = getBoardMarginsPercent(metrics);
  for (let index = 0; index < count; index += 1) {
    let placed = false;
    let bestPoint = null;
    let bestDistance = -1;
    for (let attempt = 0; attempt < 1200; attempt += 1) {
      const point = createRandomBoardPoint(margin);
      const nearestDistance = positions.length === 0
        ? minDistance
        : getNearestBoardDistance(point, positions, metrics);
      if (nearestDistance > bestDistance) {
        bestDistance = nearestDistance;
        bestPoint = point;
      }
      if (nearestDistance >= minDistance) {
        positions.push(point);
        placed = true;
        break;
      }
    }

    if (!placed) {
      positions.push(bestPoint || createRandomBoardPoint(margin));
    }
  }
  return positions;
}

function createNodes(values) {
  const positions = createScatterPositions(values.length);
  return values.map((value, id) => ({
    id,
    value,
    x: positions[id].x,
    y: positions[id].y
  }));
}

function getNodeById(id) {
  return nodeLookup.get(id) || null;
}

function syncNodeLookup() {
  nodeLookup.clear();
  nodes.forEach((node) => nodeLookup.set(node.id, node));
}

function updateStats() {
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  progressFillEl.style.width = `${score % 1000 / 10}%`;
}

function updateModeControls() {
  document.body.dataset.mode = currentModeKey;
  document.body.dataset.size = currentSizeTierKey;
  modeButtons.forEach((button) => {
    const isActive = button.dataset.modeButton === currentModeKey;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function setMode(modeKey) {
  if (!GAME_MODES[modeKey] || modeKey === currentModeKey) return;
  currentModeKey = modeKey;
  tuningCache = null;
  invalidateLayoutCache();
  updateModeControls();
  startNewBoard();
}

function syncSizeTier() {
  const nextSizeTierKey = getSizeTierKey();
  if (nextSizeTierKey === currentSizeTierKey) return;
  currentSizeTierKey = nextSizeTierKey;
  tuningCache = null;
  updateModeControls();
}

function handleResize() {
  if (resizeFrameId !== null) return;
  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    invalidateLayoutCache();
    syncSizeTier();
  });
}

function ensureAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

function resumeAudioContext() {
  const audio = ensureAudioContext();
  if (audio && typeof audio.resume === 'function') {
    audio.resume().catch(() => {});
  }
  return audio;
}

function playTone(audio, frequency, startOffset, duration, volume, type = 'sine') {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const startTime = audio.currentTime + startOffset;
  const endTime = startTime + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime + 0.02);
}

function playSuccessSound(comboLevel) {
  const audio = resumeAudioContext();
  if (!audio) return;

  const comboLift = Math.min(7, comboLevel - 1) * 14;
  const notes = [523.25 + comboLift, 659.25 + comboLift, 783.99 + comboLift];
  notes.forEach((frequency, index) => {
    playTone(audio, frequency, index * 0.055, 0.18, 0.09, 'triangle');
  });

  if (comboLevel >= 2) {
    playTone(audio, 1046.5 + comboLift, 0.19, 0.22, 0.075, 'sine');
  }

  if (comboLevel >= 5) {
    playTone(audio, 1318.5 + comboLift, 0.27, 0.2, 0.06, 'triangle');
  }
}

function playErrorSound() {
  const audio = resumeAudioContext();
  if (!audio) return;

  playTone(audio, 246.94, 0, 0.12, 0.05, 'sine');
  playTone(audio, 196, 0.085, 0.16, 0.04, 'sine');
}

function getSelectionOwners() {
  const owners = new Map();
  activeInputs.forEach((input) => {
    const sum = input.selectedSum;
    const status = sum === TARGET_SUM ? 'ready' : sum > TARGET_SUM ? 'over-target' : 'active';
    input.selectedIds.forEach((id) => owners.set(id, {
      color: input.color,
      glow: hexToRgba(input.color, status === 'ready' ? 0.28 : 0.18),
      status
    }));
  });
  return owners;
}

function getNodeElement(id) {
  return cellElements.get(id) || null;
}

function applyCellState(button, node, selectedOwners, locked, extraClasses = []) {
  const selectedOwner = selectedOwners.get(node.id);
  const statusClasses = ['selected', 'active', 'ready', 'over-target', 'locked'];
  statusClasses.forEach((className) => button.classList.remove(className));
  button.classList.toggle('breaking', resolvingIds.has(node.id));

  if (selectedOwner) {
    button.classList.add('selected', selectedOwner.status, 'locked');
    button.style.setProperty('--input-color', selectedOwner.status === 'ready' ? READY_COLOR : selectedOwner.color);
    button.style.setProperty('--input-glow', selectedOwner.status === 'ready' ? hexToRgba(READY_COLOR, 0.28) : selectedOwner.glow);
  } else {
    button.classList.toggle('locked', locked.has(node.id));
    button.style.removeProperty('--input-color');
    button.style.removeProperty('--input-glow');
  }

  extraClasses.forEach((className) => button.classList.add(className));
}

function getNodeCenter(id) {
  const node = getNodeById(id);
  const surfaceRect = getSurfaceRect();
  const boardRect = getBoardRect();
  return {
    x: boardRect.left + (node.x / 100) * boardRect.width - surfaceRect.left,
    y: boardRect.top + (node.y / 100) * boardRect.height - surfaceRect.top
  };
}

function getPointerPoint(event) {
  const surfaceRect = getSurfaceRect();
  return {
    x: event.clientX - surfaceRect.left,
    y: event.clientY - surfaceRect.top
  };
}

function getBoardPercentPoint(event) {
  const boardRect = getBoardRect();
  return {
    x: ((event.clientX - boardRect.left) / boardRect.width) * 100,
    y: ((event.clientY - boardRect.top) / boardRect.height) * 100
  };
}

function getBoardPercentPointFromClient(clientX, clientY, boardRect = getBoardRect()) {
  return {
    x: ((clientX - boardRect.left) / boardRect.width) * 100,
    y: ((clientY - boardRect.top) / boardRect.height) * 100
  };
}

function isInsideBoardPoint(point) {
  return point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
}

function renderBoard(extraClasses = new Map()) {
  const selectedOwners = getSelectionOwners();
  const locked = new Set(selectedOwners.keys());
  boardEl.innerHTML = '';
  cellElements.clear();
  nodes.forEach((node) => {
    const button = document.createElement('button');
    const classes = ['cell'];
    if (resolvingIds.has(node.id)) classes.push('breaking');
    const selectedOwner = selectedOwners.get(node.id);
    if (selectedOwner) classes.push('selected', selectedOwner.status);
    if (locked.has(node.id)) classes.push('locked');
    if (extraClasses.has(node.id)) classes.push(...extraClasses.get(node.id));

    button.type = 'button';
    button.className = classes.join(' ');
    button.dataset.id = node.id;
    button.dataset.value = node.value;
    button.style.left = `${node.x}%`;
    button.style.top = `${node.y}%`;
    button.setAttribute('aria-label', `${node.value}`);
    button.textContent = String(node.value);
    applyCellState(button, node, selectedOwners, locked, extraClasses.get(node.id) || []);
    boardEl.appendChild(button);
    cellElements.set(node.id, button);
  });
}

function syncBoardInteractionState(ids = null) {
  const selectedOwners = getSelectionOwners();
  const locked = new Set(selectedOwners.keys());
  const targetNodes = ids
    ? [...new Set(ids)].map(getNodeById).filter(Boolean)
    : nodes;
  targetNodes.forEach((node) => {
    const button = getNodeElement(node.id);
    if (!button) return;
    applyCellState(button, node, selectedOwners, locked);
  });
}

function markCells(ids, className) {
  ids.forEach((id) => getNodeElement(id)?.classList.add(className));
}

function markTemporary(ids, className, ms = 320) {
  markCells(ids, className);
  window.setTimeout(() => {
    ids.forEach((id) => getNodeElement(id)?.classList.remove(className));
  }, ms);
}

function pointsToSmoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const pathParts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const controlX = (previous.x + current.x) / 2;
    const controlY = (previous.y + current.y) / 2;
    pathParts.push(`Q ${previous.x} ${previous.y} ${controlX} ${controlY}`);
  }

  const last = points[points.length - 1];
  pathParts.push(`T ${last.x} ${last.y}`);
  return pathParts.join(' ');
}

function addTrailPoint(input, point) {
  const last = input.trailPoints[input.trailPoints.length - 1];
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < getTuning().trailPointMinDistance) return;
  input.trailPoints.push(point);
}

function addAvoidPoint(input, point) {
  const last = input.avoidPoints[input.avoidPoints.length - 1];
  if (last && getBoardDistance(last, point) < 2) return;
  input.avoidPoints.push(point);
  if (input.avoidPoints.length > 28) input.avoidPoints.shift();
}

function createInput(pointerId, event) {
  if (activeInputs.has(pointerId)) {
    removeInput(pointerId);
  }

  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const color = INPUT_COLORS[nextInputColorIndex % INPUT_COLORS.length];
  pathEl.classList.add('active-path');
  pathEl.setAttribute('d', '');
  pathEl.style.stroke = color;
  nextInputColorIndex += 1;
  lineLayerEl.appendChild(pathEl);

  const input = {
    color,
    isFinishing: false,
    pathFrameId: null,
    visualSum: null,
    wasReady: false,
    pathEl,
    selectedIds: [],
    selectedIdSet: new Set(),
    selectedSum: 0,
    trailPoints: [getPointerPoint(event)],
    avoidPoints: [getBoardPercentPoint(event)]
  };
  activeInputs.set(pointerId, input);
  focusedPointerId = pointerId;
  return input;
}

function removeInput(pointerId) {
  const input = activeInputs.get(pointerId);
  if (input) {
    if (input.pathFrameId !== null) {
      window.cancelAnimationFrame(input.pathFrameId);
      input.pathFrameId = null;
    }
    input.pathEl.remove();
  }
  pendingPointerMoves.delete(pointerId);
  if (boardEl.hasPointerCapture?.(pointerId)) {
    try {
      boardEl.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be gone on fast multi-touch releases.
    }
  }
  activeInputs.delete(pointerId);
  if (focusedPointerId === pointerId) {
    focusedPointerId = activeInputs.size > 0 ? [...activeInputs.keys()][activeInputs.size - 1] : null;
  }
}

function clearAllInputs() {
  activeInputs.forEach((input) => input.pathEl.remove());
  activeInputs.clear();
  pendingPointerMoves.clear();
  if (pointerMoveFrameId !== null) {
    window.cancelAnimationFrame(pointerMoveFrameId);
    pointerMoveFrameId = null;
  }
  focusedPointerId = null;
}

function showActivePath(pointerId, event) {
  const input = activeInputs.get(pointerId);
  if (!input) return;
  addTrailPoint(input, getPointerPoint(event));
  addAvoidPoint(input, getBoardPercentPoint(event));
  input.pathEl.style.opacity = '0.78';
  syncInputVisualState(input);
  schedulePathRender(input);
}

function syncInputVisualState(input) {
  const sum = input.selectedSum;
  if (sum === input.visualSum) return;
  input.visualSum = sum;

  const isReady = sum === TARGET_SUM;
  const isOverTarget = sum > TARGET_SUM;

  input.pathEl.classList.toggle('ready', isReady);
  input.pathEl.classList.toggle('over-target', isOverTarget);
  input.pathEl.style.stroke = isReady ? READY_COLOR : isOverTarget ? OVER_TARGET_COLOR : input.color;

  if (isReady && !input.wasReady) {
    spawnReadyPreview(input);
  }
  input.wasReady = isReady;
}

function schedulePathRender(input) {
  if (input.pathFrameId !== null) return;
  input.pathFrameId = window.requestAnimationFrame(() => {
    input.pathFrameId = null;
    input.pathEl.setAttribute('d', pointsToSmoothPath(input.trailPoints));
  });
}

function getSelectionCenter(ids) {
  const centers = ids.map(getNodeCenter);
  return centers.reduce((center, point) => ({
    x: center.x + point.x / centers.length,
    y: center.y + point.y / centers.length
  }), { x: 0, y: 0 });
}

function addEffectElement(className, point, ms, text = '') {
  const element = document.createElement('span');
  element.className = className;
  element.style.left = `${point.x}px`;
  element.style.top = `${point.y}px`;
  element.textContent = text;
  appendEffectElement(element, ms);
  return element;
}

function appendEffectElement(element, ms) {
  effectsLayerEl.appendChild(element);
  effectElements.push(element);
  while (effectElements.length > getTuning().maxEffectElements) {
    effectElements.shift()?.remove();
  }
  window.setTimeout(() => {
    const index = effectElements.indexOf(element);
    if (index >= 0) effectElements.splice(index, 1);
    element.remove();
  }, ms);
}

function getEffectTargetIds(ids, maxCount) {
  if (ids.length <= maxCount) return ids;
  if (maxCount <= 1) return [ids[0]];

  const step = (ids.length - 1) / (maxCount - 1);
  return Array.from({ length: maxCount }, (_, index) => ids[Math.round(index * step)]);
}

function spawnScreenFlash(comboLevel) {
  const flash = document.createElement('span');
  flash.className = `success-flash${comboLevel >= 5 ? ' fever' : comboLevel >= 2 ? ' combo' : ''}`;
  appendEffectElement(flash, 520);
}

function spawnReadyPreview(input) {
  if (input.selectedIds.length < 2) return;

  const center = getSelectionCenter(input.selectedIds);
  const preview = addEffectElement('ready-pop', center, 580, '10');
  preview.style.setProperty('--input-color', READY_COLOR);
}

function spawnSuccessRings(ids, comboLevel, inputColor) {
  getEffectTargetIds(ids, 5).forEach((id) => {
    const ring = addEffectElement('success-ring', getNodeCenter(id), 680);
    ring.style.borderColor = inputColor;
    ring.style.boxShadow = `0 0 0 5px ${hexToRgba(inputColor, 0.16)}`;
    ring.style.setProperty('--ring-scale', comboLevel >= 5 ? '2.8' : comboLevel >= 3 ? '2.4' : '2');
  });
}

function spawnScorePop(ids, earned, comboLevel, inputColor) {
  const center = getSelectionCenter(ids);
  const scorePop = addEffectElement('score-pop', center, 780, `+${earned}`);
  scorePop.style.color = inputColor;

  if (comboLevel >= 2) {
    const comboPop = addEffectElement('combo-pop', {
      x: center.x,
      y: center.y - 52
    }, 940, `${comboLevel}콤보`);
    if (comboLevel >= 5) comboPop.classList.add('fever');
    if (comboLevel >= 3) comboPop.classList.add('strong');
    comboPop.style.setProperty('--combo-scale', String(Math.min(1.35, 1 + comboLevel * 0.035)));
  }
}

function spawnParticles(ids, comboLevel = 1, inputColor = EFFECT_COLORS[0]) {
  const particleCount = comboLevel >= 5 ? 8 : comboLevel >= 3 ? 6 : 4;
  const spread = comboLevel >= 5 ? 62 : comboLevel >= 3 ? 54 : 40;
  getEffectTargetIds(ids, comboLevel >= 5 ? 5 : 4).forEach((id) => {
    const center = getNodeCenter(id);
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const angle = (Math.PI * 2 * particleIndex) / particleCount;
      const distanceOffset = spread + (particleIndex % 3) * 8;
      const particle = document.createElement('span');
      const color = particleIndex % 2 === 0 ? inputColor : EFFECT_COLORS[particleIndex % EFFECT_COLORS.length];
      particle.className = 'particle';
      particle.style.left = `${center.x}px`;
      particle.style.top = `${center.y}px`;
      particle.style.background = color;
      particle.style.color = color;
      particle.style.setProperty('--dx', `${Math.cos(angle) * distanceOffset}px`);
      particle.style.setProperty('--dy', `${Math.sin(angle) * distanceOffset}px`);
      appendEffectElement(particle, 640);
    }
  });
}

function spawnSuccessEffects(ids, earned, comboLevel, inputColor) {
  spawnScreenFlash(comboLevel);
  spawnSuccessRings(ids, comboLevel, inputColor);
  spawnScorePop(ids, earned, comboLevel, inputColor);
  spawnParticles(ids, comboLevel, inputColor);
}

function spawnFailureEffects(ids, inputColor) {
  const center = getSelectionCenter(ids);
  const missPop = addEffectElement('miss-pop', center, 560, '다시');
  missPop.style.color = OVER_TARGET_COLOR;

  getEffectTargetIds(ids, 4).forEach((id) => {
    const point = getNodeCenter(id);
    const ring = addEffectElement('miss-ring', point, 420);
    ring.style.borderColor = hexToRgba(inputColor, 0.38);
  });
}

function spawnNewNodeEffects(ids, inputColor) {
  getEffectTargetIds(ids, 5).forEach((id) => {
    const point = getNodeCenter(id);
    const spark = addEffectElement('spawn-spark', point, 520);
    spark.style.setProperty('--input-color', inputColor);
    spark.style.setProperty('--input-glow', hexToRgba(inputColor, 0.16));
  });
}

function pulseStat(element, className) {
  const stat = element.parentElement;
  if (!stat) return;
  stat.classList.remove(className);
  void stat.offsetWidth;
  stat.classList.add(className);
  window.setTimeout(() => stat.classList.remove(className), 420);
}

function pulseSuccessStats(comboLevel) {
  pulseStat(scoreEl, 'score-hit');
  if (comboLevel >= 2) pulseStat(comboEl, 'combo-hit');
}

function pulseComboBreak() {
  pulseStat(comboEl, 'combo-break');
}

function getTargetId(event) {
  return getNearestNodeId(event.clientX, event.clientY, getTuning().startHitRadius, event.pointerId);
}

function getIdsAtPointerPath(pointerId, clientX, clientY) {
  const input = activeInputs.get(pointerId);
  if (!input) return [];

  const boardRect = getBoardRect();
  const metrics = getBoardMetrics(boardRect);
  const currentPoint = getBoardPercentPointFromClient(clientX, clientY, boardRect);
  const previousPoint = input.avoidPoints[input.avoidPoints.length - 1] || currentPoint;
  const moveHitRadius = getTuning().moveHitRadius;
  const ids = getNodeIdsAlongSegment(previousPoint, currentPoint, moveHitRadius, pointerId, metrics);
  const directId = getNearestNodeIdAtBoardPoint(currentPoint, moveHitRadius, pointerId, metrics);
  if (directId !== null && !ids.includes(directId)) ids.push(directId);
  return ids;
}

function getNearestNodeId(clientX, clientY, hitRadiusPercent, pointerId) {
  const boardRect = getBoardRect();
  const point = getBoardPercentPointFromClient(clientX, clientY, boardRect);
  return getNearestNodeIdAtBoardPoint(point, hitRadiusPercent, pointerId, getBoardMetrics(boardRect));
}

function getNearestNodeIdAtBoardPoint(point, hitRadiusPercent, pointerId, metrics = getBoardMetrics()) {
  if (!isInsideBoardPoint(point)) return null;

  let nearestId = null;
  const pointX = (point.x / 100) * metrics.width;
  const pointY = (point.y / 100) * metrics.height;
  const radiusPixels = (hitRadiusPercent / 100) * metrics.shortSide;
  let nearestDistanceSquared = radiusPixels * radiusPixels;
  nodes.forEach((node) => {
    if (resolvingIds.has(node.id)) return;
    if (isLockedByAnotherInput(pointerId, node.id)) return;
    const dx = pointX - (node.x / 100) * metrics.width;
    const dy = pointY - (node.y / 100) * metrics.height;
    const nodeDistanceSquared = dx * dx + dy * dy;
    if (nodeDistanceSquared <= nearestDistanceSquared) {
      nearestDistanceSquared = nodeDistanceSquared;
      nearestId = node.id;
    }
  });
  return nearestId;
}

function getNodeIdsAlongSegment(start, end, hitRadiusPercent, pointerId, metrics = getBoardMetrics()) {
  const input = activeInputs.get(pointerId);
  const previousId = input ? input.selectedIds[input.selectedIds.length - 2] : null;
  const hits = [];
  const startX = (start.x / 100) * metrics.width;
  const startY = (start.y / 100) * metrics.height;
  const endX = (end.x / 100) * metrics.width;
  const endY = (end.y / 100) * metrics.height;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const radiusPixels = (hitRadiusPercent / 100) * metrics.shortSide;
  const radiusSquared = radiusPixels * radiusPixels;

  nodes.forEach((node) => {
    if (resolvingIds.has(node.id)) return;
    if (isLockedByAnotherInput(pointerId, node.id)) return;
    if (input?.selectedIdSet.has(node.id) && node.id !== previousId) return;

    const pointX = (node.x / 100) * metrics.width;
    const pointY = (node.y / 100) * metrics.height;
    let t = 0;
    let distanceSquared = 0;
    if (lengthSquared === 0) {
      const startDistanceX = pointX - startX;
      const startDistanceY = pointY - startY;
      distanceSquared = startDistanceX * startDistanceX + startDistanceY * startDistanceY;
    } else {
      const rawT = ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared;
      t = clampNumber(rawT, 0, 1);
      const projectionX = startX + dx * t;
      const projectionY = startY + dy * t;
      const projectionDistanceX = pointX - projectionX;
      const projectionDistanceY = pointY - projectionY;
      distanceSquared = projectionDistanceX * projectionDistanceX + projectionDistanceY * projectionDistanceY;
    }

    if (distanceSquared <= radiusSquared) {
      hits.push({
        id: node.id,
        t,
        distanceSquared
      });
    }
  });

  hits.sort((first, second) => first.t - second.t || first.distanceSquared - second.distanceSquared);
  return hits.map((hit) => hit.id);
}

function isLockedByAnotherInput(pointerId, id) {
  for (const [otherPointerId, input] of activeInputs.entries()) {
    if (otherPointerId !== pointerId && input.selectedIdSet.has(id)) return true;
  }
  return false;
}

function setSelectionFeedback(input) {
  const sum = input.selectedSum;
  setFeedback(sum === TARGET_SUM ? '합 10입니다. 손을 떼면 사라집니다.' : `지금 더한 값 ${sum}`, sum > TARGET_SUM ? 'error' : 'neutral');
}

function commitSelectionChange(input, dirtyIds = input.selectedIds) {
  syncBoardInteractionState(dirtyIds);
  updateStats();
  setSelectionFeedback(input);
}

function addIdToSelection(pointerId, id, shouldCommit = true) {
  const input = activeInputs.get(pointerId);
  const node = getNodeById(id);
  if (!input || !node || resolvingIds.has(id) || isLockedByAnotherInput(pointerId, id)) return [];

  const lastId = input.selectedIds[input.selectedIds.length - 1];
  if (lastId === id) return [];

  const previousId = input.selectedIds[input.selectedIds.length - 2];
  if (previousId === id) {
    const removedId = input.selectedIds.pop();
    const removedNode = getNodeById(removedId);
    input.selectedIdSet.delete(removedId);
    input.selectedSum -= removedNode?.value || 0;
    focusedPointerId = pointerId;
    const dirtyIds = [...input.selectedIds, removedId];
    if (shouldCommit) commitSelectionChange(input, dirtyIds);
    return dirtyIds;
  }

  if (input.selectedIdSet.has(id)) return [];

  input.selectedIds.push(id);
  input.selectedIdSet.add(id);
  input.selectedSum += node.value;
  focusedPointerId = pointerId;
  const dirtyIds = [...input.selectedIds];
  if (shouldCommit) commitSelectionChange(input, dirtyIds);
  return dirtyIds;
}

function addIdsAtPointerPath(pointerId, event) {
  const input = activeInputs.get(pointerId);
  if (!input) return;

  const dirtyIds = new Set();
  getIdsAtPointerPath(pointerId, event.clientX, event.clientY).forEach((id) => {
    addIdToSelection(pointerId, id, false).forEach((dirtyId) => dirtyIds.add(dirtyId));
  });
  if (dirtyIds.size > 0) commitSelectionChange(input, [...dirtyIds]);
}

function processPointerMove(point) {
  if (!activeInputs.has(point.pointerId)) return;
  addIdsAtPointerPath(point.pointerId, point);
  showActivePath(point.pointerId, point);
}

function flushPendingPointerMove(pointerId) {
  const point = pendingPointerMoves.get(pointerId);
  if (!point) return;
  pendingPointerMoves.delete(pointerId);
  processPointerMove(point);
}

function flushPendingPointerMoves() {
  pointerMoveFrameId = null;
  const moves = [...pendingPointerMoves.values()];
  pendingPointerMoves.clear();
  moves.forEach(processPointerMove);
}

function queuePointerMove(event) {
  pendingPointerMoves.set(event.pointerId, {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY
  });

  if (pointerMoveFrameId === null) {
    pointerMoveFrameId = window.requestAnimationFrame(flushPendingPointerMoves);
  }
}

function getSpawnAvoidPoints(pointerId, finishedInput) {
  const points = [...(finishedInput?.avoidPoints || [])];
  points.push(...getForwardAvoidPoints(finishedInput));
  activeInputs.forEach((input, otherPointerId) => {
    if (otherPointerId !== pointerId) {
      points.push(...input.avoidPoints.slice(-10));
      points.push(...getForwardAvoidPoints(input));
    }
  });
  return points;
}

function clampPercent(value) {
  return Math.max(6, Math.min(94, value));
}

function getForwardAvoidPoints(input) {
  if (!input || input.avoidPoints.length < 2) return [];

  const last = input.avoidPoints[input.avoidPoints.length - 1];
  let previous = null;
  for (let index = input.avoidPoints.length - 2; index >= 0; index -= 1) {
    const candidate = input.avoidPoints[index];
    if (getBoardDistance(candidate, last) >= 1.5) {
      previous = candidate;
      break;
    }
  }
  if (!previous) return [];

  const dx = last.x - previous.x;
  const dy = last.y - previous.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 0.01) return [];

  const unitX = dx / magnitude;
  const unitY = dy / magnitude;
  const perpX = -unitY;
  const perpY = unitX;
  const points = [];

  [12, 24, 36].forEach((forwardDistance) => {
    points.push({
      x: clampPercent(last.x + unitX * forwardDistance),
      y: clampPercent(last.y + unitY * forwardDistance)
    });
  });

  [18, 30].forEach((forwardDistance) => {
    [-9, 9].forEach((sideDistance) => {
      points.push({
        x: clampPercent(last.x + unitX * forwardDistance + perpX * sideDistance),
        y: clampPercent(last.y + unitY * forwardDistance + perpY * sideDistance)
      });
    });
  });

  return points;
}

function getCandidateAvoidScore(candidate, avoidPoints, metrics = getBoardMetrics()) {
  return getNearestBoardDistance(candidate, avoidPoints, metrics);
}

function getNearestUsedDistance(candidate, usedPositions, metrics = getBoardMetrics()) {
  return getNearestBoardDistance(candidate, usedPositions, metrics);
}

function createSpawnPosition(usedPositions, avoidPoints) {
  let bestCandidate = null;
  let bestScore = -1;
  let fallbackCandidate = null;
  let fallbackDistance = -1;
  let fallbackAvoidScore = -1;
  const minDistance = getMinimumNodeDistance(nodes.length);
  const metrics = getBoardMetrics();
  const margin = getBoardMarginsPercent(metrics);

  for (let attempt = 0; attempt < SPAWN_POSITION_ATTEMPTS; attempt += 1) {
    const candidate = createRandomBoardPoint(margin);
    const nearestUsedDistance = getNearestUsedDistance(candidate, usedPositions, metrics);
    const avoidScore = getCandidateAvoidScore(candidate, avoidPoints, metrics);

    if (
      nearestUsedDistance > fallbackDistance ||
      (nearestUsedDistance === fallbackDistance && avoidScore > fallbackAvoidScore)
    ) {
      fallbackDistance = nearestUsedDistance;
      fallbackAvoidScore = avoidScore;
      fallbackCandidate = candidate;
    }

    if (nearestUsedDistance < minDistance) {
      continue;
    }

    if (avoidScore > bestScore) {
      bestScore = avoidScore;
      bestCandidate = candidate;
    }

    if (avoidScore >= 48) break;
  }

  return bestCandidate || fallbackCandidate;
}

function replaceSelectedNodes(ids, avoidPoints = []) {
  const selectedIdSet = new Set(ids);
  const usedPositions = nodes
    .filter((node) => !selectedIdSet.has(node.id))
    .map((node) => ({ x: node.x, y: node.y }));

  nodes = nodes.map((node) => {
    if (!selectedIdSet.has(node.id)) return node;

    const position = createSpawnPosition(usedPositions, avoidPoints);
    usedPositions.push(position);
    return {
      id: node.id,
      value: randomValue(),
      x: position.x,
      y: position.y
    };
  });
  syncNodeLookup();
}

function finishSelection(pointerId, event = null) {
  const input = activeInputs.get(pointerId);
  if (!input) return;
  if (input.isFinishing) return;

  input.isFinishing = true;
  if (event) {
    flushPendingPointerMove(pointerId);
    addIdsAtPointerPath(pointerId, event);
    showActivePath(pointerId, event);
  }

  const path = [...input.selectedIds];
  const sum = input.selectedSum;
  const inputColor = input.color;
  const avoidPoints = getSpawnAvoidPoints(pointerId, input);
  removeInput(pointerId);
  syncBoardInteractionState(path);
  updateStats();

  if (path.length < 2) {
    setFeedback('연결을 취소했습니다. 콤보는 유지됩니다.');
    return;
  }

  if (sum < TARGET_SUM) {
    setFeedback(`${sum}까지 더한 상태에서 멈췄습니다. 콤보는 유지됩니다.`);
    return;
  }

  if (sum > TARGET_SUM) {
    combo = 0;
    updateStats();
    markTemporary(path, 'wrong', 280);
    playErrorSound();
    spawnFailureEffects(path, inputColor);
    pulseComboBreak();
    setFeedback(`합이 ${sum}입니다. 콤보가 끊겼습니다.`, 'error');
    return;
  }

  combo += 1;
  const lengthBonus = Math.max(0, path.length - 2) * EXTRA_NODE_SCORE;
  const comboBonus = Math.min(MAX_COMBO_BONUS, Math.max(0, combo - 1) * COMBO_SCORE);
  const earned = BASE_SCORE + lengthBonus + comboBonus;
  score += earned;
  updateStats();
  playSuccessSound(combo);
  spawnSuccessEffects(path, earned, combo, inputColor);
  pulseSuccessStats(combo);
  path.forEach((id) => resolvingIds.add(id));
  markCells(path, 'breaking');
  setFeedback(`${path.length}개 숫자로 10을 만들었습니다. +${earned}점 · ${combo}콤보`, 'success');
  window.setTimeout(() => {
    replaceSelectedNodes(path, avoidPoints);
    path.forEach((id) => resolvingIds.delete(id));
    renderBoard(new Map(path.map((id) => [id, ['spawned']])));
    spawnNewNodeEffects(path, inputColor);
    updateStats();
  }, 360);
}

function resetBoard(nextNodes, message) {
  clearAllInputs();
  nodes = nextNodes.map((node) => ({ ...node }));
  syncNodeLookup();
  score = 0;
  combo = 0;
  resolvingIds = new Set();
  effectElements.length = 0;
  effectsLayerEl.innerHTML = '';
  renderBoard();
  updateStats();
  setFeedback(message);
  startTimer();
}

function startNewBoard() {
  const nodeCount = getResponsiveNodeCount();
  const tuning = getTuning();
  resetBoard(
    createNodes(Array.from({ length: nodeCount }, randomValue)),
    `${tuning.modeLabel} · ${tuning.sizeLabel} · ${nodeCount}개의 숫자를 이어 10을 만드세요.`
  );
}

function preventBoardGesture(event) {
  if (event.cancelable) event.preventDefault();
}

function capturePointer(pointerId) {
  try {
    boardEl.setPointerCapture(pointerId);
  } catch {
    // Some browsers can miss capture during very fast multi-touch starts.
  }
}

function handlePointerMove(event) {
  if (!activeInputs.has(event.pointerId)) return;
  preventBoardGesture(event);
  queuePointerMove(event);
}

boardEl.addEventListener('pointerdown', (event) => {
  preventBoardGesture(event);
  if (!gameActive) {
    setFeedback(`시간 끝! 최종 점수는 ${score}점입니다. 새 판을 누르면 다시 시작합니다.`);
    return;
  }
  if (activeInputs.size >= MAX_ACTIVE_INPUTS && !activeInputs.has(event.pointerId)) return;

  const id = getTargetId(event);
  if (id === null) return;

  resumeAudioContext();
  capturePointer(event.pointerId);
  createInput(event.pointerId, event);
  addIdToSelection(event.pointerId, id);
  showActivePath(event.pointerId, event);
});

boardEl.addEventListener('pointermove', handlePointerMove);
if ('onpointerrawupdate' in window) {
  boardEl.addEventListener('pointerrawupdate', handlePointerMove);
}

boardEl.addEventListener('pointerup', (event) => {
  preventBoardGesture(event);
  finishSelection(event.pointerId, event);
});

boardEl.addEventListener('pointercancel', (event) => {
  preventBoardGesture(event);
  const input = activeInputs.get(event.pointerId);
  const dirtyIds = input ? [...input.selectedIds] : [];
  removeInput(event.pointerId);
  syncBoardInteractionState(dirtyIds);
  updateStats();
});

boardEl.addEventListener('lostpointercapture', (event) => {
  if (!activeInputs.has(event.pointerId)) return;
  finishSelection(event.pointerId);
});

newBoardButton.addEventListener('click', startNewBoard);
modeButtons.forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.modeButton));
});
window.addEventListener('resize', handleResize);

updateModeControls();
startNewBoard();
