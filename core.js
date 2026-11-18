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
 *         { "name": "JUSTICE", "role": "center" },              // 正中档
 *         { "name": "ATTACK",  "role": "near", "dir": true },   // 带早/晚细分
 *         { "name": "MISS",    "role": "miss" }
 *       ]
 *     }
 *   }
 *   role：center 正中 / near 近 / far 远 / miss 漏
 *   dir ：这一档的结算里能不能看到 fast / late（早 / 晚）
 *
 *   老格式仍然能读：[[支持音频, 支持判定], ["Perfect", "Good", "Bad", "Miss"]]
 *   会按「第一个 = 正中、最后一个 = 漏、中间 = 近」自动补 role。
 *
 *   内置四款里，CHUNITHM 的 JUSTICE 与 maimai DX 的 Perfect 带 dir：
 *   它们结算里的 Early / Late 就是最严档的内部细分；Phigros / Arcaea 没有细分。
 *
 * ── 一局 = 一个 run ──────────────────────────────────────────────
 *   { game: 'CHUNITHM', tiers: [{ n: 1050, f: 0, s: 0 }, { n: 30, f: 21, s: 9 }, { n: 10 }],
 *     a0: 0, a1: 30 }
 *   n = 这一档的总数；f / s = 这一档里偏早 / 偏晚的个数（只有 dir 档才有意义）
 *
 * ── 指标 ────────────────────────────────────────────────────────
 *   命中率 p    = (正中档 − 正中档里的早/晚) / 总音符      ← strict 只算最严档，inclusive 合所有正中档
 *   环带占比    = (总音符 − 正中档) / 总音符                ← 丢档率，越小越稳
 *   早/晚比 W   = Σ早 / (Σ早 + Σ晚)                        ← 只用来判方向，不用来反解
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
    'Arcaea': {
      a0: true, a1: false,
      tiers: [
        { name: 'Pure', role: 'center' },
        { name: 'Far', role: 'near' },
        { name: 'Lost', role: 'miss' }
      ]
    },
    'CHUNITHM': {
      a0: true, a1: true,
      tiers: [
        {name:"Justice Critical", role:"center"},
        { name: 'JUSTICE', role: 'center'},   // 结算里的 Early / Late 是 JUSTICE 内部的细分
        { name: 'ATTACK', role: 'near' },
        { name: 'MISS', role: 'miss' }
      ]
    },
    'maimai DX': {
      a0: false, a1: true,
      tiers: [
        {name:"Critical", role:"center"},
        { name: 'Perfect', role: 'center'},
        { name: 'Great', role: 'near' },
        { name: 'Good', role: 'far' },
        { name: 'Miss', role: 'miss' }
      ]
    },
    'Vivid/Stasis':{
      a0:true,a1:true,
      tiers:[
        {name:'Critical',role:'center',dir:true},
        {name:'Great',role:'near'},
        {name: 'Good', role: 'far' },
        {name: 'Miss', role: 'miss' }
      ]
    },
    "Project SEKAI":{
      a0:false,a1:true,
      tiers:[
        { name: 'Perfect', role: 'center'},
        { name: 'Great', role: 'near' },
        { name: 'Good', role: 'far' },
        { name: 'Miss', role: 'miss' }
      ]
    }
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

    var name, role, dir, ms;
    if (typeof raw === 'string') {
      name = raw.trim();
      role = '';
      dir = false;
      ms = null;
    } else if (typeof raw === 'object') {
      name = String(raw.name == null ? '' : raw.name).trim();
      role = roleOf(raw.role);
      dir = raw.dir === true || raw.hasDir === true || raw.direction === true;
      ms = normalizeWindow(raw.ms);
    } else {
      return null;
    }
    if (!name) return null;

    return { name: name, role: role, dir: !!dir, ms: ms };
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

      out[name] = { a0: a0, a1: a1, tiers: tiers };
    });

    return out;
  }

  function gameNames(games) { return Object.keys(games || {}); }

  function gameInfo(games, game) {
    var g = games && games[game];
    if (!g) return { a0: false, a1: false, tiers: [], centerCount: 0, hasDir: false };

    var tiers = g.tiers.map(function (t) {
      return { name: t.name, role: t.role, dir: !!t.dir, ms: t.ms ? t.ms.slice() : null };
    });

    return {
      a0: !!g.a0,
      a1: !!g.a1,
      tiers: tiers,
      centerCount: tiers.filter(function (t) { return t.role === 'center'; }).length,
      hasDir: tiers.some(function (t) { return t.dir; })
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

    return info.tiers.map(function (t, i) {
      var raw = src[i] || {};
      var n = toInt(raw.n);
      var f = t.dir ? toInt(raw.f) : 0;
      var s = t.dir ? toInt(raw.s) : 0;

      if (f + s > n) {                      // 数据脏了：早+晚按这一档封顶
        s = Math.max(0, n - f);
        if (f + s > n) f = Math.max(0, n - s);
      }
      return { name: t.name, role: t.role, dir: t.dir, n: n, f: f, s: s };
    });
  }

  function computeMetrics(run, games, mode) {
    var info = gameInfo(games, run && run.game);
    var rows = normalizeRows(run, info);

    var total = rows.reduce(function (a, r) { return a + r.n; }, 0);

    var centers = rows.filter(function (r) { return r.role === 'center'; });
    var strict = centers[0] || { n: 0, f: 0, s: 0 };

    var centerN = centers.reduce(function (a, r) { return a + r.n; }, 0);
    var centerF = centers.reduce(function (a, r) { return a + r.f; }, 0);
    var centerS = centers.reduce(function (a, r) { return a + r.s; }, 0);

    var dirF = 0;
    var dirS = 0;
    rows.forEach(function (r) { dirF += r.f; dirS += r.s; });
    var hasDir = (dirF + dirS) > 0;

    var pStrict = total > 0 ? (strict.n - strict.f - strict.s) / total : 0;
    var pInclusive = total > 0 ? (centerN - centerF - centerS) / total : 0;

    var m = mode === 'inclusive' && centers.length > 1 ? 'inclusive' : 'strict';
    var edge = m === 'inclusive' ? centerN : strict.n;

    return {
      rows: rows,
      counts: rows.map(function (r) { return r.n; }),   // 老界面还按数组用
      total: total,
      centerN: centerN,
      strictN: strict.n,
      dirF: dirF,
      dirS: dirS,
      hasDir: hasDir,
      p: m === 'inclusive' ? pInclusive : pStrict,
      pStrict: pStrict,
      pInclusive: pInclusive,
      ring: total > 0 ? (total - edge) / total : 0,
      w: hasDir ? dirF / (dirF + dirS) : NaN,
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
      var f = list.reduce(function (a, m) { return a + m.dirF; }, 0);
      var l = list.reduce(function (a, m) { return a + m.dirS; }, 0);

      groups.push({
        axis: x,
        n: n,
        mean: mean,
        sd: sd,
        ring: ringMean,
        w: f + l > 0 ? f / (f + l) : NaN,
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
        var range = boot
          ? [Math.round(boot.lo), Math.round(boot.hi)]
          : [Math.round(peak) - 5, Math.round(peak) + 5];
        var width = range[1] - range[0];

        var confidence = width <= 8 && groups.length >= 4 ? 'high'
          : width <= 18 ? 'medium' : 'low';

        reasons.push('把 ' + groups.length + ' 个轴值的平均命中率（' + modeLabel(mode) + '）拟成抛物线，顶点在 ' +
          peak.toFixed(1) + '。');
        reasons.push('重采样 ' + (boot ? boot.samples : 0) + ' 次得到的 90% 区间就是上面那个范围。');
        if (best.axis !== Math.round(peak)) {
          reasons.push('实测最好的是 ' + best.axis + '（' + (best.mean * 100).toFixed(1) +
            '%），和顶点差一点，属正常波动。');
        }

        return {
          verdict: 'peak',
          value: Math.round(peak),
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
    var r2 = [Math.round(value) - 5, Math.round(value) + 5];

    return {
      verdict: 'peak',
      value: Math.round(value),
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
