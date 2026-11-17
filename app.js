/* app.js — 界面逻辑：选游戏、录一局、算结论、画图。
 *
 * 结构（从上到下就是数据流）：
 *   1. 常量 / 状态        只有 state 一个可变对象
 *   2. DOM 引用           启动时查一次，后面都用变量
 *   3. 小工具             esc / num / pct / signed / readInt
 *   4. 数据层             读 localStorage、写、按游戏过滤
 *   5. 表单渲染           判定档位（含早/晚）/ 轴值 / 轴单选 / 主指标档
 *   6. 提交与按钮事件
 *   7. 表格               记录表 + 分组表
 *   8. 结论               三态：already-fine / insufficient / peak
 *   9. 图表               canvas 手绘，颜色全部读 CSS 变量（支持换主题）
 *  10. 启动
 *
 * 只依赖 core.js（window.OffsetCore）。不联网、不用第三方库。
 */
(function () {
  'use strict';

  /* ── 1. 常量 / 状态 ─────────────────────────────────────── */

  var Core = window.OffsetCore;
  var BUILTIN = Core.DEFAULT_GAMES;
  var GAMES_KEY = 'offset-calibrator:games';   // 用户自己加的游戏（JSON 原文）
  var GAMES = {};                               // 内置 + 自定义，normalize 之后的
  var NAMES = [];
  var STORAGE_KEY = 'offset-calibrator:state';

  // 读自定义游戏表（坏 JSON 就当没有）
  function readCustomGames() {
    try {
      var raw = JSON.parse(localStorage.getItem(GAMES_KEY) || 'null');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch (e) {
      return {};
    }
  }

  // 把「内置 + 自定义」合成一张表；自定义同名会覆盖内置
  function rebuildGames() {
    var merged = {};
    Object.keys(BUILTIN).forEach(function (k) { merged[k] = BUILTIN[k]; });
    var custom = readCustomGames();
    Object.keys(custom).forEach(function (k) { merged[k] = custom[k]; });

    GAMES = Core.normalizeGames(merged);
    NAMES = Core.gameNames(GAMES);
  }

  rebuildGames();

  var state = {
    runs: [],
    game: NAMES[0] || '',
    axis: '',            // 'a0' 音频延迟 / 'a1' 判定延迟 / '' 待定
    mode: 'strict'       // 'strict' 只用最严档 / 'inclusive' 正中档合并
  };

  /* ── 2. DOM 引用 ────────────────────────────────────────── */

  function $(sel) { return document.querySelector(sel); }

  var gameSelect = $('#gameSelect');
  var gameHint = $('#gameHint');
  var tierFields = $('#tierFields');
  var axisFields = $('#axisFields');
  var axisPicker = $('#axisPicker');
  var axisRadios = $('#axisRadios');
  var modePicker = $('#modePicker');
  var modeRadios = $('#modeRadios');
  var form = $('#runForm');
  var formError = $('#formError');
  var verdictLabel = $('#verdictLabel');
  var verdictValue = $('#verdictValue');
  var verdictSub = $('#verdictSub');
  var metaLine = $('#metaLine');
  var warningsBox = $('#warnings');
  var reasonsBox = $('#reasons');
  var runsHead = $('#runsHead');
  var runsBody = $('#runsBody');
  var groupsHead = $('#groupsHead');
  var groupsBody = $('#groupsBody');
  var runsHint = $('#runsHint');
  var copyBtn = $('#copyBtn');
  var chart = $('#chart');

  var gamesText = $('#gamesText');
  var gamesApply = $('#gamesApply');
  var gamesReset = $('#gamesReset');
  var gamesError = $('#gamesError');
  var windowsBody = $('#windowsBody');

  /* ── 3. 小工具 ──────────────────────────────────────────── */

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function clampCount(v) {
    var n = Math.floor(num(v));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function pct(v, digits) { return (v * 100).toFixed(digits == null ? 1 : digits) + '%'; }

  function signed(v) {
    var r = Math.round(v);
    return (r > 0 ? '+' : '') + r;
  }

  // 读一个整数输入框：空 → 0；非法 → NaN（由调用方报错）
  function readInt(id) {
    var input = document.getElementById(id);
    if (!input) return 0;
    var raw = String(input.value == null ? '' : input.value).trim();
    if (raw === '') return 0;
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) return NaN;
    return n;
  }

  function readNumber(id) {
    var input = document.getElementById(id);
    return input ? num(input.value) : 0;
  }

  function roleTag(role) {
    return Core.ROLE_LABEL[role] || '';
  }

  /* ── 4. 数据层 ──────────────────────────────────────────── */

  // 一局：{ id, game, tiers:[{n,f,s}], a0, a1 }
  // 老数据（counts / early / late）自动搬过来，免得旧记录突然消失
  function normalizeRun(r) {
    if (!r || typeof r !== 'object') return null;

    var game = String(r.game || state.game || NAMES[0] || '').trim();
    if (!GAMES[game]) return null;

    var info = Core.gameInfo(GAMES, game);
    var src = Array.isArray(r.tiers) ? r.tiers : [];

    var legacyCounts = Array.isArray(r.counts) ? r.counts : null;
    var legacyEarly = clampCount(r.early);
    var legacyLate = clampCount(r.late);

    var tiers = info.tiers.map(function (t, i) {
      var raw = (!legacyCounts && src[i]) || {};
      var n = legacyCounts ? clampCount(legacyCounts[i]) : clampCount(raw.n);
      var f = t.dir ? clampCount(raw.f) : 0;
      var s = t.dir ? clampCount(raw.s) : 0;
      return { n: n, f: f, s: s };
    });

    // 老数据把 Early / Late 记在「头档」上，搬进第一个带方向的档位
    if (legacyCounts && (legacyEarly || legacyLate)) {
      var dirIdx = info.tiers.findIndex(function (t) { return t.dir; });
      if (dirIdx >= 0) {
        tiers[dirIdx].f = legacyEarly;
        tiers[dirIdx].s = legacyLate;
      }
    }

    return {
      id: r.id || uid(),
      game: game,
      tiers: tiers,
      a0: num(r.a0),
      a1: num(r.a1)
    };
  }

  function load() {
    var parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {
      parsed = null;
    }
    if (parsed && Array.isArray(parsed.runs)) {
      state.runs = parsed.runs.map(normalizeRun).filter(Boolean);
      if (parsed.game && GAMES[parsed.game]) state.game = parsed.game;
      if (parsed.mode === 'inclusive' || parsed.mode === 'strict') state.mode = parsed.mode;
    }
    if (!GAMES[state.game]) state.game = NAMES[0] || '';
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        game: state.game,
        axis: state.axis,
        mode: state.mode,
        runs: state.runs
      }));
    } catch (e) {
      /* 存储配额满了就算了，界面上不打断使用 */
    }
  }

  function currentRuns() {
    return state.runs.filter(function (r) { return r.game === state.game; });
  }

  /* ── 5. 表单渲染 ────────────────────────────────────────── */

  function field(id, label, hint, value, extra) {
    var step = extra && extra.step ? extra.step : '1';
    var min = extra && extra.min != null ? extra.min : 0;
    var cls = extra && extra.cls ? ' ' + extra.cls : '';
    return '<div class="field' + cls + '">' +
      '<label for="' + id + '">' + esc(label) +
      (hint ? ' <span class="unit">' + esc(hint) + '</span>' : '') +
      '</label>' +
      '<input id="' + id + '" name="' + id + '" type="number" inputmode="numeric" step="' + step + '"' +
      ' min="' + min + '" value="' + (value == null ? '' : esc(value)) + '">' +
      '</div>';
  }

  // 判定档位：每档一个主输入框；带方向的档位后面跟「早 / 晚」两个小框
  function renderTierFields() {
    var info = Core.gameInfo(GAMES, state.game);

    tierFields.innerHTML = info.tiers.map(function (t, i) {
      var html = field('t' + i, t.name, '（' + roleTag(t.role) + '）', '');
      if (t.dir) {
        html += field('f' + i, t.name + ' · 早', 'Fast', '', { cls: 'sub' });
        html += field('s' + i, t.name + ' · 晚', 'Late', '', { cls: 'sub' });
      }
      return html;
    }).join('');
  }

  function renderAxisFields() {
    var sup = Core.axisSupport(GAMES, state.game);
    var html = '';
    if (sup.a0) html += field('fA0', '音频延迟', '', '');
    if (sup.a1) html += field('fA1', '判定延迟', '', '');
    axisFields.innerHTML = html;
  }

  // 只负责把单选画出来；改变事件由启动时的一次性委托处理（见第 6 节）
  function renderAxisPicker() {
    var axes = Core.supportedAxes(GAMES, state.game);
    if (axes.indexOf(state.axis) < 0) {
      state.axis = axes.indexOf('a1') >= 0 ? 'a1' : (axes[0] || 'a1');
    }
    if (axes.length < 2) {
      axisPicker.hidden = true;
      axisRadios.innerHTML = '';
      return;
    }
    axisPicker.hidden = false;
    axisRadios.innerHTML = axes.map(function (ax) {
      var checked = ax === state.axis ? ' checked' : '';
      return '<label><input type="radio" name="axis" value="' + ax + '"' + checked + '> ' +
        Core.axisLabel(ax) + '</label>';
    }).join('');
  }

  // 主指标取哪个正中档（只有「大P / 小P」这种多正中档的游戏才显示）
  function renderModePicker() {
    var info = Core.gameInfo(GAMES, state.game);

    if (info.centerCount < 2) {
      state.mode = 'strict';
      if (modePicker) {
        modePicker.hidden = true;
        modeRadios.innerHTML = '';
      }
      return;
    }

    var centers = Core.centerNames(GAMES, state.game);
    modePicker.hidden = false;
    modeRadios.innerHTML = [
      ['strict', '只用最严档（' + centers[0] + '）'],
      ['inclusive', '正中档合并（' + centers.join(' + ') + '）']
    ].map(function (pair) {
      var checked = state.mode === pair[0] ? ' checked' : '';
      return '<label><input type="radio" name="mode" value="' + pair[0] + '"' + checked + '> ' +
        esc(pair[1]) + '</label>';
    }).join('');
  }

  function renderGameSelect() {
    gameSelect.innerHTML = NAMES.map(function (name) {
      var flags = Core.axisSupport(GAMES, name);
      var tag = [flags.a0 ? '音频' : null, flags.a1 ? '判定' : null].filter(Boolean).join('+');
      return '<option value="' + esc(name) + '"' + (name === state.game ? ' selected' : '') + '>' +
        esc(name) + '（' + tag + '）</option>';
    }).join('');
  }

  function updateGameHint() {
    var info = Core.gameInfo(GAMES, state.game);
    var parts = ['判定档位：' + info.tiers.map(function (t) {
      return t.name + (t.role ? '（' + roleTag(t.role) + '）' : '') +
        (t.dir ? '＋早/晚' : '') +
        (t.ms ? ' ±' + t.ms + 'ms' : '');
    }).join(' / ')];

    if (!info.hasDir) parts.push('这个游戏的结算里没有早/晚细分 → 只填各档数量');
    if (!info.a1) parts.push('不支持判定延迟 → 只标定音频延迟');
    if (!info.a0) parts.push('不支持音频延迟 → 只标定判定延迟');
    if (info.centerCount > 1) parts.push('有多个正中档 → 可以选主指标用哪一档');

    gameHint.textContent = parts.join(' · ');
  }

  /* ⑥ 游戏编辑框 + 判定区间表 */

  function showGamesError(msg) {
    if (!gamesError) return;
    gamesError.textContent = msg || '';
    gamesError.hidden = !msg;
  }

  function renderGamesEditor() {
    if (gamesText) {
      var custom = readCustomGames();
      gamesText.value = Object.keys(custom).length ? JSON.stringify(custom, null, 2) : '';
    }
    renderWindowsTable();
  }

  // 每个游戏的每个档位：角色 + 有没有早/晚 + 判定区间（没填就显示 —）
  function renderWindowsTable() {
    if (!windowsBody) return;

    var rows = [];
    NAMES.forEach(function (name) {
      var info = Core.gameInfo(GAMES, name);
      info.tiers.forEach(function (t) {
        rows.push('<tr>' +
          '<td>' + esc(name) + '</td>' +
          '<td>' + esc(t.name) + '</td>' +
          '<td>' + esc(roleTag(t.role) || '—') + '</td>' +
          '<td>' + (t.dir ? '有' : '—') + '</td>' +
          '<td>' + (t.ms ? '±' + t.ms + ' ms' : '—') + '</td>' +
          '</tr>');
      });
    });

    windowsBody.innerHTML = rows.length ? rows.join('') :
      '<tr><td colspan="5" class="empty">还没有游戏。</td></tr>';
  }

  function applyCustomGames() {
    var text = String(gamesText && gamesText.value || '').trim();
    var custom = {};

    if (text) {
      try {
        custom = JSON.parse(text);
      } catch (e) {
        showGamesError('JSON 解析失败：' + e.message);
        return;
      }
      if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
        showGamesError('最外层要是一个对象，像 { "我的游戏": { "a0": true, "a1": true, "tiers": [...] } }');
        return;
      }
    }

    var ok = Core.normalizeGames(custom);
    var okNames = Object.keys(ok);
    var badNames = Object.keys(custom).filter(function (k) { return !ok[k]; });

    if (Object.keys(custom).length && !okNames.length) {
      showGamesError('没有一个游戏是能用的：检查 a0 / a1 至少一个是 true，tiers 不能为空。');
      return;
    }

    try {
      localStorage.setItem(GAMES_KEY, JSON.stringify(custom));
    } catch (e) {
      showGamesError('存不进浏览器（localStorage 满了？）');
      return;
    }

    rebuildGames();
    if (!GAMES[state.game]) state.game = NAMES[0] || '';
    save();

    showGamesError(badNames.length
      ? '已保存。这些没被采用（格式不对）：' + badNames.join('、')
      : (okNames.length ? '已保存 ' + okNames.length + ' 个自定义游戏。' : ''));

    renderGameSelect();
    renderFields();
    render();
    renderGamesEditor();
  }

  gamesApply.addEventListener('click', applyCustomGames);

  gamesReset.addEventListener('click', function () {
    if (!confirm('清掉所有自定义游戏，只留内置的 4 款？')) return;
    try { localStorage.removeItem(GAMES_KEY); } catch (e) { /* 忽略 */ }
    rebuildGames();
    if (!GAMES[state.game]) state.game = NAMES[0] || '';
    save();
    showGamesError('');
    renderGameSelect();
    renderFields();
    render();
    renderGamesEditor();
  });

  function showError(msg) {
    formError.textContent = msg || '';
    formError.hidden = !msg;
  }

  /* ── 6. 提交与按钮事件 ──────────────────────────────────── */

  function collectTiers() {
    var info = Core.gameInfo(GAMES, state.game);
    var tiers = [];

    for (var i = 0; i < info.tiers.length; i++) {
      var t = info.tiers[i];
      var n = readInt('t' + i);
      if (isNaN(n)) return { error: '「' + t.name + '」要填 0 或正整数。' };

      var f = 0;
      var s = 0;
      if (t.dir) {
        f = readInt('f' + i);
        s = readInt('s' + i);
        if (isNaN(f) || isNaN(s)) return { error: '「' + t.name + '」的早/晚要填 0 或正整数。' };
        if (f + s > n) return { error: '「' + t.name + '」的早 + 晚不能超过这一档的数量（' + n + '）。' };
      }
      tiers.push({ n: n, f: f, s: s });
    }

    var total = tiers.reduce(function (a, x) { return a + x.n; }, 0);
    if (total <= 0) return { error: '所有判定都是 0 —— 至少填一个。' };

    return { tiers: tiers };
  }

  function submitRun() {
    var picked = collectTiers();
    if (picked.error) {
      showError(picked.error);
      return;
    }

    var sup = Core.axisSupport(GAMES, state.game);
    var a0 = sup.a0 ? readNumber('fA0') : 0;
    var a1 = sup.a1 ? readNumber('fA1') : 0;

    state.runs.push({
      id: uid(),
      game: state.game,
      tiers: picked.tiers,
      a0: a0,
      a1: a1
    });
    save();
    showError('');

    // 清空判定框，但保留两个轴值，方便接着打同一个设置
    Array.prototype.forEach.call(tierFields.querySelectorAll('input'), function (input) {
      input.value = '';
    });

    render();
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submitRun();
  });

  gameSelect.addEventListener('change', function () {
    state.game = gameSelect.value;
    state.axis = '';
    state.mode = 'strict';
    save();
    renderGameSelect();
    renderFields();
    render();
  });

  // 轴单选：事件委托，只注册一次（每次重绘都重新绑定会叠加监听器）
  axisRadios.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input || input.name !== 'axis' || !input.checked) return;
    state.axis = input.value;
    save();
    renderAnalysis();
  });

  modeRadios.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input || input.name !== 'mode' || !input.checked) return;
    state.mode = input.value;
    save();
    renderAnalysis();
  });

  // 删记录：同样用委托，避免每行绑一个监听器
  runsBody.addEventListener('click', function (ev) {
    var btn = ev.target;
    if (!btn || !btn.getAttribute || !btn.getAttribute('data-del')) return;
    var id = btn.getAttribute('data-del');
    state.runs = state.runs.filter(function (r) { return r.id !== id; });
    save();
    render();
  });

  copyBtn.addEventListener('click', function () {
    if (!lastSummary) return;
    var restore = function () {
      var old = copyBtn.textContent;
      copyBtn.textContent = '已复制 ✓';
      setTimeout(function () { copyBtn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastSummary).then(restore, function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = lastSummary;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); restore(); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  });

  $('#clearBtn').addEventListener('click', function () {
    var runs = currentRuns();
    if (!runs.length) return;
    if (!confirm('清掉「' + state.game + '」的全部 ' + runs.length + ' 条记录？')) return;
    state.runs = state.runs.filter(function (r) { return r.game !== state.game; });
    save();
    render();
  });

  $('#recalcBtn').addEventListener('click', render);

  // 示例数据：数字是按实测比例编的，只用来看表格和图表长什么样
  $('#demoBtn').addEventListener('click', function () {
    var info = Core.gameInfo(GAMES, state.game);
    var sup = Core.axisSupport(GAMES, state.game);
    var axisKey = sup.a1 ? 'a1' : 'a0';

    var plan = sup.a1
      ? [[0, 0.845], [25, 0.905], [30, 0.943], [35, 0.931], [40, 0.876]]
      : [[0, 0.86], [20, 0.90], [40, 0.82]];

    var centerIdx = info.tiers.findIndex(function (t) { return t.role === 'center'; });
    var dirIdx = info.tiers.findIndex(function (t) { return t.dir; });

    plan.forEach(function (row) {
      var total = 1000;
      var p = row[1];
      var tiers = info.tiers.map(function () { return { n: 0, f: 0, s: 0 }; });

      if (dirIdx >= 0 && dirIdx === centerIdx) {
        // 早/晚就是正中档的内部细分：先放进去，再从命中率里扣掉
        var ring = Math.round(total * 0.04);
        var f = Math.round(ring * 0.7);
        tiers[centerIdx] = { n: Math.round(total * p) + ring, f: f, s: ring - f };
        var used = tiers[centerIdx].n;
        tiers[info.tiers.length - 1].n = Math.max(0, total - used);
      } else {
        tiers[centerIdx].n = Math.round(total * p);
        var used2 = tiers[centerIdx].n;
        if (dirIdx >= 0) {
          var ring2 = Math.round(total * 0.06);
          var f2 = Math.round(ring2 * 0.7);
          tiers[dirIdx] = { n: ring2, f: f2, s: ring2 - f2 };
          used2 += ring2;
        }
        tiers[info.tiers.length - 1].n = Math.max(0, total - used2);
      }

      state.runs.push({
        id: uid(),
        game: state.game,
        tiers: tiers,
        a0: axisKey === 'a0' ? row[0] : 0,
        a1: axisKey === 'a1' ? row[0] : 0
      });
    });

    save();
    render();
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAnalysis, 150);
  });

  /* ── 7. 表格 ────────────────────────────────────────────── */

  function renderRunsTable() {
    var info = Core.gameInfo(GAMES, state.game);
    var sup = Core.axisSupport(GAMES, state.game);
    var runs = currentRuns();

    var head = ['#'].concat(info.tiers.map(function (t) {
      return t.name + (t.dir ? '（早/晚）' : '');
    })).concat(['命中率', '环带']);
    if (sup.a0) head.push('音频延迟');
    if (sup.a1) head.push('判定延迟');
    head.push('');

    runsHead.innerHTML = '<tr>' + head.map(function (h) {
      return '<th>' + esc(h) + '</th>';
    }).join('') + '</tr>';

    if (!runs.length) {
      runsBody.innerHTML = '<tr><td colspan="' + head.length + '" class="empty">' +
        '还没有记录 —— 打一局、把数字填进 ① 就能加进来。</td></tr>';
      runsHint.textContent = '';
      return;
    }

    runsBody.innerHTML = runs.map(function (run, idx) {
      var m = Core.computeMetrics(run, GAMES, state.mode);
      var cells = ['<td>' + (idx + 1) + '</td>'];

      m.rows.forEach(function (r) {
        if (r.dir) {
          cells.push('<td>' + r.n + '<span class="tiny">早' + r.f + ' / 晚' + r.s + '</span></td>');
        } else {
          cells.push('<td>' + r.n + '</td>');
        }
      });

      cells.push('<td>' + pct(m.p) + '</td>');
      cells.push('<td>' + pct(m.ring) + '</td>');
      if (sup.a0) cells.push('<td>' + signed(run.a0) + '</td>');
      if (sup.a1) cells.push('<td>' + signed(run.a1) + '</td>');
      cells.push('<td><button type="button" class="ghost small" data-del="' + run.id + '">删</button></td>');
      return '<tr>' + cells.join('') + '</tr>';
    }).join('');

    var avg = runs.reduce(function (a, r) {
      return a + Core.computeMetrics(r, GAMES, state.mode).p;
    }, 0) / runs.length;

    runsHint.textContent = '当前游戏共 ' + runs.length + ' 局；平均命中率 ' + pct(avg) +
      (info.centerCount > 1 ? '（主指标：' + Core.modeLabel(state.mode) + '）' : '') + '。';
  }

  function renderGroupsTable(result) {
    var axisName = Core.axisLabel(state.axis);
    groupsHead.innerHTML = '<tr><th>' + esc(axisName) + '</th><th>局数</th>' +
      '<th>平均命中率</th><th>标准差</th><th>环带占比</th></tr>';

    if (!result || !result.groups || !result.groups.length) {
      groupsBody.innerHTML = '<tr><td colspan="5" class="empty">还没有可分组的数据。</td></tr>';
      return;
    }

    groupsBody.innerHTML = result.groups.map(function (g) {
      var isBest = result.best && g.axis === result.best.axis;
      return '<tr' + (isBest ? ' class="best"' : '') + '>' +
        '<td>' + signed(g.axis) + '</td>' +
        '<td>' + g.n + '</td>' +
        '<td>' + pct(g.mean) + '</td>' +
        '<td>' + (g.n > 1 ? pct(g.sd) : '—') + '</td>' +
        '<td>' + pct(g.ring) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── 8. 结论 ────────────────────────────────────────────── */

  var lastSummary = '';

  function buildSummary(result, axisName) {
    var r = result.range || [result.value - 5, result.value + 5];
    var metric = state.mode === 'inclusive' ? '（正中档合并）' : '';
    if (result.verdict === 'already-fine') {
      return '【Offset Calibrator】' + state.game + ' · ' + axisName + ' = 0 已经是最优，不用调。' + metric;
    }
    return '【Offset Calibrator】' + state.game + ' · 建议 ' + axisName + ' = ' + signed(result.value) +
      '（区间 ' + signed(r[0]) + ' ~ ' + signed(r[1]) + '，置信度 ' + result.confidence + '）' + metric;
  }

  function renderAnalysis() {
    var runs = currentRuns();
    var axisName = Core.axisLabel(state.axis);
    var mode = state.mode;
    var result = runs.length ? Core.analyze(runs, state.axis, GAMES, mode) : null;

    warningsBox.innerHTML = '';
    reasonsBox.innerHTML = '';
    copyBtn.hidden = true;
    lastSummary = '';

    if (!runs.length) {
      verdictLabel.textContent = '等数据';
      verdictValue.textContent = '—';
      verdictSub.textContent = '先打几局，把数字填进来吧～';
      metaLine.textContent = '';
      renderGroupsTable(null);
      drawChart(null);
      return;
    }

    if (result.warnings && result.warnings.length) {
      warningsBox.innerHTML = result.warnings.map(function (w) {
        return '<p class="warnline">⚠️ ' + esc(w) + '</p>';
      }).join('');
    }

    if (result.verdict === 'already-fine') {
      verdictLabel.textContent = '不用调';
      verdictValue.textContent = '0';
      verdictSub.textContent = '0 已经是最优的那一档 —— 调了只会变差。';
    } else if (result.verdict === 'insufficient') {
      verdictLabel.textContent = '数据不够';
      verdictValue.textContent = '—';
      verdictSub.textContent = '至少测 3 个不同的轴值，每个值 2 局。';
    } else {
      verdictLabel.textContent = '建议 ' + axisName;
      verdictValue.textContent = signed(result.value);
      var r = result.range || [result.value - 5, result.value + 5];
      verdictSub.textContent = '建议区间 ' + signed(r[0]) + ' ~ ' + signed(r[1]) +
        ' · 置信度 ' + (result.confidence === 'high' ? '高'
          : result.confidence === 'medium' ? '中' : '低');
    }

    reasonsBox.innerHTML = (result.reasons || []).map(function (x) {
      return '<p class="hint">' + esc(x) + '</p>';
    }).join('');

    var info = Core.gameInfo(GAMES, state.game);
    var modeText = info.centerCount > 1 ? ' · 主指标：' + Core.modeLabel(mode) : '';

    if (result.best) {
      metaLine.textContent = '共 ' + runs.length + ' 局 · ' + result.groups.length + ' 个轴值 · 目前最好：' +
        signed(result.best.axis) + '（' + pct(result.best.mean) + '）· 标定轴：' + axisName + modeText;
    } else {
      metaLine.textContent = '共 ' + runs.length + ' 局' + modeText;
    }

    renderGroupsTable(result);
    drawChart(result);

    if (result.verdict === 'peak' || result.verdict === 'already-fine') {
      lastSummary = buildSummary(result, axisName);
      copyBtn.hidden = false;
    }
  }

  /* ── 9. 图表 ────────────────────────────────────────────── */

  // 颜色一律读 CSS 变量（改 styles.css 的 --chart-* 即可换图表配色）
  function cssVar(name, fallback) {
    try {
      var v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function drawChart(result) {
    if (!chart || !chart.getContext) return;
    var ctx = chart.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cssW = chart.clientWidth || 900;
    var cssH = chart.clientHeight || 300;
    chart.width = Math.round(cssW * dpr);
    chart.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var pad = { l: 52, r: 16, t: 18, b: 34 };
    var w = cssW - pad.l - pad.r;
    var h = cssH - pad.t - pad.b;

    var groups = result && result.groups ? result.groups : [];
    if (!groups.length) {
      ctx.fillStyle = cssVar('--chart-hint', '#8b8780');
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('还没有数据', cssW / 2, cssH / 2);
      return;
    }

    var xs = groups.map(function (g) { return g.axis; });
    var ys = groups.map(function (g) { return g.mean; });
    var x0 = Math.min.apply(null, xs);
    var x1 = Math.max.apply(null, xs);
    if (x1 - x0 < 1) { x0 -= 10; x1 += 10; }

    var yMin = Math.max(0, Math.min.apply(null, ys) - 0.05);
    var yMax = Math.min(1, Math.max.apply(null, ys) + 0.04);
    if (yMax - yMin < 0.02) yMax = Math.min(1, yMin + 0.02);

    function X(v) { return pad.l + (v - x0) / (x1 - x0) * w; }
    function Y(v) { return pad.t + (1 - (v - yMin) / (yMax - yMin)) * h; }

    // 水平网格 + 百分比刻度
    ctx.strokeStyle = cssVar('--chart-grid', '#dcd8d0');
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = cssVar('--chart-text', '#5d5a54');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) {
      var yv = yMin + (yMax - yMin) * i / 4;
      var yy = Y(yv);
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(pad.l + w, yy);
      ctx.stroke();
      ctx.fillText((yv * 100).toFixed(0) + '%', pad.l - 8, yy);
    }

    // 每个轴值一个 x 刻度
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    groups.forEach(function (g) {
      ctx.fillText(signed(g.axis), X(g.axis), pad.t + h + 8);
    });

    // 0 参考线
    if (x0 <= 0 && x1 >= 0) {
      ctx.strokeStyle = cssVar('--chart-axis', '#c6c2ba');
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(X(0), pad.t);
      ctx.lineTo(X(0), pad.t + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 二次拟合曲线（只有 ≥3 组且开口向下才画）
    var fit = groups.length >= 3 ? Core.poly2(groups.map(function (g) {
      return { x: g.axis, y: g.mean, w: g.n };
    })) : null;
    if (fit && fit.c < 0) {
      ctx.strokeStyle = cssVar('--chart-line', 'rgba(255,45,122,0.9)');
      ctx.lineWidth = 2;
      ctx.beginPath();
      var steps = 80;
      for (var s = 0; s <= steps; s++) {
        var xv = x0 + (x1 - x0) * s / steps;
        var yv2 = fit.a + fit.b * xv + fit.c * xv * xv;
        if (s === 0) ctx.moveTo(X(xv), Y(yv2)); else ctx.lineTo(X(xv), Y(yv2));
      }
      ctx.stroke();
    }

    // 顶点竖线
    if (result && result.verdict === 'peak' && isFinite(result.value)) {
      ctx.strokeStyle = cssVar('--chart-vertex', 'rgba(15,157,88,0.85)');
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(result.value), pad.t);
      ctx.lineTo(X(result.value), pad.t + h);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = cssVar('--chart-vertex-text', 'rgba(15,157,88,0.95)');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('顶点 ' + signed(result.value),
        Math.min(X(result.value) + 6, pad.l + w - 70), pad.t + 2);
    }

    // 数据点 + 标准差竖线
    groups.forEach(function (g) {
      var cx = X(g.axis);
      var cy = Y(g.mean);
      if (g.n > 1 && g.sd > 0) {
        ctx.strokeStyle = cssVar('--chart-sd', 'rgba(18,18,18,0.28)');
        ctx.beginPath();
        ctx.moveTo(cx, Y(Math.min(1, g.mean + g.sd)));
        ctx.lineTo(cx, Y(Math.max(0, g.mean - g.sd)));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.fillStyle = cssVar('--chart-point', '#ff2d7a');
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cssVar('--chart-point-ring', '#fff');
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  /* ── 10. 启动 ───────────────────────────────────────────── */

  // 表单区（跟「当前游戏」绑定的那部分），换游戏时整体重画
  function renderFields() {
    updateGameHint();
    renderTierFields();
    renderAxisFields();
    renderAxisPicker();
    renderModePicker();
  }

  function render() {
    renderRunsTable();
    renderAnalysis();
  }

  // 供外部（例如主题切换）重绘图表；颜色读自 CSS 变量
  window.OffsetApp = { redraw: renderAnalysis };

  load();
  renderGameSelect();
  renderFields();
  render();
  renderGamesEditor();
})();
