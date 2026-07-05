/* 跨境HOT 渲染逻辑。视图：精选/全部/收藏/日报/周报/月报/主题，数据来自 data/news.js。 */
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
  // 报告视图里分区的展示顺序，按对卖家经营的直接程度排
  var REPORT_CAT_ORDER = ['platform', 'policy', 'logistics', 'marketing', 'market'];

  var TOPICS = [
    { id: 'amazon', label: '亚马逊', re: /亚马逊|Amazon|FBA|FBM|Prime/i },
    { id: 'tiktok', label: 'TikTok Shop', re: /TikTok/i },
    { id: 'temu', label: 'Temu·SHEIN·速卖通', re: /Temu|SHEIN|速卖通|AliExpress|全托管/i },
    { id: 'sea', label: '东南亚', re: /Shopee|Lazada|东南亚|泰国|菲律宾|越南|马来|印尼|新加坡/i },
    { id: 'compliance', label: '合规与知产', re: /关税|合规|征税|补税|商标|专利|维权|发案|新规|监管|封号|下架|侵权|版权/i },
    { id: 'logi', label: '物流仓储', re: /物流|海运|空运|海外仓|清关|仓储|履约|尾程|头程|港口|订舱/i }
  ];

  var VIEWS = {
    featured: '最新精选',
    all: '全部动态',
    starred: '我的收藏',
    daily: '跨境日报',
    weekly: '跨境周报',
    monthly: '跨境月报'
  };
  var FEATURED_MIN_SCORE = 65;
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var STORE_KEY = 'cbhot-starred';

  var state = {
    view: 'featured',
    topic: null,
    category: 'all',
    keyword: '',
    dailyDate: null,
    starred: loadStarred()
  };

  var feedEl = document.getElementById('feed');
  var tabsEl = document.getElementById('tabs');
  var emptyEl = document.getElementById('emptyState');
  var emptyTextEl = document.getElementById('emptyText');
  var titleEl = document.getElementById('feedTitle');
  var searchEl = document.getElementById('searchInput');
  var topicNavEl = document.getElementById('topicNav');
  var mobileNavEl = document.getElementById('mobileNav');

  function loadStarred() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveStarred() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.starred)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function dayLabel(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return { main: Number(p[1]) + '月' + Number(p[2]) + '日', sub: WEEKDAYS[d.getDay()] };
  }
  function shortDate(dateStr) {
    var p = dateStr.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }
  function scoreClass(score) {
    if (score >= 75) return 'score score-high';
    if (score >= FEATURED_MIN_SCORE) return 'score score-mid';
    return 'score';
  }
  function shiftDate(dateStr, days) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function allDates() {
    var seen = {};
    (window.NEWS_DATA || []).forEach(function (it) { seen[it.date] = 1; });
    return Object.keys(seen).sort().reverse();
  }

  function applyCommonFilters(items) {
    if (state.category !== 'all') {
      items = items.filter(function (it) { return it.category === state.category; });
    }
    if (state.keyword) {
      var kw = state.keyword.toLowerCase();
      items = items.filter(function (it) {
        return (it.title + (it.summary || '') + it.source).toLowerCase().indexOf(kw) >= 0;
      });
    }
    return items;
  }

  function byTimeDesc(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); }
  function byScoreDesc(a, b) { return (b.score - a.score) || byTimeDesc(a, b); }

  function getItems() {
    var items = (window.NEWS_DATA || []).slice();
    if (state.view === 'featured') {
      items = items.filter(function (it) { return it.score >= FEATURED_MIN_SCORE; });
    } else if (state.view === 'starred') {
      items = items.filter(function (it) { return state.starred[it.id]; });
    } else if (state.view === 'topic') {
      var topic = TOPICS.filter(function (t) { return t.id === state.topic; })[0];
      if (topic) {
        items = items.filter(function (it) { return topic.re.test(it.title + (it.summary || '')); });
      }
    } else if (state.view === 'daily') {
      var date = state.dailyDate || allDates()[0];
      items = items.filter(function (it) { return it.date === date; });
    } else if (state.view === 'weekly') {
      var latest = allDates()[0];
      if (latest) {
        var from = shiftDate(latest, -6);
        items = items.filter(function (it) { return it.date >= from; });
      }
    }
    // monthly：news.js 本身就只保留最近30天，全量即月报范围
    items = applyCommonFilters(items);
    var isReport = state.view === 'daily' || state.view === 'weekly' || state.view === 'monthly';
    items.sort(isReport ? byScoreDesc : byTimeDesc);
    if (state.view === 'weekly') items = items.slice(0, 30);
    if (state.view === 'monthly') items = items.slice(0, 60);
    return items;
  }

  // ---------- 渲染 ----------

  function render() {
    var items = getItems();
    feedEl.innerHTML = '';

    if (state.view === 'daily') renderDailyHead();
    else if (state.view === 'weekly') renderRangeHead('最近7天 · 按热度取前30条');
    else if (state.view === 'monthly') renderRangeHead('最近30天 · 按热度取前60条');

    if (!items.length) {
      emptyEl.hidden = false;
      emptyTextEl.textContent =
        state.view === 'starred' ? '还没有收藏，点条目右侧的星标即可收藏'
        : state.view === 'featured' ? '这个筛选下暂时没有高热度条目，可以切到「全部」看'
        : '没有匹配的条目，换个关键词或分类试试';
      return;
    }
    emptyEl.hidden = true;

    if (state.view === 'daily') renderFlat(items, false);
    else if (state.view === 'weekly' || state.view === 'monthly') renderGrouped(items);
    else renderTimeline(items);
  }

  function renderTimeline(items) {
    var currentDate = null, idx = 0;
    items.forEach(function (it) {
      if (it.date !== currentDate) {
        currentDate = it.date;
        var day = dayLabel(it.date);
        var bar = document.createElement('div');
        bar.className = 'daybar';
        bar.innerHTML = '<span class="daybar-main"></span><span class="daybar-sub"></span>';
        bar.children[0].textContent = day.main;
        bar.children[1].textContent = day.sub;
        feedEl.appendChild(bar);
      }
      feedEl.appendChild(renderRow(it, idx++, false));
    });
  }

  function renderFlat(items, withDate) {
    var idx = 0;
    items.forEach(function (it) { feedEl.appendChild(renderRow(it, idx++, withDate)); });
  }

  function renderGrouped(items) {
    var byCat = {};
    items.forEach(function (it) { (byCat[it.category] = byCat[it.category] || []).push(it); });
    var idx = 0;
    REPORT_CAT_ORDER.forEach(function (cat) {
      var group = byCat[cat];
      if (!group || !group.length) return;
      var head = document.createElement('div');
      head.className = 'section-head';
      head.innerHTML = '<span class="section-title"></span><span class="section-count"></span>';
      head.children[0].textContent = CAT_LABEL[cat];
      head.children[1].textContent = group.length + '条';
      feedEl.appendChild(head);
      group.forEach(function (it) { feedEl.appendChild(renderRow(it, idx++, true)); });
    });
  }

  function renderDailyHead() {
    var dates = allDates();
    if (!dates.length) return;
    var date = state.dailyDate || dates[0];
    state.dailyDate = date;
    var i = dates.indexOf(date);
    var day = dayLabel(date);

    var head = document.createElement('div');
    head.className = 'report-head';
    var info = document.createElement('div');
    var h = document.createElement('div');
    h.className = 'report-title';
    h.textContent = day.main + ' · ' + day.sub;
    var sub = document.createElement('div');
    sub.className = 'report-sub';
    sub.textContent = '当日条目按热度排序';
    info.appendChild(h);
    info.appendChild(sub);

    var nav = document.createElement('div');
    nav.className = 'daynav';
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '‹ 前一天';
    prev.disabled = i >= dates.length - 1;
    prev.addEventListener('click', function () { state.dailyDate = dates[i + 1]; render(); });
    var next = document.createElement('button');
    next.type = 'button';
    next.textContent = '后一天 ›';
    next.disabled = i <= 0;
    next.addEventListener('click', function () { state.dailyDate = dates[i - 1]; render(); });
    nav.appendChild(prev);
    nav.appendChild(next);

    head.appendChild(info);
    head.appendChild(nav);
    feedEl.appendChild(head);
  }

  function renderRangeHead(text) {
    var head = document.createElement('div');
    head.className = 'report-head';
    var sub = document.createElement('div');
    sub.className = 'report-sub';
    sub.textContent = text + ' · 按分类分区';
    head.appendChild(sub);
    feedEl.appendChild(head);
  }

  function renderRow(it, idx, withDate) {
    var row = document.createElement('article');
    row.className = 'row';
    row.style.animationDelay = Math.min(idx, 12) * 40 + 'ms';

    var time = document.createElement('span');
    time.className = 'row-time';
    time.textContent = withDate ? shortDate(it.date) : it.time;
    time.title = it.date + ' ' + it.time;

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
    meta.appendChild(badge);
    meta.appendChild(src);
    if (it.ref) {
      var ref = document.createElement('a');
      ref.className = 'row-ref';
      ref.href = it.ref;
      ref.target = '_blank';
      ref.rel = 'noopener';
      ref.textContent = '原始来源';
      meta.appendChild(ref);
    }
    var score = document.createElement('span');
    score.className = scoreClass(it.score);
    score.textContent = it.score;
    score.title = '热度分';
    meta.appendChild(score);

    var title = document.createElement('a');
    title.className = 'row-title';
    title.href = it.url;
    title.target = '_blank';
    title.rel = 'noopener';
    title.textContent = it.title;

    body.appendChild(meta);
    body.appendChild(title);
    if (it.summary) {
      var summary = document.createElement('p');
      summary.className = 'row-summary';
      summary.style.margin = '0';
      summary.textContent = it.summary;
      body.appendChild(summary);
    }

    var star = document.createElement('button');
    star.type = 'button';
    var on = !!state.starred[it.id];
    star.className = on ? 'star star-on' : 'star';
    star.textContent = on ? '★' : '☆';
    star.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    star.setAttribute('aria-pressed', String(on));
    star.addEventListener('click', function () {
      if (state.starred[it.id]) delete state.starred[it.id];
      else state.starred[it.id] = 1;
      saveStarred();
      render();
    });

    row.appendChild(time);
    row.appendChild(body);
    row.appendChild(star);
    return row;
  }

  // ---------- 导航 ----------

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

  function setView(view, topicId) {
    state.view = view;
    state.topic = topicId || null;
    if (view !== 'daily') state.dailyDate = null;
    if (view === 'topic') {
      var topic = TOPICS.filter(function (t) { return t.id === topicId; })[0];
      titleEl.textContent = topic ? '主题 · ' + topic.label : '主题';
    } else {
      titleEl.textContent = VIEWS[view] || VIEWS.featured;
    }
    syncNavActive();
    render();
  }

  function syncNavActive() {
    document.querySelectorAll('[data-view], [data-topic]').forEach(function (el) {
      var active = el.hasAttribute('data-topic')
        ? (state.view === 'topic' && el.getAttribute('data-topic') === state.topic)
        : (state.view === el.getAttribute('data-view'));
      el.classList.toggle(el.classList.contains('mchip') ? 'mchip-active' : 'side-link-active', active);
    });
  }

  function buildNav() {
    // 侧边栏主题
    TOPICS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'side-link';
      b.setAttribute('data-topic', t.id);
      b.textContent = t.label;
      topicNavEl.appendChild(b);
    });
    // 移动端横向导航：视图 + 主题
    Object.keys(VIEWS).forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mchip';
      b.setAttribute('data-view', v);
      b.textContent = VIEWS[v].replace('最新', '').replace('全部动态', '全部').replace('我的', '').replace('跨境', '');
      mobileNavEl.appendChild(b);
    });
    var sep = document.createElement('span');
    sep.className = 'mchip-sep';
    mobileNavEl.appendChild(sep);
    TOPICS.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mchip';
      b.setAttribute('data-topic', t.id);
      b.textContent = t.label;
      mobileNavEl.appendChild(b);
    });

    document.querySelectorAll('[data-view]').forEach(function (el) {
      el.addEventListener('click', function () { setView(el.getAttribute('data-view')); });
    });
    document.querySelectorAll('[data-topic]').forEach(function (el) {
      el.addEventListener('click', function () { setView('topic', el.getAttribute('data-topic')); });
    });
  }

  // ---------- 启动 ----------

  (function () {
    var now = new Date();
    document.getElementById('todayLabel').textContent =
      (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' + WEEKDAYS[now.getDay()];
  })();

  var searchTimer = null;
  searchEl.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.keyword = searchEl.value.trim();
      render();
    }, 200);
  });

  buildNav();
  renderTabs();
  setView('featured');
})();
