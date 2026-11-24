/* =========================================================
   暗棋象棋 · 界面与交互（规则 v2）
   ========================================================= */
(function () {
  'use strict';

  const { Engine, RED, BLACK, NAMES, SIDE_NAME } = window.Xiangqi;

  /* ---------------- DOM ---------------- */
  const boardEl = document.getElementById('board');
  const piecesLayer = document.getElementById('pieces');
  const marksLayer = document.getElementById('marks');
  const svg = document.getElementById('boardSvg');

  const turnDot = document.getElementById('turnDot');
  const turnName = document.getElementById('turnName');
  const turnHint = document.getElementById('turnHint');
  const btnNew = document.getElementById('btnNew');
  const btnRules = document.getElementById('btnRules');
  const btnAgain = document.getElementById('btnAgain');
  const btnCloseRules = document.getElementById('btnCloseRules');
  const btnOkRules = document.getElementById('btnOkRules');
  const capRedEl = document.getElementById('capRed');
  const capBlackEl = document.getElementById('capBlack');
  const statHidden = document.getElementById('statHidden');
  const statRevealed = document.getElementById('statRevealed');
  const statCaptured = document.getElementById('statCaptured');
  const logEl = document.getElementById('log');
  const resultEl = document.getElementById('result');
  const resultGlyph = document.getElementById('resultGlyph');
  const resultTitle = document.getElementById('resultTitle');
  const resultSub = document.getElementById('resultSub');
  const rulesEl = document.getElementById('rules');
  const toastEl = document.getElementById('toast');

  /* ---------------- 状态 ---------------- */
  let game = new Engine();
  const els = new Map();     // pieceId -> DOM
  let selected = null;
  let legal = [];
  let busy = false;
  let token = 0;             // 防止旧动画回调影响新对局
  let toastTimer = 0;
  let lastMovedId = null;    // 上一步走动的棋子
  const pendingFlip = new Set(); // 等待“先走完再翻面”的暗子

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

    const rl = add('text', { x: X(2), y: Y(4) + 70, class: 'river', 'text-anchor': 'middle' });
    rl.textContent = '楚河';
    const rr = add('text', { x: X(6), y: Y(4) + 70, class: 'river', 'text-anchor': 'middle' });
    rr.textContent = '漢界';
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
        '<div class="face front"></div>' +
      '</div>';
    el.style.left = pctX(p.x);
    el.style.top = pctY(p.y);
    return el;
  }

  function revealPieceEl(el, p) {
    const front = el.querySelector('.front');
    front.textContent = NAMES[p.side][p.type];
    front.classList.add(p.side === RED ? 'red' : 'black');
    el.classList.add('revealed');
  }

  function syncPieces() {
    const alive = new Set(game.pieces.map(p => p.id));

    for (const [id, el] of els) {
      if (!alive.has(id)) {
        els.delete(id);
        el.classList.add('captured');
        setTimeout(() => el.remove(), 380);
      }
    }

    const warnKing = (!game.over && game.kingUnderAttack(game.turn))
      ? game.kingOf(game.turn)
      : null;

    for (const p of game.pieces) {
      let el = els.get(p.id);
      if (!el) {
        el = createPieceEl(p);
        els.set(p.id, el);
        piecesLayer.appendChild(el);
      }
      el.style.left = pctX(p.x);
      el.style.top = pctY(p.y);

      if (p.revealed && !el.classList.contains('revealed') && !pendingFlip.has(p.id)) {
        revealPieceEl(el, p);
      }

      el.classList.toggle('in-check', warnKing === p);
      el.classList.toggle('last-move', p.id === lastMovedId);
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

  /* ---------------- 状态栏 / 记录 / 战损 ---------------- */
  function updateStatus() {
    const side = game.turn;
    document.body.dataset.turn = side;
    turnDot.className = 'turn-dot ' + side;

    if (game.over) {
      turnName.textContent = '对局结束';
      turnHint.textContent = SIDE_NAME[game.winner] + '获胜 · ' + game.reason;
    } else {
      turnName.textContent = SIDE_NAME[side] + '行棋';
      let hint = '暗子按位置兵种直接走，走完翻面见真身';
      if (selected) {
        if (selected.revealed) {
          hint = '点击落点完成走子';
        } else {
          const t = game.templateAt(selected.x, selected.y);
          hint = '暗子按「' + NAMES[side][t] + '位」走法行走，走完自动翻面';
        }
      } else if (game.kingUnderAttack(side)) {
        hint = '将帅正受攻击，注意保护！';
      }
      turnHint.textContent = hint;
    }

    const hidden = game.hiddenCount();
    statHidden.textContent = hidden;
    statRevealed.textContent = game.pieces.length - hidden;
    statCaptured.textContent = game.captured.length;
  }

  function updateCaptured() {
    fillCap(capRedEl, game.captured.filter(p => p.side === RED));
    fillCap(capBlackEl, game.captured.filter(p => p.side === BLACK));
  }

  function fillCap(el, list) {
    el.innerHTML = '';
    if (!list.length) {
      const s = document.createElement('span');
      s.className = 'cap-empty';
      s.textContent = '—';
      el.appendChild(s);
      return;
    }
    for (const p of list) {
      const d = document.createElement('div');
      d.className = 'mini ' + p.side;
      d.textContent = NAMES[p.side][p.type];
      el.appendChild(d);
    }
  }

  function addLog(text, kind) {
    const li = document.createElement('li');
    li.className = 'log-item' + (kind ? ' ' + kind : '');
    li.textContent = text;
    logEl.prepend(li);
    while (logEl.children.length > 60) logEl.lastElementChild.remove();
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
    updateStatus();
  }

  function clearSelection(refresh) {
    if (selected) {
      const el = els.get(selected.id);
      if (el) el.classList.remove('selected');
    }
    selected = null;
    legal = [];
    marksLayer.innerHTML = '';
    if (refresh !== false) updateStatus();
  }

  /* ---------------- 行动 ---------------- */
  function finishTurn() {
    clearSelection(false);
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

    if (ev.type === 'own') {
      lastMovedId = null;
      busy = true;
      const tgt = ev.target;
      addLog(
        SIDE_NAME[mover] + '欲吃暗子，翻开是己方' +
        NAMES[tgt.side][tgt.type] + ' —— 不能吃自己人，行动取消',
        'warn'
      );
      toast('是己方暗子，不能吃');
      finishTurn();
      if (!game.over) turnHint.textContent = '翻开是己方暗子，行动取消';
      return;
    }

    lastMovedId = p.id;
    busy = true;

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

    clearSelection(false);
    syncPieces();
    updateCaptured();

    // 暗子：先走（或吃子），再翻面；翻面时再公布身份与战报
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
      if (p && !p.revealed) {
        selectPiece(p);
        return;
      }
      if (p && p.revealed && p.side === game.turn) {
        selectPiece(p);
        return;
      }
      clearSelection();
      return;
    }

    if (!p) return;

    if (!p.revealed) {
      selectPiece(p);
      return;
    }

    if (p.side === game.turn) {
      selectPiece(p);
    } else {
      toast('这是对方的棋子');
      shakeEl(p);
    }
  }

  boardEl.addEventListener('click', e => {
    if (busy || game.over) return;
    const sq = pointToSquare(e);
    if (!sq) return;
    handleSquare(sq.x, sq.y);
  });

  /* ---------------- 开局 / 结算 ---------------- */
  function startNewGame() {
    token++;
    busy = false;
    game = new Engine();
    els.clear();
    pendingFlip.clear();
    piecesLayer.innerHTML = '';
    marksLayer.innerHTML = '';
    logEl.innerHTML = '';
    selected = null;
    legal = [];
    lastMovedId = null;
    resultEl.classList.add('hidden');
    toastEl.classList.remove('show');

    fitCell();
    syncPieces();
    updateCaptured();
    updateStatus();
    addLog('新局开始 · 32 枚棋子随机落位，暗子按位置兵种行走', 'sys');
  }

  function requestNewGame() {
    if (!game.over && game.pieces.some(p => p.revealed)) {
      if (!window.confirm('当前对局尚未结束，确定重新开局？')) return;
    }
    startNewGame();
  }

  function showResult() {
    if (!game.over) return;
    const w = game.winner;
    resultGlyph.textContent = NAMES[w].K;
    resultGlyph.style.color = w === RED ? '#b3271f' : '#1e2a33';
    resultTitle.textContent = SIDE_NAME[w] + '胜';
    resultSub.textContent =
      game.reason === '擒王' ? '擒获对方将帅' : '对方无子可走';
    resultEl.classList.remove('hidden');
    updateStatus();
  }

  /* ---------------- 按钮 / 弹窗 ---------------- */
  btnNew.addEventListener('click', requestNewGame);
  btnAgain.addEventListener('click', startNewGame);

  const openRules = () => rulesEl.classList.remove('hidden');
  const closeRules = () => rulesEl.classList.add('hidden');

  btnRules.addEventListener('click', openRules);
  btnCloseRules.addEventListener('click', closeRules);
  btnOkRules.addEventListener('click', closeRules);

  rulesEl.addEventListener('click', e => {
    if (e.target === rulesEl) closeRules();
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!rulesEl.classList.contains('hidden')) closeRules();
      else if (selected) clearSelection();
    }
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
      if (rulesEl.classList.contains('hidden')) requestNewGame();
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
