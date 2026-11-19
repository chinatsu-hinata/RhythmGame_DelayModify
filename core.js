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
      a0: true, a1: false,
      tiers: [
        { name: 'Pure', role: 'center' },
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
      a0: true, a1: true, fl: true,
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
        {name:"JUST", role:"center"},
        { name: 'GOOD', role: 'near'},
        {name:"OK",role:"far"},
        {name:"Miss",role:"Miss"}
      ]
    },
    "Lanota/调律诗篇":{
      a0: true, a1: false, fl:true,
      tiers: [
        {name:"Perfect+", role:"center"},
        { name: 'Perfect', role: 'center'},
        { name: 'Great', role: 'near'},
        {name:"Good",role:"far"},
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

      out[name] = { a0: a0, a1: a1, tiers: tiers, fl: fl };
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
      fl: !!g.fl
    };
  }

  function tierInfos(games, game) { return gameInfo(games, game).tiers; }

  function judgingNames(games, game) {
    return gameInfo(games, game).tiers.map(function (t) { return t.name; });
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

    var vertices = [];
    for (var t = 0; t < times; t++) {
      var pts = keys.map(function (x) {
        var list = byAxis.get(x);
        var sum = 0;
        for (var i = 0; i < list.length; i++) {
          sum += list[Math.floor(Math.random() * list.length)].p;
        }
        return { x: x, y: sum / list.length, w: list.length };
      });
      var fit = poly2(pts);
      if (!fit || !(fit.c < 0)) continue;
      var v = -fit.b / (2 * fit.c);
      if (isFinite(v)) vertices.push(v);
    }
    if (vertices.length < 20) return null;

    return {
      lo: percentile(vertices, 0.05),
      hi: percentile(vertices, 0.95),
      samples: vertices.length
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
      return { verdict: 'insufficient', groups: groups, best: best, warnings: warnings, reasons: reasons };
    }

    var fit = poly2(groups.map(function (g) {
      return { x: g.axis, y: g.mean, w: g.n };
    }));

    var lo = groups[0].axis;
    var hi = groups[groups.length - 1].axis;

    if (fit && fit.c < 0) {
      var peak = -fit.b / (2 * fit.c);
      if (isFinite(peak) && peak >= lo && peak <= hi) {
        var boot = bootstrapVertex(runs, axis, games, mode);
        // 保留小数：小刻度的延迟（例如 0.085）不能被取整成 0
        var range = boot
          ? [boot.lo, boot.hi]
          : [peak - 5, peak + 5];
        // 重采样全部落在同一个点上时（数据完全对称），区间会退化成一个点，这里补成 ±半个刻度
        if (!(range[1] > range[0])) {
          var hs = axisStep(groups) / 2;
          range = [peak - hs, peak + hs];
        }
        var width = range[1] - range[0];

        var confidence = width <= 8 && groups.length >= 4 ? 'high'
          : width <= 18 ? 'medium' : 'low';

        reasons.push('把 ' + groups.length + ' 个轴值的平均命中率（' + modeLabel(mode) + '）拟成抛物线，顶点在 ' +
          peak.toFixed(1) + '。');
        reasons.push('重采样 ' + (boot ? boot.samples : 0) + ' 次得到的 90% 区间就是上面那个范围。');
        if (Math.abs(best.axis - peak) > axisStep(groups) / 2) {
          reasons.push('实测最好的是 ' + best.axis + '（' + (best.mean * 100).toFixed(1) +
            '%），和顶点差一点，属正常波动。');
        }

        return {
          verdict: 'peak',
          value: peak,
          range: range,
          confidence: confidence,
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
        groups: groups,
        best: best,
        warnings: warnings,
        reasons: reasons
      };
    }

    var value = refined && isFinite(refined.x) ? refined.x : best.axis;
    var r2 = [value - 5, value + 5];

    return {
      verdict: 'peak',
      value: value,
      range: r2,
      confidence: 'low',
      groups: groups,
      best: best,
      warnings: warnings,
      reasons: reasons
    };
  }

  // 下一步该测哪个值（界面上暂时没用到，留给以后）
  function suggestNext(runs, axis, games, mode) {
    var groups = groupRuns(runs, axis, games, mode);
    if (groups.length < 3) {
      var best = groups.length
        ? groups.reduce(function (a, b) { return b.mean > a.mean ? b : a; })
        : { axis: 0 };
      return '再测 ' + (best.axis > 0 ? best.axis : 0) + ' 附近 ±20 的两个值。';
    }
    return '数据够了，直接看结论。';
  }

  /* ── 导出 ────────────────────────────────────────────────── */

  var api = {
    DEFAULT_GAMES: DEFAULT_GAMES,
    ROLE_LABEL: ROLE_LABEL,
    normalizeGames: normalizeGames,
    gameNames: gameNames,
    gameInfo: gameInfo,
    tierInfos: tierInfos,
    judgingNames: judgingNames,
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
    suggestNext: suggestNext
  };

  root.OffsetCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
