/* =========================================================
   暗棋象棋 · 双边对弈界面
   ========================================================= */
(function () {
  'use strict';

  const { Engine, RED, BLACK, NAMES, SIDE_NAME } = window.Xiangqi;

  /* ---------------- DOM ---------------- */
  const boardEl = document.getElementById('board');
  const piecesLayer = document.getElementById('pieces');
  const marksLayer = document.getElementById('marks');
  const svg = document.getElementById('boardSvg');

  const zoneRed = document.getElementById('zoneRed');
  const zoneBlack = document.getElementById('zoneBlack');
  const dotRed = document.getElementById('dotRed');
  const dotBlack = document.getElementById('dotBlack');
  const stateRed = document.getElementById('stateRed');
  const stateBlack = document.getElementById('stateBlack');
  const trophiesRed = document.getElementById('trophiesRed');
  const trophiesBlack = document.getElementById('trophiesBlack');
  const undoRed = document.getElementById('undoRed');
  const undoBlack = document.getElementById('undoBlack');
  const menuRed = document.getElementById('menuRed');
  const menuBlack = document.getElementById('menuBlack');

  const btnNew = document.getElementById('btnNew');
  const btnRules = document.getElementById('btnRules');
  const btnLog = document.getElementById('btnLog');
  const btnFull = document.getElementById('btnFull');
  const btnCloseMenu = document.getElementById('btnCloseMenu');
  const btnCloseLog = document.getElementById('btnCloseLog');
  const btnAgain = document.getElementById('btnAgain');
  const btnCloseRules = document.getElementById('btnCloseRules');
  const btnOkRules = document.getElementById('btnOkRules');

  const logEl = document.getElementById('log');
  const menuModal = document.getElementById('menuModal');
  const logModal = document.getElementById('logModal');
  const rulesEl = document.getElementById('rules');
  const resultEl = document.getElementById('result');
  const resultGlyph = document.getElementById('resultGlyph');
  const resultTitle = document.getElementById('resultTitle');
  const resultSub = document.getElementById('resultSub');
  const toastEl = document.getElementById('toast');

  const captureFx = document.getElementById('captureFx');
  const cfIcon = document.getElementById('cfIcon');
  const cfTitle = document.getElementById('cfTitle');
  const cfSub = document.getElementById('cfSub');

  /* ---------------- 状态 ---------------- */
  let game = new Engine();
  const els = new Map();     // pieceId -> DOM
  let selected = null;
  let legal = [];
  let busy = false;
  let token = 0;
  let toastTimer = 0;
  let lastMovedId = null;
  const pendingFlip = new Set();

  let logEntries = [];
  const logStack = [];
  let cfTimer1 = 0;
  let cfTimer2 = 0;

  /* ---------------- 棋盘绘制 ---------------- */
  function buildBoard() {
    const NS = 'http://www.w3.org/2000/svg';
    const P = 50;
    const C = 100;
    const X = x => P + x * C;
    const Y = y => P + y * C;

    const add = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    };
    const line = (x1, y1, x2, y2, cls) =>
      add('line', { x1, y1, x2, y2, class: cls || 'grid' });

    add('rect', {
      x: X(0) - 15, y: Y(0) - 15,
      width: X(8) - X(0) + 30, height: Y(9) - Y(0) + 30,
      class: 'frame'
    });
    add('rect', {
      x: X(0), y: Y(0),
      width: X(8) - X(0), height: Y(9) - Y(0),
      class: 'frame-inner'
    });

    for (let y = 0; y < 10; y++) line(X(0), Y(y), X(8), Y(y));

    for (let x = 0; x < 9; x++) {
      if (x === 0 || x === 8) {
        line(X(x), Y(0), X(x), Y(9));
      } else {
        line(X(x), Y(0), X(x), Y(4));
        line(X(x), Y(5), X(x), Y(9));
      }
    }

    line(X(3), Y(0), X(5), Y(2));
    line(X(5), Y(0), X(3), Y(2));
    line(X(3), Y(7), X(5), Y(9));
    line(X(5), Y(7), X(3), Y(9));

    const marks = [
      [1, 2], [7, 2], [1, 7], [7, 7],
      [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
      [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]
    ];

    const g = 9;
    const l = 20;
    for (const [mx, my] of marks) {
      const cx = X(mx);
      const cy = Y(my);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          if ((mx === 0 && sx === -1) || (mx === 8 && sx === 1)) continue;
          add('path', {
            d: 'M ' + (cx + sx * g) + ' ' + (cy + sy * g) +
               ' h ' + (sx * l) +
               ' M ' + (cx + sx * g) + ' ' + (cy + sy * g) +
               ' v ' + (sy * l),
            class: 'mark'
          });
        }
      }
    }

    // 楚河：下方红方正向阅读；漢界：上方黑方阅读（旋转 180°）
    const rl = add('text', { x: X(2), y: Y(4) + 70, class: 'river', 'text-anchor': 'middle' });
    rl.textContent = '楚 河';

    const rr = add('text', {
      x: X(6),
      y: Y(4) + 70,
      class: 'river',
      'text-anchor': 'middle',
      transform: 'rotate(180 ' + X(6) + ' ' + (Y(4) + 55) + ')'
    });
    rr.textContent = '漢 界';
  }

  /* ---------------- 坐标换算 ---------------- */
  const pctX = x => ((x * 100 + 50) / 900 * 100) + '%';
  const pctY = y => ((y * 100 + 50) / 1000 * 100) + '%';

  function pointToSquare(e) {
    const r = boardEl.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * 900;
    const vy = ((e.clientY - r.top) / r.height) * 1000;
    const x = Math.round((vx - 50) / 100);
    const y = Math.round((vy - 50) / 100);
    if (x < 0 || x > 8 || y < 0 || y > 9) return null;
    const cx = 50 + x * 100;
    const cy = 50 + y * 100;
    if (Math.hypot(vx - cx, vy - cy) > 56) return null;
    return { x, y };
  }

  function fitCell() {
    const w = boardEl.clientWidth;
    if (w > 0) boardEl.style.setProperty('--cell', (w / 9).toFixed(2) + 'px');
  }

  /* ---------------- 棋子渲染 ---------------- */
  function createPieceEl(p) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.dataset.id = String(p.id);
    el.innerHTML =
      '<div class="piece-inner">' +
        '<div class="face back"></div>' +
        '<div class="face front"><span class="glyph"></span></div>' +
      '</div>';
    el.style.left = pctX(p.x);
    el.style.top = pctY(p.y);
    return el;
  }

  function revealPieceEl(el, p) {
    const front = el.querySelector('.front');
    const glyph = front.querySelector('.glyph');
    glyph.textContent = NAMES[p.side][p.type];
    front.classList.add(p.side === RED ? 'red' : 'black');
    el.classList.add('revealed');
  }

  function hidePieceEl(el) {
    el.classList.remove('revealed');
    const front = el.querySelector('.front');
    front.querySelector('.glyph').textContent = '';
    front.classList.remove('red', 'black');
  }

  function syncPieces() {
    const alive = new Set(game.pieces.map(p => p.id));

    for (const [id, el] of els) {
      if (!alive.has(id)) {
        els.delete(id);
        if (!el.classList.contains('captured')) {
          el.classList.add('captured');
          setTimeout(() => el.remove(), 900);
        }
      }
    }

    for (const p of game.pieces) {
      let el = els.get(p.id);
      if (!el) {
        el = createPieceEl(p);
        els.set(p.id, el);
        piecesLayer.appendChild(el);
      }
      el.style.left = pctX(p.x);
      el.style.top = pctY(p.y);

      // 暗子按阵营加光晕（位置归属）
      if (!p.revealed) {
        el.dataset.camp = game.effSide(p);
      } else {
        el.removeAttribute('data-camp');
      }

      if (p.revealed && !el.classList.contains('revealed') && !pendingFlip.has(p.id)) {
        revealPieceEl(el, p);
      } else if (!p.revealed && el.classList.contains('revealed')) {
        hidePieceEl(el);
      }

      el.classList.toggle('last-move', p.id === lastMovedId);
    }
  }

  /* ---------------- 吃子动画 ---------------- */
  function showCaptureFx(piece, by) {
    cfIcon.textContent = NAMES[piece.side][piece.type];
    cfIcon.className = 'cf-icon ' + piece.side;
    cfTitle.textContent = SIDE_NAME[by] + ' 吃子';
    cfSub.textContent = SIDE_NAME[piece.side] + NAMES[piece.side][piece.type];

    clearTimeout(cfTimer1);
    clearTimeout(cfTimer2);
    captureFx.classList.remove('hidden', 'show');
    void captureFx.offsetWidth;
    captureFx.classList.add('show');

    cfTimer1 = setTimeout(() => {
      captureFx.classList.remove('show');
      cfTimer2 = setTimeout(() => captureFx.classList.add('hidden'), 320);
    }, 1150);
  }

  function hideCaptureFx() {
    clearTimeout(cfTimer1);
    clearTimeout(cfTimer2);
    captureFx.classList.remove('show');
    captureFx.classList.add('hidden');
  }

  function animateCapture(piece, by) {
    const el = els.get(piece.id);
    if (el) {
      els.delete(piece.id);
      const front = el.querySelector('.front');
      front.querySelector('.glyph').textContent = NAMES[piece.side][piece.type];
      front.classList.add(piece.side === RED ? 'red' : 'black');
      el.classList.add('revealed', 'captured');
      setTimeout(() => el.remove(), 900);
    }
    showCaptureFx(piece, by);
  }

  /* ---------------- 状态 / 战利品 / 记录 ---------------- */
  function updateStatus() {
    const side = game.turn;
    document.body.dataset.turn = side;

    const redActive = !game.over && side === RED;
    const blackActive = !game.over && side === BLACK;

    zoneRed.classList.toggle('active', redActive);
    zoneBlack.classList.toggle('active', blackActive);

    stateRed.textContent = game.over
      ? (game.winner === RED ? '获胜' : '—')
      : (redActive ? '行棋' : '等待');
    stateBlack.textContent = game.over
      ? (game.winner === BLACK ? '获胜' : '—')
      : (blackActive ? '行棋' : '等待');

    dotRed.classList.toggle('live', redActive);
    dotBlack.classList.toggle('live', blackActive);

    undoRed.disabled = game.history.length === 0;
    undoBlack.disabled = game.history.length === 0;

    btnFull.textContent = isTheater() ? '退出全屏' : '全屏';
  }

  function fillTrophies(el, list) {
    el.innerHTML = '';
    if (!list.length) {
      const s = document.createElement('span');
      s.className = 'cap-empty';
      s.textContent = '暂无';
      el.appendChild(s);
      return;
    }
    for (const c of list) {
      const d = document.createElement('div');
      d.className = 'mini ' + c.side;
      d.textContent = NAMES[c.side][c.type];
      el.appendChild(d);
    }
  }

  function updateCaptured() {
    fillTrophies(trophiesRed, game.captured.filter(c => c.by === RED));
    fillTrophies(trophiesBlack, game.captured.filter(c => c.by === BLACK));
  }

  function renderLog() {
    logEl.innerHTML = '';
    for (let i = logEntries.length - 1; i >= 0; i--) {
      const e = logEntries[i];
      const li = document.createElement('li');
      li.className = 'log-item' + (e.kind ? ' ' + e.kind : '');
      li.textContent = e.text;
      logEl.appendChild(li);
    }
  }

  function addLog(text, kind) {
    logEntries.push({ text, kind });
    if (logEntries.length > 80) logEntries.shift();
    renderLog();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ---------------- 选中 / 落点 ---------------- */
  function renderMarks() {
    marksLayer.innerHTML = '';
    for (const [x, y] of legal) {
      const d = document.createElement('div');
      d.className = game.at(x, y) ? 'cap-ring' : 'move-dot';
      d.style.left = pctX(x);
      d.style.top = pctY(y);
      marksLayer.appendChild(d);
    }
  }

  function selectPiece(p) {
    if (selected) {
      const old = els.get(selected.id);
      if (old) old.classList.remove('selected');
    }
    selected = p;
    legal = game.movesFor(p, game.turn);
    const el = els.get(p.id);
    if (el) el.classList.add('selected');
    renderMarks();
  }

  function clearSelection() {
    if (selected) {
      const el = els.get(selected.id);
      if (el) el.classList.remove('selected');
    }
    selected = null;
    legal = [];
    marksLayer.innerHTML = '';
  }

  /* ---------------- 行动 ---------------- */
  function finishTurn() {
    clearSelection();
    syncPieces();
    updateCaptured();
    updateStatus();

    if (game.over) {
      addLog('对局结束：' + SIDE_NAME[game.winner] + '胜（' + game.reason + '）', 'sys');
      busy = true;
      const t = token;
      setTimeout(() => {
        if (t !== token) return;
        busy = false;
        showResult();
      }, 560);
      return;
    }

    busy = true;
    const t = token;
    setTimeout(() => {
      if (t === token) busy = false;
    }, 320);
  }

  function doMove(p, x, y) {
    const mover = game.turn;
    const ev = game.attempt(p, x, y);
    if (!ev) return;

    logStack.push(logEntries.slice());
    lastMovedId = p.id;
    busy = true;

    if (ev.captured) animateCapture(ev.captured, mover);

    const present = () => {
      let text = ev.text;
      if (ev.wasHidden) {
        text += '（翻面：' + SIDE_NAME[p.side] + NAMES[p.side][p.type] + '）';
      }
      if (ev.captured) {
        text += '，吃' + SIDE_NAME[ev.captured.side] + NAMES[ev.captured.side][ev.captured.type];
        if (ev.captured.side === mover) text += '（竟是自己人！）';
      }
      addLog(text, mover);

      if (ev.wasHidden && p.side !== mover) {
        toast('翻面：对方' + NAMES[p.side][p.type] + '，棋子归对方');
      } else if (ev.captured && ev.captured.side === mover) {
        toast('竟吃掉了自己人！');
      }

      finishTurn();
    };

    if (ev.wasHidden) pendingFlip.add(p.id);

    clearSelection();
    syncPieces();
    updateCaptured();

    if (ev.wasHidden) {
      const t = token;
      setTimeout(() => {
        if (t !== token) return;
        pendingFlip.delete(p.id);
        const el = els.get(p.id);
        if (el) revealPieceEl(el, p);
        present();
      }, 330);
    } else {
      present();
    }
  }

  /* ---------------- 点击处理 ---------------- */
  function handleSquare(x, y) {
    const p = game.at(x, y);

    if (selected) {
      if (legal.some(m => m[0] === x && m[1] === y)) {
        doMove(selected, x, y);
        return;
      }
      if (p === selected) {
        clearSelection();
        return;
      }
      if (p && game.effSide(p) === game.turn) {
        selectPiece(p);
        return;
      }
      clearSelection();
      return;
    }

    if (!p) return;

    if (game.effSide(p) === game.turn) {
      selectPiece(p);
    } else {
      toast('这是对方的棋子');
      shakeEl(p);
    }
  }

  function shakeEl(p) {
    const el = els.get(p.id);
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 420);
  }

  boardEl.addEventListener('click', e => {
    if (busy || game.over) return;
    const sq = pointToSquare(e);
    if (!sq) return;
    handleSquare(sq.x, sq.y);
  });

  /* ---------------- 开局 / 悔棋 / 结算 ---------------- */
  function startNewGame() {
    token++;
    busy = false;
    game = new Engine();
    els.clear();
    pendingFlip.clear();
    logStack.length = 0;
    logEntries = [];
    piecesLayer.innerHTML = '';
    marksLayer.innerHTML = '';
    logEl.innerHTML = '';
    selected = null;
    legal = [];
    lastMovedId = null;
    resultEl.classList.add('hidden');
    toastEl.classList.remove('show');
    hideCaptureFx();

    requestAnimationFrame(fitCell);
    syncPieces();
    updateCaptured();
    updateStatus();
    addLog('新局开始 · 32 枚棋子随机落位，暗子保留位置兵种与位置归属', 'sys');
  }

  function doUndo() {
    if (busy) {
      toast('等动画结束再悔棋');
      return;
    }
    if (!game.history.length) {
      toast('没有可悔的棋');
      return;
    }

    token++;
    pendingFlip.clear();
    hideCaptureFx();
    resultEl.classList.add('hidden');

    if (!game.undo()) return;

    piecesLayer.querySelectorAll('.piece.captured').forEach(el => el.remove());

    if (logStack.length) {
      logEntries = logStack.pop();
      renderLog();
    }
    lastMovedId = null;
    clearSelection();
    syncPieces();
    updateCaptured();
    updateStatus();
    toast('已悔棋');
  }

  function requestNewGame() {
    if (!game.over && game.pieces.some(p => p.revealed)) {
      if (!window.confirm('当前对局尚未结束，确定重新开局？')) return;
    }
    startNewGame();
  }

  function showResult() {
    if (!game.over) return;
    hideCaptureFx();
    const w = game.winner;
    resultGlyph.textContent = NAMES[w].K;
    resultGlyph.style.color = w === RED ? '#b3271f' : '#1e2a33';
    resultTitle.textContent = SIDE_NAME[w] + '胜';
    resultSub.textContent =
      game.reason === '擒王' ? '擒获对方将帅' :
      game.reason === '误食己方将帅' ? '对方误食自家将帅' : '对方无子可走';
    resultEl.classList.remove('hidden');
    updateStatus();
  }

  /* ---------------- 全屏 ---------------- */
  const isTheater = () => document.body.classList.contains('theater');

  function enterTheater() {
    document.body.classList.add('theater');
    updateStatus();
    requestAnimationFrame(fitCell);
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function exitTheater() {
    document.body.classList.remove('theater');
    updateStatus();
    requestAnimationFrame(fitCell);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function toggleTheater() {
    if (isTheater()) exitTheater();
    else enterTheater();
  }

  /* ---------------- 弹窗 ---------------- */
  function openMenu() { menuModal.classList.remove('hidden'); }
  function closeMenu() { menuModal.classList.add('hidden'); }
  function openLog() { renderLog(); logModal.classList.remove('hidden'); }
  function closeLog() { logModal.classList.add('hidden'); }
  function openRules() { rulesEl.classList.remove('hidden'); }
  function closeRules() { rulesEl.classList.add('hidden'); }

  function anyModalOpen() {
    return !menuModal.classList.contains('hidden') ||
           !logModal.classList.contains('hidden') ||
           !rulesEl.classList.contains('hidden');
  }

  /* ---------------- 绑定 ---------------- */
  menuRed.addEventListener('click', openMenu);
  menuBlack.addEventListener('click', openMenu);
  btnCloseMenu.addEventListener('click', closeMenu);
  btnNew.addEventListener('click', () => { closeMenu(); requestNewGame(); });
  btnRules.addEventListener('click', () => { closeMenu(); openRules(); });
  btnLog.addEventListener('click', () => { closeMenu(); openLog(); });
  btnFull.addEventListener('click', () => { closeMenu(); toggleTheater(); });

  btnCloseLog.addEventListener('click', closeLog);
  btnCloseRules.addEventListener('click', closeRules);
  btnOkRules.addEventListener('click', closeRules);

  undoRed.addEventListener('click', doUndo);
  undoBlack.addEventListener('click', doUndo);
  btnAgain.addEventListener('click', startNewGame);

  menuModal.addEventListener('click', e => { if (e.target === menuModal) closeMenu(); });
  logModal.addEventListener('click', e => { if (e.target === logModal) closeLog(); });
  rulesEl.addEventListener('click', e => { if (e.target === rulesEl) closeRules(); });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isTheater()) {
      document.body.classList.remove('theater');
      requestAnimationFrame(fitCell);
      updateStatus();
    }
  });

  window.addEventListener('keydown', e => {
    if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key === 'Escape') {
      if (!menuModal.classList.contains('hidden')) closeMenu();
      else if (!logModal.classList.contains('hidden')) closeLog();
      else if (!rulesEl.classList.contains('hidden')) closeRules();
      else if (isTheater()) exitTheater();
      else if (selected) clearSelection();
      return;
    }
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !anyModalOpen()) {
      requestNewGame();
    }
  });

  /* ---------------- 启动 ---------------- */
  buildBoard();

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fitCell).observe(boardEl);
  } else {
    window.addEventListener('resize', fitCell);
  }

  startNewGame();
})();
