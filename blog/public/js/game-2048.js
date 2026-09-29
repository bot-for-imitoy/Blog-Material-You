/**
 * game-2048.js — the /2048/ easter egg game.
 *
 * Loaded only on `/2048/` (see VIEW_SCRIPTS in src/routes/public-pages.ts) and
 * opened by clicking the about-page avatar seven times.
 *
 * This is a faithful port of the original engine that lived inline in the SPA
 * shell, with two changes:
 *   - tiles and overlays are built with createElement/textContent instead of
 *     `innerHTML` + string concatenation;
 *   - "Keep Going" really continues the run (the old build wired it to a full
 *     reset, which contradicted the label) while "New Game" still restarts.
 *
 * Board values: 0 = empty, otherwise a power of two. The CSS colours tiles via
 * `.cell-<value>` and falls back to `.cell-super` above 2048.
 */

const GRID_SIZE = 4;
const WIN_VALUE = 2048;
/** localStorage key holding the best score (kept from the original build). */
const BEST_SCORE_KEY = 'g2048_best';
/** A swipe shorter than this (px) is treated as a tap, not a move. */
const SWIPE_THRESHOLD_PX = 30;
/** New tiles are a 4 with 10% probability, otherwise a 2. */
const SPAWN_FOUR_PROBABILITY = 0.1;
/** Where the close button returns to. */
const CLOSE_TARGET = '/about/';

const gridElement = document.getElementById('grid-2048');
const scoreElement = document.getElementById('game-score');
const bestElement = document.getElementById('game-best');

/** `{ grid, score, won, over, keepPlaying }` for the running game. */
let state = null;
/** Best score, persisted across visits when storage is available. */
let bestScore = readBestScore();

/** Start position of the current touch gesture, or null between gestures. */
let swipeStart = null;

/* ==========================================================================
 * Persistence
 * ======================================================================== */

/** Read the stored best score, tolerating blocked/absent localStorage. */
function readBestScore() {
  try {
    const stored = Number.parseInt(window.localStorage.getItem(BEST_SCORE_KEY) || '0', 10);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch (error) {
    // Private browsing modes can throw on access; the game still plays on.
    return 0;
  }
}

/** Persist the best score; failures are not worth interrupting the game. */
function writeBestScore(value) {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch (error) {
    /* storage unavailable — ignore */
  }
}

/* ==========================================================================
 * Game state
 * ======================================================================== */

/** A fresh, empty 4×4 board. */
function emptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, () => 0));
}

/** Drop a 2 (90%) or 4 (10%) into a random empty cell. */
function addRandomTile() {
  const empty = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      if (state.grid[row][column] === 0) empty.push([row, column]);
    }
  }
  if (empty.length === 0) return;

  const [row, column] = empty[Math.floor(Math.random() * empty.length)];
  state.grid[row][column] = Math.random() < SPAWN_FOUR_PROBABILITY ? 4 : 2;
}

/** Start a new run: clear the board, the score and any result overlay. */
function newGame() {
  clearResultOverlay();
  state = { grid: emptyGrid(), score: 0, won: false, over: false, keepPlaying: false };
  addRandomTile();
  addRandomTile();
  render();
}

/**
 * Collapse one line towards index 0: drop the empty cells, merge each equal
 * neighbour pair once, then pad with zeros.
 * @returns {{row: number[], gained: number, moved: boolean}}
 */
function slideRow(row) {
  const values = row.filter((value) => value !== 0);
  let gained = 0;

  for (let i = 0; i < values.length - 1; i += 1) {
    if (values[i] === values[i + 1]) {
      values[i] *= 2;
      gained += values[i];
      // Remove the consumed tile; the loop continues with the next pair.
      values.splice(i + 1, 1);
    }
  }

  while (values.length < GRID_SIZE) values.push(0);

  let moved = false;
  for (let i = 0; i < GRID_SIZE; i += 1) {
    if (values[i] !== row[i]) {
      moved = true;
      break;
    }
  }

  return { row: values, gained, moved };
}

/** Apply a move in one direction; spawns a tile only when something moved. */
function move(direction) {
  if (!state || state.over || state.won) return;

  let moved = false;
  let gained = 0;

  if (direction === 'left' || direction === 'right') {
    for (let row = 0; row < GRID_SIZE; row += 1) {
      // 'right' is the mirrored 'left': slide, then flip back.
      const line = direction === 'left' ? state.grid[row] : state.grid[row].slice().reverse();
      const result = slideRow(line);
      moved = moved || result.moved;
      gained += result.gained;
      state.grid[row] = direction === 'left' ? result.row : result.row.reverse();
    }
  } else {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      // 'up' reads the column top→bottom, 'down' bottom→top.
      const indices = [];
      const line = [];
      for (let i = 0; i < GRID_SIZE; i += 1) {
        const row = direction === 'up' ? i : GRID_SIZE - 1 - i;
        indices.push(row);
        line.push(state.grid[row][column]);
      }

      const result = slideRow(line);
      moved = moved || result.moved;
      gained += result.gained;
      indices.forEach((row, i) => {
        state.grid[row][column] = result.row[i];
      });
    }
  }

  if (!moved) return;

  state.score += gained;
  addRandomTile();
  updateState();
  render();
}

/** Whether any merge or empty cell is still available. */
function hasMoves() {
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const value = state.grid[row][column];
      if (value === 0) return true;
      if (column < GRID_SIZE - 1 && value === state.grid[row][column + 1]) return true;
      if (row < GRID_SIZE - 1 && value === state.grid[row + 1][column]) return true;
    }
  }
  return false;
}

/** Recompute win/lose flags and remember a new best score. */
function updateState() {
  if (!state.keepPlaying && !state.won) {
    for (let row = 0; row < GRID_SIZE && !state.won; row += 1) {
      for (let column = 0; column < GRID_SIZE && !state.won; column += 1) {
        if (state.grid[row][column] === WIN_VALUE) state.won = true;
      }
    }
  }

  if (!state.won && !hasMoves()) state.over = true;

  if (state.score > bestScore) {
    bestScore = state.score;
    writeBestScore(bestScore);
  }
}

/** Continue after the win overlay: the same board, without further win stops. */
function keepPlaying() {
  if (!state) return;
  state.keepPlaying = true;
  state.won = false;
  render();
}

/* ==========================================================================
 * Rendering
 * ======================================================================== */

/** Remove a win/lose overlay if one is present. */
function clearResultOverlay() {
  const wrap = gridElement && gridElement.parentElement;
  if (!wrap) return;
  wrap.querySelectorAll('.game-overlay-won, .game-overlay-lost').forEach((overlay) => {
    overlay.remove();
  });
}

/** Build a result overlay box with one action button. */
function createOverlay(className, title, message, actionLabel, actionName) {
  const overlay = document.createElement('div');
  overlay.className = className;

  const box = document.createElement('div');
  box.className = 'game-overlay-msg';

  const heading = document.createElement('h2');
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'game-overlay-text';
  text.textContent = message;

  const button = document.createElement('mdui-button');
  button.setAttribute('variant', 'filled');
  button.setAttribute('data-action', actionName);
  button.textContent = actionLabel;

  box.append(heading, text, button);
  overlay.append(box);
  return overlay;
}

/** Show the win or lost overlay for the current state (if any). */
function renderResultOverlay() {
  clearResultOverlay();
  const wrap = gridElement && gridElement.parentElement;
  if (!wrap || !state) return;

  if (state.won) {
    wrap.append(
      createOverlay('game-overlay-won', '🎉 You Win!', 'You reached 2048!', 'Keep Going', 'keep-going'),
    );
  } else if (state.over) {
    wrap.append(
      createOverlay('game-overlay-lost', '💀 Game Over', `Score: ${state.score}`, 'Play Again', 'new-game'),
    );
  }
}

/** Redraw the whole board, the score boxes and the overlay. */
function render() {
  if (!state || !gridElement) return;

  const fragment = document.createDocumentFragment();
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const value = state.grid[row][column];
      const cell = document.createElement('div');
      // Everything above 2048 shares the dark `.cell-super` palette.
      cell.className = value > WIN_VALUE ? 'cell-2048 cell-super' : `cell-2048 cell-${value}`;
      cell.textContent = value === 0 ? '' : String(value);
      fragment.append(cell);
    }
  }
  gridElement.replaceChildren(fragment);

  if (scoreElement) scoreElement.textContent = String(state.score);
  if (bestElement) bestElement.textContent = String(bestScore);

  renderResultOverlay();
}

/* ==========================================================================
 * Input
 * ======================================================================== */

/** Keyboard directions for arrow keys and WASD. */
const KEY_DIRECTIONS = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  a: 'left',
  w: 'up',
  d: 'right',
  s: 'down',
};

/** Whether a keystroke belongs to a text field rather than the board. */
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  if (!gridElement || !gridElement.isConnected) return;
  // Never hijack browser shortcuts (Ctrl+A, Cmd+R, …).
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  const direction = KEY_DIRECTIONS[event.key] || KEY_DIRECTIONS[event.key.toLowerCase()];
  if (!direction) return;

  // Stop the page from scrolling while playing.
  event.preventDefault();
  move(direction);
});

document.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeStart = { x: touch.clientX, y: touch.clientY };
  },
  { passive: true },
);

document.addEventListener('touchend', (event) => {
  if (!swipeStart) return;
  const start = swipeStart;
  swipeStart = null;

  const touch = event.changedTouches[0];
  if (!touch) return;

  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  // Short gestures are taps (e.g. the buttons), not swipes.
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_THRESHOLD_PX) return;

  if (Math.abs(deltaX) > Math.abs(deltaY)) move(deltaX > 0 ? 'right' : 'left');
  else move(deltaY > 0 ? 'down' : 'up');
});

/* ==========================================================================
 * Wiring
 * ======================================================================== */

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const actionElement = target.closest('[data-action]');
  if (!actionElement) return;

  switch (actionElement.dataset.action) {
    case 'new-game':
      newGame();
      break;
    case 'keep-going':
      keepPlaying();
      break;
    case 'close-game':
      window.location.assign(CLOSE_TARGET);
      break;
    default:
      break;
  }
});

// The board is server-rendered empty; the first render fills it and two tiles
// are spawned immediately.
if (gridElement) {
  newGame();
}
