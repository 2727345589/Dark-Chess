/* =========================================================
 *  暗棋象棋 · 规则引擎（纯逻辑，无 DOM 依赖）
 *  ---------------------------------------------------------
 *  规则 v3：
 *  1. 32 枚棋子（红黑 + 兵种）完全随机落在标准棋盘的 32 个点位上，
 *     全部背面朝上。
 *  2. 每个点位有一个固定的「位置兵种」= 标准布局中该位置的兵种。
 *     暗子按所在点位的兵种走法行走（方向按行棋方），可以吃明子，
 *     也可以吃暗子。
 *  3. 暗子走完（并结算吃子）后自动翻面，露出真实身份与归属；
 *     翻面后「恢复」它自己的兵种与归属，之后按真实身份行动
 *     —— 可能和刚才的走法完全不同。
 *  4. 翻面后若是对方棋子：它留在落点，归对方所有。
 *  5. 取消地域限制（象可过河、士可出宫、将可出宫）。
 *  6. 不设将军：吃掉对方将帅即胜；不能吃己方棋子（暗子翻开是己方则行动取消）。
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
  for (const [, type, x, y] of STANDARD) TEMPLATE[y][x] = type;

  const other = s => (s === RED ? BLACK : RED);
  const inB = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

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

      /* 身份完全打乱后随机落到 32 个标准点位 */
      const idents = STANDARD.map(([side, type]) => ({ side, type }));
      shuffle(idents);

      idents.forEach((d, i) => {
        const x = STANDARD[i][2];
        const y = STANDARD[i][3];
        const p = {
          id: i + 1,
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

    /* ---------------- 基础查询 ---------------- */
    at(x, y) {
      return inB(x, y) ? this.grid[y][x] : null;
    }

    templateAt(x, y) {
      return inB(x, y) ? TEMPLATE[y][x] : null;
    }

    /* 暗子：按位置兵种；明子：按真实兵种 */
    effectiveType(p) {
      return p.revealed ? p.type : TEMPLATE[p.y][p.x];
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
     * 暗子：位置兵种 + 行棋方方向（且吃子判定按行棋方）
     * 明子：真实兵种 + 自身归属 */
    pseudoMoves(p, asSide) {
      const revealed = p.revealed;
      const side = revealed ? p.side : (asSide || p.side);
      const type = revealed ? p.type : TEMPLATE[p.y][p.x];

      const out = [];
      const canCapture = q => !q.revealed || q.side !== side;

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
          for (const [dx, dy] of DIAG) add(p.x + dx, p.y + dy);
          break;
        }

        case 'K': {
          for (const [dx, dy] of DIRS) add(p.x + dx, p.y + dy);

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
      if (p.revealed) {
        return p.side === s ? this.pseudoMoves(p, s) : [];
      }
      return this.pseudoMoves(p, s);
    }

    /* 仅供提示：明将是否正被对方明子攻击 */
    isAttacked(x, y, by) {
      for (const q of this.pieces) {
        if (!q.alive || !q.revealed || q.side !== by) continue;
        for (const [mx, my] of this.pseudoMoves(q)) {
          if (mx === x && my === y) return true;
        }
      }
      return false;
    }

    kingUnderAttack(side) {
      const k = this.kingOf(side);
      return !!k && this.isAttacked(k.x, k.y, other(side));
    }

    /* ---------------- 行动 ---------------- */
    hasAnyAction(side) {
      if (this.over) return false;
      for (const p of this.pieces) {
        if (!p.alive) continue;
        if (p.revealed && p.side !== side) continue;
        if (this.pseudoMoves(p, side).length > 0) return true;
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
      const moves = this.movesFor(p, mover);
      if (!moves.some(m => m[0] === x && m[1] === y)) return null;

      /* 目标是与己方同阵营的暗子：不能吃，翻开它，行动取消 */
      const target = this.grid[y][x];
      if (target && !target.revealed && target.side === mover) {
        target.revealed = true;
        this.lastEvent = { type: 'own', piece: p, target };
        this.endTurn();
        return this.lastEvent;
      }

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
        this.captured.push(target);
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
        this.reason = '擒王';
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
        this.over = true;
        this.winner = other(this.turn);
        this.reason = '困毙';
      }
    }
  }

  return { Engine, RED, BLACK, ROWS, COLS, NAMES, SIDE_NAME, STANDARD, TEMPLATE };
});
