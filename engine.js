/* =========================================================
 *  暗棋象棋 · 规则引擎（纯逻辑，无 DOM 依赖）
 *  ---------------------------------------------------------
 *  规则 v7：
 *  1. 红帅 (4,9)、黑将 (4,0)，以及双方的仕/士 (3,9)(5,9)/(3,0)(5,0)
 *     开局即明置并固定在九宫；其余 26 枚棋子（双方各 13 枚）完全随机暗置。
 *  2. 每个点位同时决定暗子的「位置兵种」与「位置归属」：
 *     - 走法 = 该点位的标准兵种；
 *     - 归属 = 该点位标准兵的所属方。
 *     暗子先按位置身份行走 / 吃子，走完自动翻面，恢复真实兵种与真实归属。
 *  3. 将帅、士限九宫；象可过河；其余棋子取消地域限制。
 *  4. 恢复将军 / 应将 / 将死：
 *     - 暗子按「位置身份」参与将军判定（位置兵种 + 位置归属是公开的）；
 *     - 不能走成己方被将军；
 *     - 被将军无解为将死，无子可走为困毙。
 *  5. 吃掉对方将帅同样判胜。
 * ========================================================= */
(function (root, factory) {
  const api = factory();
  root.Xiangqi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLS = 9;
  const ROWS = 10;
  const RED = 'r';
  const BLACK = 'b';

  const NAMES = {
    r: { K: '帥', A: '仕', E: '相', R: '車', H: '馬', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', R: '車', H: '馬', C: '砲', P: '卒' }
  };
  const SIDE_NAME = { r: '红方', b: '黑方' };

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const HORSE = [
    [1, 2, 0, 1], [2, 1, 1, 0], [2, -1, 1, 0], [1, -2, 0, -1],
    [-1, -2, 0, -1], [-2, -1, -1, 0], [-2, 1, -1, 0], [-1, 2, 0, 1]
  ];
  const ELEPHANT = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* 标准开局：32 个落点及该位置的兵种 */
  const STANDARD = [
    ['b', 'R', 0, 0], ['b', 'H', 1, 0], ['b', 'E', 2, 0], ['b', 'A', 3, 0], ['b', 'K', 4, 0],
    ['b', 'A', 5, 0], ['b', 'E', 6, 0], ['b', 'H', 7, 0], ['b', 'R', 8, 0],
    ['b', 'C', 1, 2], ['b', 'C', 7, 2],
    ['b', 'P', 0, 3], ['b', 'P', 2, 3], ['b', 'P', 4, 3], ['b', 'P', 6, 3], ['b', 'P', 8, 3],

    ['r', 'R', 0, 9], ['r', 'H', 1, 9], ['r', 'E', 2, 9], ['r', 'A', 3, 9], ['r', 'K', 4, 9],
    ['r', 'A', 5, 9], ['r', 'E', 6, 9], ['r', 'H', 7, 9], ['r', 'R', 8, 9],
    ['r', 'C', 1, 7], ['r', 'C', 7, 7],
    ['r', 'P', 0, 6], ['r', 'P', 2, 6], ['r', 'P', 4, 6], ['r', 'P', 6, 6], ['r', 'P', 8, 6]
  ];

  /* 位置兵种表：每个点位固定的兵种 */
  const TEMPLATE = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  /* 位置归属表：每个点位标准兵的所属方 */
  const POS_SIDE = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const [side, type, x, y] of STANDARD) {
    TEMPLATE[y][x] = type;
    POS_SIDE[y][x] = side;
  }

  const other = s => (s === RED ? BLACK : RED);
  const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

  /* 九宫：红方 x3-5 / y7-9，黑方 x3-5 / y0-2 */
  function inPalace(side, x, y) {
    if (x < 3 || x > 5) return false;
    return side === RED ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const fileOf = (side, x) => (side === RED ? 9 - x : x + 1);

  class Engine {
    constructor() {
      this.reset();
    }

    /* ---------------- 初始化 ---------------- */
    reset() {
      this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      this.pieces = [];
      this.captured = [];
      this.history = [];

      let id = 0;

      /* 将帅与士明置于九宫标准位置 */
      const fixed = [
        { side: RED, type: 'K', x: 4, y: 9 },
        { side: BLACK, type: 'K', x: 4, y: 0 },
        { side: RED, type: 'A', x: 3, y: 9 },
        { side: RED, type: 'A', x: 5, y: 9 },
        { side: BLACK, type: 'A', x: 3, y: 0 },
        { side: BLACK, type: 'A', x: 5, y: 0 }
      ];
      for (const g of fixed) {
        const p = {
          id: ++id,
          side: g.side,
          type: g.type,
          x: g.x,
          y: g.y,
          revealed: true,
          alive: true
        };
        this.pieces.push(p);
        this.grid[g.y][g.x] = p;
      }

      /* 其余 26 枚身份完全随机，落到除将帅/士外的 26 个点位 */
      const idents = [];
      for (const side of [BLACK, RED]) {
        for (const s of STANDARD) {
          if (s[0] === side && s[1] !== 'K' && s[1] !== 'A') {
            idents.push({ side, type: s[1] });
          }
        }
      }
      shuffle(idents);

      const squares = STANDARD
        .filter(s => s[1] !== 'K' && s[1] !== 'A')
        .map(s => [s[2], s[3]]);

      idents.forEach((d, i) => {
        const x = squares[i][0];
        const y = squares[i][1];
        const p = {
          id: ++id,
          side: d.side,
          type: d.type,
          x,
          y,
          revealed: false,
          alive: true
        };
        this.pieces.push(p);
        this.grid[y][x] = p;
      });

      this.turn = RED;
      this.over = false;
      this.winner = null;
      this.reason = '';
      this.lastEvent = null;
    }

    /* ---------------- 悔棋 ---------------- */
    snapshot() {
      return {
        pieces: this.pieces.map(p => ({
          id: p.id, side: p.side, type: p.type,
          x: p.x, y: p.y, revealed: p.revealed, alive: p.alive
        })),
        captured: this.captured.map(c => ({ side: c.side, type: c.type, by: c.by })),
        turn: this.turn,
        over: this.over,
        winner: this.winner,
        reason: this.reason
      };
    }

    undo() {
      if (!this.history.length) return false;
      const s = this.history.pop();
      this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      this.pieces = s.pieces.map(d => ({ ...d }));
      for (const p of this.pieces) this.grid[p.y][p.x] = p;
      this.captured = s.captured.map(c => ({ ...c }));
      this.turn = s.turn;
      this.over = s.over;
      this.winner = s.winner;
      this.reason = s.reason;
      this.lastEvent = null;
      return true;
    }

    /* ---------------- 基础查询 ---------------- */
    at(x, y) {
      return inB(x, y) ? this.grid[y][x] : null;
    }

    templateAt(x, y) {
      return inB(x, y) ? TEMPLATE[y][x] : null;
    }

    /* 暗子按位置身份；明子按真实身份 */
    effSide(p) {
      if (p.revealed) return p.side;
      return POS_SIDE[p.y][p.x] || p.side;
    }

    effType(p) {
      if (p.revealed) return p.type;
      return TEMPLATE[p.y][p.x] || p.type;
    }

    kingOf(side) {
      return this.pieces.find(p => p.alive && p.side === side && p.type === 'K' && p.revealed) || null;
    }

    hiddenCount() {
      return this.pieces.filter(p => !p.revealed).length;
    }

    sideCount(side) {
      return this.pieces.filter(p => p.side === side).length;
    }

    /* ---------------- 走法 ----------------
     * 暗子：位置兵种 + 位置归属；明子：真实兵种 + 真实归属。
     * 只能操作属于自己一方的棋子，只能吃对方的棋子。 */
    pseudoMoves(p) {
      const side = this.effSide(p);
      const type = this.effType(p);

      const out = [];
      const canCapture = q => this.effSide(q) !== side;

      const add = (x, y) => {
        if (!inB(x, y)) return;
        const q = this.grid[y][x];
        if (!q) out.push([x, y]);
        else if (canCapture(q)) out.push([x, y]);
      };

      switch (type) {
        case 'R': {
          for (const [dx, dy] of DIRS) {
            let x = p.x + dx;
            let y = p.y + dy;
            while (inB(x, y)) {
              const q = this.grid[y][x];
              if (!q) {
                out.push([x, y]);
              } else {
                if (canCapture(q)) out.push([x, y]);
                break;
              }
              x += dx;
              y += dy;
            }
          }
          break;
        }

        case 'C': {
          for (const [dx, dy] of DIRS) {
            let x = p.x + dx;
            let y = p.y + dy;
            let screen = false;
            while (inB(x, y)) {
              const q = this.grid[y][x];
              if (!screen) {
                if (!q) out.push([x, y]);
                else screen = true;
              } else if (q) {
                if (canCapture(q)) out.push([x, y]);
                break;
              }
              x += dx;
              y += dy;
            }
          }
          break;
        }

        case 'H': {
          for (const [dx, dy, lx, ly] of HORSE) {
            const bx = p.x + lx;
            const by = p.y + ly;
            if (!inB(bx, by) || this.grid[by][bx]) continue;
            add(p.x + dx, p.y + dy);
          }
          break;
        }

        case 'E': {
          for (const [dx, dy] of ELEPHANT) {
            const ex = p.x + dx / 2;
            const ey = p.y + dy / 2;
            if (!inB(ex, ey) || this.grid[ey][ex]) continue;
            add(p.x + dx, p.y + dy);
          }
          break;
        }

        case 'A': {
          for (const [dx, dy] of DIAG) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (inPalace(side, nx, ny)) add(nx, ny);
          }
          break;
        }

        case 'K': {
          for (const [dx, dy] of DIRS) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (inPalace(side, nx, ny)) add(nx, ny);
          }

          // 飞将：同列无子，可吃对方明将
          for (const dy of [-1, 1]) {
            let y = p.y + dy;
            let found = null;
            while (inB(p.x, y)) {
              const q = this.grid[y][p.x];
              if (q) {
                found = q;
                break;
              }
              y += dy;
            }
            if (found && Math.abs(found.y - p.y) > 1 &&
                found.revealed && found.side !== side && found.type === 'K') {
              out.push([found.x, found.y]);
            }
          }
          break;
        }

        case 'P': {
          const fwd = side === RED ? -1 : 1;
          const crossed = side === RED ? p.y <= 4 : p.y >= 5;
          const dirs = crossed
            ? [[0, -1], [0, 1], [1, 0], [-1, 0]]
            : [[0, fwd]];
          for (const [dx, dy] of dirs) add(p.x + dx, p.y + dy);
          break;
        }
      }

      const seen = new Set();
      return out.filter(([x, y]) => {
        const k = x + ',' + y;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    movesFor(p, side) {
      if (!p || !p.alive) return [];
      const s = side || this.turn;
      if (this.effSide(p) !== s) return [];       // 只能操作自己一方的棋
      return this.pseudoMoves(p);
    }

    /* 将军判定：明子按真实身份、暗子按位置身份参与 */
    isAttacked(x, y, by) {
      for (const q of this.pieces) {
        if (!q.alive || this.effSide(q) !== by) continue;
        for (const [mx, my] of this.pseudoMoves(q)) {
          if (mx === x && my === y) return true;
        }
      }
      return false;
    }

    inCheck(side) {
      const k = this.kingOf(side);
      return !!k && this.isAttacked(k.x, k.y, other(side));
    }

    /* 正在将军的棋子（UI 高亮用） */
    checkersOf(side) {
      const k = this.kingOf(side);
      if (!k) return [];
      const by = other(side);
      const out = [];
      for (const q of this.pieces) {
        if (!q.alive || this.effSide(q) !== by) continue;
        for (const [mx, my] of this.pseudoMoves(q)) {
          if (mx === k.x && my === k.y) { out.push(q); break; }
        }
      }
      return out;
    }

    /* 试走：暗子按位置身份（临时视为己方）落在目标点，检查己方是否被将军 */
    safeAfter(p, x, y, side) {
      const s = side || this.turn;
      const ox = p.x;
      const oy = p.y;
      const target = this.grid[y][x];
      const targetIdx = target ? this.pieces.indexOf(target) : -1;

      this.grid[oy][ox] = null;
      if (target) {
        this.grid[y][x] = null;
        if (targetIdx >= 0) this.pieces.splice(targetIdx, 1);
      }

      const wasRevealed = p.revealed;
      const wasSide = p.side;
      p.revealed = true;
      p.side = s;
      p.x = x;
      p.y = y;
      this.grid[y][x] = p;

      const ok = !this.inCheck(s);

      p.revealed = wasRevealed;
      p.side = wasSide;
      p.x = ox;
      p.y = oy;
      this.grid[oy][ox] = p;
      this.grid[y][x] = target;
      if (target && targetIdx >= 0) this.pieces.splice(targetIdx, 0, target);

      return ok;
    }

    /* 合法着法：位置身份允许，且不能把己方走成被将军 */
    legalMoves(p, side) {
      const s = side || this.turn;
      if (!p || !p.alive || this.effSide(p) !== s) return [];
      return this.pseudoMoves(p).filter(([x, y]) => this.safeAfter(p, x, y, s));
    }

    /* ---------------- 行动 ---------------- */
    hasAnyAction(side) {
      if (this.over) return false;
      for (const p of this.pieces) {
        if (!p.alive || this.effSide(p) !== side) continue;
        if (this.legalMoves(p, side).length > 0) return true;
      }
      return false;
    }

    notationWith(type, side, fromX, fromY, toX, toY) {
      const startFile = CN[fileOf(side, fromX) - 1];
      let action;
      let target;

      if (toY === fromY) {
        action = '平';
        target = CN[fileOf(side, toX) - 1];
      } else {
        const forward = side === RED ? toY < fromY : toY > fromY;
        action = forward ? '进' : '退';
        if (type === 'H' || type === 'E' || type === 'A') {
          target = CN[fileOf(side, toX) - 1];
        } else {
          target = CN[Math.abs(toY - fromY) - 1];
        }
      }

      return (side === RED ? '红' : '黑') + NAMES[side][type] + startFile + action + target;
    }

    /* 尝试走子：暗子先按位置兵种行走/吃子，走完自动翻面 */
    attempt(p, x, y) {
      if (this.over || !p || !p.alive) return null;

      const mover = this.turn;
      const moves = this.legalMoves(p, mover);
      if (!moves.some(m => m[0] === x && m[1] === y)) return null;

      this.history.push(this.snapshot());

      const wasHidden = !p.revealed;
      const templateType = wasHidden ? TEMPLATE[p.y][p.x] : null;

      if (wasHidden) p.revealed = true;

      return this.execMove(p, x, y, wasHidden, templateType, mover);
    }

    execMove(p, x, y, wasHidden, templateType, mover) {
      const target = this.grid[y][x];
      const fromX = p.x;
      const fromY = p.y;

      this.grid[fromY][fromX] = null;
      p.x = x;
      p.y = y;
      this.grid[y][x] = p;

      let captured = null;
      if (target) {
        target.alive = false;
        target.revealed = true;
        const idx = this.pieces.indexOf(target);
        if (idx >= 0) this.pieces.splice(idx, 1);
        this.captured.push({ side: target.side, type: target.type, by: mover });
        captured = target;
      }

      const text = wasHidden
        ? this.notationWith(templateType, mover, fromX, fromY, x, y)
        : this.notationWith(p.type, p.side, fromX, fromY, x, y);

      const ev = {
        type: 'move',
        piece: p,
        from: [fromX, fromY],
        to: [x, y],
        captured,
        text,
        wasHidden,
        templateType,
        mover
      };
      this.lastEvent = ev;

      if (captured && captured.type === 'K') {
        this.over = true;
        this.winner = other(captured.side);
        this.reason = captured.side === mover ? '误食己方将帅' : '擒王';
        return ev;
      }

      this.endTurn();
      return ev;
    }

    endTurn() {
      this.turn = other(this.turn);
      this.evaluate();
    }

    evaluate() {
      if (this.over) return;
      if (!this.hasAnyAction(this.turn)) {
        const checked = this.inCheck(this.turn);
        this.over = true;
        this.winner = other(this.turn);
        this.reason = checked ? '将死' : '困毙';
      }
    }
  }

  return { Engine, RED, BLACK, ROWS, COLS, NAMES, SIDE_NAME, STANDARD, TEMPLATE };
});
