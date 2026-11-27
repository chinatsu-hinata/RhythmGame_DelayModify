/*
 * offset-calibrator / core.js
 * 纯计算：不碰 DOM、不联网。浏览器里挂到 window.OffsetCore，Node 里挂到 globalThis。
 *
 * ── 游戏表（每个游戏怎么描述自己的判定）──────────────────────────
 *   {
 *     "CHUNITHM": {
 *       "a0": true,              // 支持音频延迟
 *       "a1": true,              // 支持判定延迟
 *       "tiers": [
 *         { "name": "JUSTICE", "role": "center", "dir": true },  // 正中档，这档数字里含早/晚
 *         { "name": "ATTACK",  "role": "near" },
 *         { "name": "MISS",    "role": "miss" }
 *       ]
 *     }
 *   }
 *   role：center 正中 / near 近 / far 远 / miss 漏
 *   dir ：纯标记 —— 这一档的数字里是否包含 fast / late（早 / 晚）。
 *         不产生额外输入框，也不参与换算；玩家只填结算上显示的数字。
 *
 *   老格式仍然能读：[[支持音频, 支持判定], ["Perfect", "Good", "Bad", "Miss"]]
 *   会按「第一个 = 正中、最后一个 = 漏、中间 = 近」自动补 role。
 *
 * ── 一局 = 一个 run ──────────────────────────────────────────────
 *   { game: 'CHUNITHM', tiers: [{ n: 1050 }, { n: 30 }, { n: 10 }], a0: 0, a1: 30 }
 *   n = 这一档的数量（就是结算上显示的数字，不拆早/晚）
 *
 * ── 指标 ────────────────────────────────────────────────────────
 *   命中率 p    = 正中档数量 / 总音符        ← strict 只算最严档，inclusive 合所有正中档
 *   环带占比    = (总音符 − 正中档) / 总音符  ← 丢档率，越小越稳
 */
(function (root) {
  'use strict';

  /* ── 内置游戏表（不读任何外部文件） ─────────────────────────── */
  var DEFAULT_GAMES = {
    'Phigros': {
      a0: true, a1: false,
      tiers: [
        { name: 'Perfect', role: 'center' },
        { name: 'Good', role: 'near' },
        { name: 'Bad', role: 'far' },
        { name: 'Miss', role: 'miss' }
      ]
    },
    'Arcaea/韵律源点': {
      a0: true, a1: false,fl:true,
      tiers: [
        // Pure = 游戏的 Perfect 档，内部还分大P(±25ms)/小P，结算只给合计数 → 按合计算，边界取小P
        { name: 'Pure', role: 'center', ms: 50 },
        { name: 'Far', role: 'near' },
        { name: 'Lost', role: 'miss' }
      ]
    },
    'CHUNITHM/中二节奏': {
      a0: true, a1: true, fl: true,
      tiers: [
        {name:"Justice Critical", role:"center",ms:33},
        { name: 'JUSTICE', role: 'center',ms:67}, 
        { name: 'ATTACK', role: 'near',ms:100},
        { name: 'MISS', role: 'miss' }
      ]
    },
    'maimaiDX/舞萌DX': {
      a0: true, a1: true, fl: true, frame: 16.6667, // 60fps 一帧；大P正好=1帧、小P=3帧
      tiers: [
        {name:"Critical", role:"center",ms:17}, //大P=16.666ms
        { name: 'Perfect', role: 'center',ms:50},
        { name: 'Great', role: 'near',ms:100 },
        { name: 'Good', role: 'far',ms:150},
        { name: 'Miss', role: 'miss' }
      ]
    },
    'Vivid/Stasis':{
      a0:true,a1:true,
      tiers:[
        {name:'Critical',role:'center',dir:true,ms:70},
        {name:'Great',role:'near',ms:110},
        {name: 'Good', role: 'far',ms:[-200,150]},
        {name: 'Miss', role: 'miss' }
      ]
    },
    "Project SEKAI/世界计划":{
      a0:false,a1:true,fl:true,
      tiers:[
        { name: 'Perfect', role: 'center',ms:42},
        { name: 'Great', role: 'near',ms:84},
        { name: 'Good', role: 'far',ms:109},
        {name:"Bad",role:"far",ms:125},
        { name: 'Miss', role: 'miss' }
      ]
    },
    "Rotaeno/旋转音律":{
      a0:true,a1:false,fl:true,
      tiers:[
        {name:"Perfect+",role:'center'},
        { name: 'Perfect', role: 'near'},
        { name: 'Good', role: 'far' },
        { name: 'Miss', role: 'miss' }
      ]
    },
    "O.N.G.E.K.I./音击":{
      a0: true, a1: true, fl: true,
      tiers: [
        {name:"Critical Break", role:"center"},
        { name: 'Break', role: 'center'}, 
        { name: 'Hit', role: 'near' },
        { name: 'MISS', role: 'miss' }
      ]
    },
    "Paradigm Reboot/范式起源":{
      a0: true, a1: true,
      tiers: [
        {name:"Decrypted", role:"center"},
        { name: 'Received', role: 'near' },
        { name: 'MISS', role: 'miss' }
      ]
    },
    "Muse Dash/喵斯快跑":{
      a0: true, a1: false, fl:true,
      tiers: [
        {name:"Perfect", role:"center",ms:50},
        { name: 'Great', role: 'near',ms:130},
        { name: 'Miss', role: 'miss'}
      ]
    },
    "World Dai Star/演剧星世界":{
      a0: true, a1: false, fl:true,
      tiers: [
        {name:"Perfect+", role:"center",ms:25},
        { name: 'Perfect', role: 'center',ms:40},
        { name: 'Great', role: 'near',ms:70},
        {name:"Good",role:"far",ms:100},
        {name:"Bad",role:"far",ms:125},
        {name:"Miss",role:"Miss"}
      ]
    },
    "TAKUMI3":{
      a0: true, a1: true, fl:true,
      tiers: [
        {name:"JUST(Rainbow)", role:"center"},
        {name:"Just(Yellow)",role:"center"},
        { name: 'GOOD', role: 'near'},
        {name:"OK",role:"far"},
        {name:"Miss",role:"Miss"}
      ]
    },
    "Lanota/调律诗篇":{
      a0: true, a1: false, fl:false,
      tiers: [
        {name:"Harmony", role:"center"},,
        { name: 'Tune', role: 'near'},
        {name:"Fail",role:"Miss"}
      ]
    },
    "Cytus II":{
      a0: false, a1: true, fl:false,
      tiers: [
        {name:"Perfect", role:"center"},
        { name: 'Good', role: 'near'},
        {name:"Bad",role:"far"},
        {name:"Miss",role:"Miss"}
      ]
    },
  };

  var ROLE_LABEL = { center: '正中', near: '近', far: '远', miss: '漏' };





  /* ── 小工具 ──────────────────────────────────────────────── */

  function toInt(v) {
    var n = Math.floor(Number(v));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function roleOf(v) {
    var r = String(v == null ? '' : v).trim().toLowerCase();
    return ROLE_LABEL[r] ? r : '';
  }

  // 判定窗口：单数 n → [n, n]（对称）；[早, 晚] → 两侧都取正数（写 [-150, 200] 也认）
  function normalizeWindow(raw) {
    if (raw == null) return null;
    if (Array.isArray(raw)) {
      if (raw.length < 2) return null;
      var early = Math.abs(Number(raw[0]));
      var late = Math.abs(Number(raw[1]));
      if (!isFinite(early) || !isFinite(late)) return null;
      if (!(early > 0) || !(late > 0)) return null;
      return [early, late];
    }
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return null;
    return [n, n];
  }

  function cleanTier(raw) {
    if (raw == null) return null;

    var name, role, dir, ms, nest;
    if (typeof raw === 'string') {
      name = raw.trim();
      role = '';
      dir = false;
      ms = null;
      nest = false;
    } else if (typeof raw === 'object') {
      name = String(raw.name == null ? '' : raw.name).trim();
      role = roleOf(raw.role);
      dir = raw.dir === true || raw.hasDir === true || raw.direction === true;
      ms = normalizeWindow(raw.ms);
      // nest：「这一档的数字里包含上面（更窄）那几档」，填结算原数字即可，程序自动做减法
      nest = raw.nest === true || raw.contains === true || raw.overlap === true;
    } else {
      return null;
    }
    if (!name) return null;

    return { name: name, role: role, dir: !!dir, ms: ms, nest: !!nest };
  }

  /* ── 游戏表 ──────────────────────────────────────────────── */

  function normalizeGames(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;

    Object.keys(raw).forEach(function (key) {
      var name = String(key == null ? '' : key).trim();
      if (!name) return;

      var entry = raw[key];
      var a0 = false;
      var a1 = false;
      var fl = false;
      var list = [];
      var legacy = false;

      if (Array.isArray(entry)) {
        // 老格式：[[a0, a1], ['Perfect', 'Good', ...]]
        if (entry.length < 2) return;
        var flags = entry[0];
        if (!Array.isArray(flags) || flags.length < 2) return;
        a0 = flags[0] === true;
        a1 = flags[1] === true;
        list = Array.isArray(entry[1]) ? entry[1] : [];
        legacy = true;
      } else if (entry && typeof entry === 'object') {
        a0 = entry.a0 === true || entry.audio === true;
        a1 = entry.a1 === true || entry.judgment === true || entry.visual === true;
        // fl：结算画面上有没有「整局一对」的 Fast / Late 计数（与档位的 dir 是两件事）
        fl = entry.fl === true || entry.fastLate === true || entry.hasFastLate === true;
        if (Array.isArray(entry.tiers)) list = entry.tiers;
        else if (Array.isArray(entry.judging)) { list = entry.judging; legacy = true; }
      } else {
        return;
      }

      if (!a0 && !a1) return;               // 两栏都不支持的游戏不显示

      var tiers = list.map(cleanTier).filter(Boolean);
      if (!tiers.length) return;

      if (legacy) {
        tiers.forEach(function (t, i) {
          if (t.role) return;
          if (i === 0) t.role = 'center';
          else if (i === tiers.length - 1) t.role = 'miss';
          else t.role = 'near';
        });
      }
      if (!tiers.some(function (t) { return t.role === 'center'; })) tiers[0].role = 'center';

      // 兼容：老表只标了档位级 dir、没写游戏级 fl —— 那就当作「这局有 Fast/Late」
      if (!fl) fl = tiers.some(function (t) { return t.dir; });

      out[name] = {
        a0: a0, a1: a1, tiers: tiers, fl: fl,
        // frame：一帧多少 ms（可选）。有的话，建议值会取整到帧 —— 街机判定按帧，1ms 的差别没有意义
        frame: (entry && !Array.isArray(entry) && Number(entry.frame) > 0) ? Number(entry.frame) : 0
      };
    });

    return out;
  }

  function gameNames(games) { return Object.keys(games || {}); }

  function gameInfo(games, game) {
    var g = games && games[game];
    if (!g) return { a0: false, a1: false, tiers: [], centerCount: 0, hasDir: false, fl: false };

    var tiers = g.tiers.map(function (t) {
      return {
        name: t.name, role: t.role, dir: !!t.dir, nest: !!t.nest,
        ms: t.ms ? t.ms.slice() : null
      };
    });

    return {
      a0: !!g.a0,
      a1: !!g.a1,
      tiers: tiers,
      centerCount: tiers.filter(function (t) { return t.role === 'center'; }).length,
      hasDir: tiers.some(function (t) { return t.dir; }),
      fl: !!g.fl,
      frame: Number(g.frame) > 0 ? Number(g.frame) : 0
    };
  }

  function centerNames(games, game) {
    return gameInfo(games, game).tiers
      .filter(function (t) { return t.role === 'center'; })
      .map(function (t) { return t.name; });
  }

  function axisSupport(games, game) {
    var info = gameInfo(games, game);
    return { a0: info.a0, a1: info.a1 };
  }

  function supportedAxes(games, game) {
    var s = axisSupport(games, game);
    return ['a0', 'a1'].filter(function (k) { return s[k]; });
  }

  function axisLabel(axis) {
    return axis === 'a0' ? '音频延迟' : '判定延迟';
  }

  function axisValue(run, axis) {
    return Number(axis === 'a1' ? run.a1 : run.a0) || 0;
  }

  function modeLabel(mode) {
    return mode === 'inclusive' ? '正中档合并' : '只用最严档';
  }

  /* ── 单局指标 ────────────────────────────────────────────── */

  function normalizeRows(run, info) {
    var src = run && Array.isArray(run.tiers) ? run.tiers : [];
    var seen = 0;                     // 上面几档已经数过的数量（给 nest 档做减法）

    return info.tiers.map(function (t, i) {
      var raw = src[i] || {};
      var n = toInt(raw.n);
      // nest 档：玩家填的是结算原数字（包含上面更窄的档），这里换成「只属于它自己的部分」
      var eff = t.nest ? Math.max(0, n - seen) : n;
      seen += eff;
      return { name: t.name, role: t.role, dir: t.dir, nest: t.nest, n: eff, raw: n };
    });
  }

  function computeMetrics(run, games, mode) {
    var info = gameInfo(games, run && run.game);
    var rows = normalizeRows(run, info);

    var total = rows.reduce(function (a, r) { return a + r.n; }, 0);

    // 命中档 = 除了 Miss 以外的所有档（正中 / 近 / 远）
    var hitN = rows.reduce(function (a, r) {
      return a + (r.role === 'miss' ? 0 : r.n);
    }, 0);

    // 整局一对 Fast / Late：它们覆盖所有命中档，所以从「命中总数」里扣
    var f = Math.min(Math.max(0, toInt(run && run.f)), hitN);
    var s = Math.min(Math.max(0, toInt(run && run.s)), hitN - f);
    var directional = (f + s) > 0;

    var centers = rows.filter(function (r) { return r.role === 'center'; });
    var centerN = centers.reduce(function (a, r) { return a + r.n; }, 0);
    var strictN = centers[0] ? centers[0].n : 0;

    var hasDir = info.hasDir;
    // 游戏声明「结算有 Fast/Late」（游戏级 fl）但一个都没填：命中率会偏高，界面要给提示
    var partial = info.fl && !directional && hitN > 0;

    // 有 Fast/Late 时：正中 = 命中总数 − 早 − 晚（所有命中档一起看）
    // 没有时：沿用「正中档 / 总音符」，并可切「只用最严档 / 正中档合并」
    var pStrict, pInclusive, edge;
    if (directional) {
      var onTime = Math.max(0, hitN - f - s);
      pStrict = total > 0 ? onTime / total : 0;
      pInclusive = pStrict;
      edge = onTime;
    } else {
      pStrict = total > 0 ? strictN / total : 0;
      pInclusive = total > 0 ? centerN / total : 0;
      edge = (mode === 'inclusive' && centers.length > 1) ? centerN : strictN;
    }

    var m = mode === 'inclusive' && centers.length > 1 ? 'inclusive' : 'strict';

    return {
      rows: rows,
      counts: rows.map(function (r) { return r.n; }),   // 老界面还按数组用
      total: total,
      hitN: hitN,
      centerN: centerN,
      strictN: strictN,
      fast: f,
      late: s,
      directional: directional,
      hasDir: hasDir,
      partial: partial,
      p: m === 'inclusive' ? pInclusive : pStrict,
      pStrict: pStrict,
      pInclusive: pInclusive,
      ring: total > 0 ? (total - edge) / total : 0,
      w: NaN,
      mode: m,
      centerCount: centers.length
    };
  }

  /* ── 按轴值分组 ──────────────────────────────────────────── */

  function groupRuns(runs, axis, games, mode) {
    var buckets = new Map();

    (runs || []).forEach(function (run) {
      var x = axisValue(run, axis);
      if (!buckets.has(x)) buckets.set(x, []);
      buckets.get(x).push(computeMetrics(run, games, mode));
    });

    var groups = [];
    buckets.forEach(function (list, x) {
      var n = list.length;
      var mean = list.reduce(function (a, m) { return a + m.p; }, 0) / n;
      var sd = 0;
      if (n > 1) {
        var ss = list.reduce(function (a, m) { return a + (m.p - mean) * (m.p - mean); }, 0);
        sd = Math.sqrt(ss / (n - 1));
      }
      var ringMean = list.reduce(function (a, m) { return a + m.ring; }, 0) / n;

      groups.push({
        axis: x,
        n: n,
        mean: mean,
        sd: sd,
        ring: ringMean,
        w: NaN,
        spread: Math.max.apply(null, list.map(function (m) { return m.p; })) -
          Math.min.apply(null, list.map(function (m) { return m.p; }))
      });
    });

    groups.sort(function (a, b) { return a.axis - b.axis; });
    return groups;
  }

  /* ── 拟合 ────────────────────────────────────────────────── */

  // 加权最小二乘拟合 y = a + b·x + c·x²（权重一般给局数 n）
  function poly2(points) {
    var pts = (points || []).filter(function (p) {
      return p && isFinite(p.x) && isFinite(p.y);
    });
    if (pts.length < 3) return null;

    var M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    pts.forEach(function (p) {
      var w = isFinite(p.w) && p.w > 0 ? p.w : 1;
      var basis = [1, p.x, p.x * p.x];
      for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) M[i][j] += w * basis[i] * basis[j];
        M[i][3] += w * basis[i] * p.y;
      }
    });

    for (var col = 0; col < 3; col++) {
      var pivot = col;
      for (var r = col + 1; r < 3; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-12) return null;
      var tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;

      for (var r2 = 0; r2 < 3; r2++) {
        if (r2 === col) continue;
        var k = M[r2][col] / M[col][col];
        for (var c2 = col; c2 < 4; c2++) M[r2][c2] -= k * M[col][c2];
      }
    }

    return {
      a: M[0][3] / M[0][0],
      b: M[1][3] / M[1][1],
      c: M[2][3] / M[2][2]
    };
  }

  // 过三点的抛物线：返回顶点位置与顶点值（三点内部精修用）
  function quad3(p1, p2, p3) {
    var x1 = p1.x, x2 = p2.x, x3 = p3.x;
    var y1 = p1.y, y2 = p2.y, y3 = p3.y;
    if (x1 === x2 || x2 === x3 || x1 === x3) return null;

    var d1 = (y2 - y1) / (x2 - x1);
    var d2 = (y3 - y2) / (x3 - x2);
    var c = (d2 - d1) / (x3 - x1);
    if (!isFinite(c) || Math.abs(c) < 1e-12) return null;

    var b = d1 - c * (x1 + x2);
    var a = y1 - b * x1 - c * x1 * x1;
    var vx = -b / (2 * c);
    var vy = a + b * vx + c * vx * vx;
    return { x: vx, y: vy, a: a, b: b, c: c };
  }

  function percentile(arr, q) {
    if (!arr.length) return NaN;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var pos = (s.length - 1) * q;
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  // 确定性随机：同一批数据每次重采样走同一条路径。
  // 原来用 Math.random()，点一次「重新分析」结论会晃，用户会以为数据变了。
  function hashSeed(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 组内重采样，给顶点一个 5%~95% 区间（不做任何分布假设）
  function bootstrapVertex(runs, axis, games, mode, iterations) {
    var times = iterations || 600;
    var byAxis = new Map();

    (runs || []).forEach(function (run) {
      var x = axisValue(run, axis);
      if (!byAxis.has(x)) byAxis.set(x, []);
      byAxis.get(x).push(computeMetrics(run, games, mode));
    });

    var keys = Array.from(byAxis.keys());
    if (keys.length < 3) return null;

    // 种子取自数据本身：同样的记录永远得到同样的区间
    var rng = makeRng(hashSeed(keys.map(function (x) {
      return x + ':' + byAxis.get(x).map(function (t) { return t.p.toFixed(6); }).join(',');
    }).join('|')));

    var vertices = [];
    for (var t = 0; t < times; t++) {
      var pts = keys.map(function (x) {
        var list = byAxis.get(x);
        var sum = 0;
        for (var i = 0; i < list.length; i++) {
          sum += list[Math.floor(rng() * list.length)].p;
        }
        return { x: x, y: sum / list.length, w: list.length };
      });
      var fit = poly2(pts);
      if (!fit || !(fit.c < 0)) continue;
      var v = -fit.b / (2 * fit.c);
      if (isFinite(v)) vertices.push(v);
    }
    if (vertices.length < 20) return null;

    var lo = percentile(vertices, 0.05);
    var hi = percentile(vertices, 0.95);
    return {
      lo: lo,
      hi: hi,
      samples: vertices.length,
      // 每组只有 1 局时，重采样只会抽到同一个值 → 区间退化成一点。
      // 这种「宽度 0」不是「很准」，是「没测过抖动」，必须单独标出来。
      degenerate: !(hi > lo)
    };
  }

  /* ── 结论 ────────────────────────────────────────────────── */

  // 相邻轴值的最小间隔（= 你实际测出来的分辨率），用来判断"差一点"到底差多少
  function axisStep(groups) {
    var xs = groups.map(function (g) { return g.axis; }).sort(function (a, b) { return a - b; });
    var step = Infinity;
    for (var i = 1; i < xs.length; i++) step = Math.min(step, xs[i] - xs[i - 1]);
    return isFinite(step) && step > 0 ? step : 1;
  }

  // 轴值单位：绝对值 > 1.5 当成毫秒，否则当成秒。返回「1 毫秒 = 多少个轴值单位」。
  function msUnit(groups) {
    var big = 0;
    groups.forEach(function (g) { big = Math.max(big, Math.abs(g.axis)); });
    return big <= 1.5 ? 0.001 : 1;
  }

  // 显示用的数字格式：轴值是毫秒（绝对值 > 1.5）就保留 1 位小数，是秒就保留 4 位小数。
  // 不能一律按 1 位小数取整 —— 秒制下 0.0858 会被写成 0.1，差 14ms。
  function fmtAxis(v, groups) {
    return Number(v).toFixed(msUnit(groups) === 0.001 ? 4 : 1);
  }

  function analyze(runs, axis, games, mode) {
    var groups = groupRuns(runs, axis, games, mode);
    var warnings = [];
    var reasons = [];

    groups.forEach(function (g) {
      if (g.n < 2) {
        warnings.push('轴值 ' + g.axis + ' 只有 1 局 —— 看不出波动，建议再补一局。');
      } else if (g.spread > 0.05) {
        warnings.push('轴值 ' + g.axis + ' 两局差 ' + (g.spread * 100).toFixed(1) +
          ' 个百分点 —— 超过 5 个点说明状态不稳，这组别太当真。');
      }
    });

    if (!groups.length) {
      return { verdict: 'insufficient', groups: groups, best: null, warnings: warnings, reasons: [] };
    }

    var best = groups.reduce(function (a, b) { return b.mean > a.mean ? b : a; });

    if (groups.length < 3) {
      reasons.push('目前只有 ' + groups.length + ' 个轴值 —— 至少 3 个（最好各 2 局）才能看出形状。');
      reasons.push('先按「' + (best.axis > 0 ? '+' : '') + best.axis + '」附近再测两个值试试。');
      return {
        verdict: 'insufficient', insufficientKind: 'axes', groups: groups, best: best,
        warnings: warnings, reasons: reasons
      };
    }

    // 每组只有 1 局：组内没有重复 → 重采样抽不到别的值、区间会退化成一个点，
    // 所以「重复性」只能是 unknown（不再因此拒绝出结论 —— 3 个轴值在数学上已经
    // 唯一确定一条抛物线，用户要的是这个数；不给的只是「它稳不稳」这个附加信息）。

    // 权重用 sqrt(局数)，不是局数本身：迭代时用户会在顶点那一组反复打，
    // 若按局数加权，那个点会被越拽越牢（加权最小二乘的必然结果）——
    // 顶点变成「我在哪测得多」而不是「峰在哪」。开方只是压平这个偏向，不消灭它。
    // 3 个轴值时权重不起作用：3 点恰好定解，任何正权重都得到同一条抛物线。
    var fit = poly2(groups.map(function (g) {
      return { x: g.axis, y: g.mean, w: Math.sqrt(g.n) };
    }));

    var lo = groups[0].axis;
    var hi = groups[groups.length - 1].axis;

    if (fit && fit.c < 0) {
      var peak = -fit.b / (2 * fit.c);
      if (isFinite(peak) && peak >= lo && peak <= hi) {
        var boot = bootstrapVertex(runs, axis, games, mode);
        var hs = axisStep(groups) / 2;
        // 显示用的区间 = 顶点 ± 半个最小刻度（你实际测出来的分辨率），再夹在测过的范围里。
        // 抛物线的顶点保留小数：小刻度的延迟（例如 0.085）不能被取整成 0。
        var range = [Math.max(lo, peak - hs), Math.min(hi, peak + hs)];
        if (!(range[1] > range[0])) range = [peak, peak];

        // 「重复性」只说一件事：同样的设置重打一局，这个数会晃多少。
        // 它不包含「模型选错了」的那部分误差，所以不叫置信度。组内没有重复时给 unknown。
        // 阈值 8ms / 18ms 是按毫秒写的，要先把区间宽度换成毫秒再比 —— 否则秒制下
        // 宽度 0.0013 永远 ≤ 8，重复性永远是「高」。
        var wms = boot && !boot.degenerate ? (boot.hi - boot.lo) / msUnit(groups) : 0;
        var repeatability = !boot || boot.degenerate ? 'unknown'
          : wms <= 8 ? 'high'
            : wms <= 18 ? 'medium' : 'low';

        // 测过的跨度不到建议区间宽的两倍 —— 顶点有一部分是外推出来的，得说清楚
        var span = hi - lo;
        var width = Math.max(0, range[1] - range[0]);
        if (width > 0 && span < 2 * width) {
          warnings.push('测过的轴值跨度（' + span + '）不到建议区间宽的两倍 —— 顶点有一半是靠外推的，' +
            '想更稳就把两端各再打远一点。');
        }

        reasons.push('把 ' + groups.length + ' 个轴值的平均命中率（' + modeLabel(mode) + '）拟成抛物线，顶点在 ' +
          fmtAxis(peak, groups) + '。');
        if (boot && !boot.degenerate) {
          reasons.push('重采样 ' + boot.samples + ' 次，顶点在 ' + fmtAxis(boot.lo, groups) + ' ~ ' + fmtAxis(boot.hi, groups) +
            ' 之间晃（同一批数据每次算出来一样）。这个宽度只回答「重打几局会抖多少」，不含模型误差。');
        } else {
          reasons.push('组内没有重复局，重采样抽不到别的值、退化成一点 —— 所以不给重复性，只按区间用。');
        }
        if (Math.abs(best.axis - peak) > axisStep(groups) / 2) {
          reasons.push('实测最好的是 ' + best.axis + '（' + (best.mean * 100).toFixed(1) +
            '%），和顶点差一点，属正常波动。');
        }

        return {
          verdict: 'peak',
          value: peak,
          range: range,
          confidence: repeatability,
          repeatability: repeatability,
          groups: groups,
          best: best,
          warnings: warnings,
          reasons: reasons
        };
      }
      reasons.push('拟合出来的顶点跑到测试范围外面了 —— 说明真实最优点不在你测过的区间里。');
    } else {
      reasons.push('这几组数据拟不出开口向下的曲线 —— 可能是波动太大，或轴值方向反了。');
    }

    // 兜底：拿最好的那组和左右邻点做三点精修
    var idx = groups.indexOf(best);
    var refined = null;
    if (idx > 0 && idx < groups.length - 1) {
      refined = quad3(groups[idx - 1], groups[idx], groups[idx + 1]);
    } else if (groups.length >= 3) {
      var three = idx === 0 ? groups.slice(0, 3) : groups.slice(-3);
      refined = quad3(three[0], three[1], three[2]);
    }

    var nearZero = groups.reduce(function (a, b) {
      return Math.abs(b.axis) < Math.abs(a.axis) ? b : a;
    });

    var flat = groups.reduce(function (a, g) { return Math.max(a, g.mean); }, 0) -
      groups.reduce(function (a, g) { return Math.min(a, g.mean); }, 1);

    if (flat <= 0.015 && Math.abs(nearZero.mean - best.mean) <= 0.01) {
      reasons.push('各组的命中率几乎一样平（最大差 ' + (flat * 100).toFixed(1) +
        ' 个百分点），而且本身就是最高的那组 —— 说明 0 已经够好了。');
      return {
        verdict: 'already-fine',
        value: 0,
        range: [0, 0],
        confidence: 'medium',
        repeatability: 'medium',
        groups: groups,
        best: best,
        warnings: warnings,
        reasons: reasons
      };
    }

    var value = refined && isFinite(refined.x) ? refined.x : best.axis;
    // 兜底出来的值也不许把区间甩到测过的范围外
    var raw = value;
    value = Math.min(hi, Math.max(lo, value));
    if (value !== raw || value === lo || value === hi) {
      warnings.push('建议值落在你测过的最边上一档（' + value + '）—— 真正的最优点可能还在外面，' +
        '把那一侧再往外打一两个轴值会更准。');
    }
    var r2 = [Math.max(lo, value - 5), Math.min(hi, value + 5)];
    if (!(r2[1] > r2[0])) r2 = [value, value];

    return {
      verdict: 'peak',
      value: value,
      range: r2,
      confidence: 'low',
      repeatability: 'low',
      groups: groups,
      best: best,
      warnings: warnings,
      reasons: reasons
    };
  }

  // ── 方向投票（不要求同一首歌，但要求同一个设置）────────────────
  // 一局里唯一带「早 / 晚」符号的信息是 Fast / Late 的对比：命中率是偶函数，
  // 分不出偏早还是偏晚。于是把每局折成一票：
  //   z = (Late - Fast) / sqrt(Fast + Late)
  // |z| < 1 说明这一局自己也说不清（差得还没到统计误差），不投票。
  //
  // 前提：这些局必须打在同一个设置下 —— 设置本身就会把 Fast/Late 推向一边，
  // 混着不同设置投票等于在比设置，不是在判断玩家。所以只取局数最多的那个轴值。
  // 好处：换歌不影响方向（同一首歌的「难度」会同时抬高/压低两边），
  // 所以这条完全不需要重复打同一首歌。
  function binomTwoSided(n, k) {
    if (!n) return 1;
    var c = 1, tail = 0;
    for (var i = 0; i <= n; i++) {
      if (i >= k) tail += c;
      c = c * (n - i) / (i + 1);
    }
    return Math.min(1, 2 * tail / Math.pow(2, n));
  }

  function directionVote(runs, axis, games, mode) {
    var tally = new Map();
    (runs || []).forEach(function (run) {
      var x = axisValue(run, axis);
      tally.set(x, (tally.get(x) || 0) + 1);
    });
    if (!tally.size) return null;

    // 只用局数最多的那个设置；并列时取更接近 0 的（更保守）
    var pickX = null, pickN = -1;
    tally.forEach(function (n, x) {
      if (n > pickN || (n === pickN && Math.abs(x) < Math.abs(pickX))) {
        pickX = x;
        pickN = n;
      }
    });

    var early = 0, late = 0, unclear = 0, noCount = 0, used = 0;
    (runs || []).forEach(function (run) {
      if (axisValue(run, axis) !== pickX) return;
      var m = computeMetrics(run, games, mode);
      var f = m.fast, s = m.late;
      if (!(f + s > 0)) { noCount++; return; }
      used++;
      var z = (s - f) / Math.sqrt(f + s);
      if (z >= 1) late++;
      else if (z <= -1) early++;
      else unclear++;
    });

    var votes = early + late;
    var dir = null;
    if (votes >= 3 && early !== late) dir = late > early ? 'late' : 'early';
    var p = dir ? binomTwoSided(votes, Math.max(early, late)) : 1;

    return {
      axis: pickX,
      n: pickN,
      used: used,
      early: early,
      late: late,
      unclear: unclear,
      noCount: noCount,
      votes: votes,
      dir: dir,
      p: p,
      step: 15,
      // 「票数够」和「票数一边倒」是两件事：6 票 4:2 也压不住运气
      weak: votes < 5 || p > 0.1
    };
  }

  /* ── 导出 ────────────────────────────────────────────────── */

  var api = {
    DEFAULT_GAMES: DEFAULT_GAMES,
    ROLE_LABEL: ROLE_LABEL,
    normalizeGames: normalizeGames,
    gameNames: gameNames,
    gameInfo: gameInfo,
    centerNames: centerNames,
    axisSupport: axisSupport,
    supportedAxes: supportedAxes,
    axisLabel: axisLabel,
    axisValue: axisValue,
    modeLabel: modeLabel,
    computeMetrics: computeMetrics,
    groupRuns: groupRuns,
    poly2: poly2,
    quad3: quad3,
    percentile: percentile,
    bootstrapVertex: bootstrapVertex,
    analyze: analyze,
    directionVote: directionVote
  };

  root.OffsetCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
