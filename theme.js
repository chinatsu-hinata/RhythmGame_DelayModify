/* theme.js — 街机风 / 千夏风 两套配色切换。
 * 只管 <html data-theme>，具体颜色全在 styles.css 里。
 * 切换后要重画图表，因为 canvas 的颜色是读 CSS 变量的。
 */
(function () {
  'use strict';

  var KEY = 'offset-calibrator:theme';
  var root = document.documentElement;
  var btn = document.getElementById('themeBtn');
  if (!btn) return;

  function label(theme) {
    // 按钮上显示的是「点一下会变成什么」
    btn.textContent = theme === 'arcade' ? '换成千夏风' : '换成街机风';
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    label(theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* 无痕模式里可能写不进去 */ }
  }

  btn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'arcade' ? 'chinatsu' : 'arcade';
    apply(next);
    if (window.OffsetApp && typeof window.OffsetApp.redraw === 'function') {
      try { window.OffsetApp.redraw(); } catch (e) { /* 图表还没准备好就算了 */ }
    }
  });

  apply(root.getAttribute('data-theme') || 'arcade');
})();
