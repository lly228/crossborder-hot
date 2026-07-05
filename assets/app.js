/* 跨境HOT 渲染逻辑：分组、分类筛选、搜索、本地收藏。数据来自 data/news.js 的 window.NEWS_DATA。 */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'all', label: '全部' },
    { id: 'platform', label: '平台' },
    { id: 'policy', label: '政策合规' },
    { id: 'logistics', label: '物流' },
    { id: 'marketing', label: '营销' },
    { id: 'market', label: '行情' }
  ];
  var CAT_LABEL = {};
  CATEGORIES.forEach(function (c) { CAT_LABEL[c.id] = c.label; });

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var STORE_KEY = 'cbhot-starred';

  var state = {
    category: 'all',
    keyword: '',
    view: 'feed', // feed | starred
    starred: loadStarred()
  };

  var feedEl = document.getElementById('feed');
  var tabsEl = document.getElementById('tabs');
  var emptyEl = document.getElementById('emptyState');
  var emptyTextEl = document.getElementById('emptyText');
  var titleEl = document.getElementById('feedTitle');
  var searchEl = document.getElementById('searchInput');

  function loadStarred() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveStarred() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.starred)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function fmtDayLabel(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return {
      main: Number(p[1]) + '月' + Number(p[2]) + '日',
      sub: WEEKDAYS[d.getDay()]
    };
  }

  function scoreClass(score) {
    if (score >= 75) return 'score score-high';
    if (score >= 65) return 'score score-mid';
    return 'score';
  }

  function getItems() {
    var items = (window.NEWS_DATA || []).slice();
    if (state.view === 'starred') {
      items = items.filter(function (it) { return state.starred[it.id]; });
    }
    if (state.category !== 'all') {
      items = items.filter(function (it) { return it.category === state.category; });
    }
    if (state.keyword) {
      var kw = state.keyword.toLowerCase();
      items = items.filter(function (it) {
        return (it.title + it.summary + it.source).toLowerCase().indexOf(kw) >= 0;
      });
    }
    items.sort(function (a, b) {
      return (b.date + b.time).localeCompare(a.date + a.time);
    });
    return items;
  }

  function render() {
    var items = getItems();
    feedEl.innerHTML = '';

    if (!items.length) {
      emptyEl.hidden = false;
      emptyTextEl.textContent = state.view === 'starred'
        ? '还没有收藏，点条目右侧的星标即可收藏'
        : '没有匹配的条目，换个关键词或分类试试';
      return;
    }
    emptyEl.hidden = true;

    var currentDate = null;
    var idx = 0;
    items.forEach(function (it) {
      if (it.date !== currentDate) {
        currentDate = it.date;
        var day = fmtDayLabel(it.date);
        var bar = document.createElement('div');
        bar.className = 'daybar';
        bar.innerHTML = '<span class="daybar-main"></span><span class="daybar-sub"></span>';
        bar.children[0].textContent = day.main;
        bar.children[1].textContent = day.sub;
        feedEl.appendChild(bar);
      }
      feedEl.appendChild(renderRow(it, idx));
      idx++;
    });
  }

  function renderRow(it, idx) {
    var row = document.createElement('article');
    row.className = 'row';
    // 交错入场，只对前一屏内的行做延迟
    row.style.animationDelay = Math.min(idx, 12) * 40 + 'ms';

    var time = document.createElement('span');
    time.className = 'row-time';
    time.textContent = it.time;

    var body = document.createElement('div');
    body.className = 'row-body';

    var meta = document.createElement('div');
    meta.className = 'row-meta';
    var badge = document.createElement('span');
    badge.className = 'cat-badge';
    badge.textContent = CAT_LABEL[it.category] || it.category;
    var src = document.createElement('span');
    src.className = 'row-src';
    src.textContent = it.source;
    var score = document.createElement('span');
    score.className = scoreClass(it.score);
    score.textContent = it.score;
    score.title = '热度分';
    meta.appendChild(badge);
    meta.appendChild(src);
    meta.appendChild(score);

    var title = document.createElement('a');
    title.className = 'row-title';
    title.href = it.url;
    title.target = '_blank';
    title.rel = 'noopener';
    title.textContent = it.title;

    var summary = document.createElement('p');
    summary.className = 'row-summary';
    summary.style.margin = '0';
    summary.textContent = it.summary;

    body.appendChild(meta);
    body.appendChild(title);
    if (it.summary) body.appendChild(summary);

    var star = document.createElement('button');
    star.type = 'button';
    var on = !!state.starred[it.id];
    star.className = on ? 'star star-on' : 'star';
    star.textContent = on ? '★' : '☆';
    star.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    star.setAttribute('aria-pressed', String(on));
    star.addEventListener('click', function () {
      if (state.starred[it.id]) {
        delete state.starred[it.id];
      } else {
        state.starred[it.id] = 1;
      }
      saveStarred();
      render();
    });

    row.appendChild(time);
    row.appendChild(body);
    row.appendChild(star);
    return row;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      var active = state.category === c.id;
      b.className = active ? 'tab tab-active' : 'tab';
      b.setAttribute('aria-selected', String(active));
      b.textContent = c.label;
      b.addEventListener('click', function () {
        state.category = c.id;
        renderTabs();
        render();
      });
      tabsEl.appendChild(b);
    });
  }

  function setView(view) {
    state.view = view;
    titleEl.textContent = view === 'starred' ? '我的收藏' : '最新精选';
    document.querySelectorAll('.side-link[data-view]').forEach(function (el) {
      el.classList.toggle('side-link-active', el.getAttribute('data-view') === view);
    });
    render();
  }

  // 顶部日期
  (function () {
    var now = new Date();
    document.getElementById('todayLabel').textContent =
      (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' + WEEKDAYS[now.getDay()];
  })();

  document.querySelectorAll('.side-link[data-view]').forEach(function (el) {
    el.addEventListener('click', function () { setView(el.getAttribute('data-view')); });
  });

  var searchTimer = null;
  searchEl.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.keyword = searchEl.value.trim();
      render();
    }, 200);
  });

  renderTabs();
  render();
})();
