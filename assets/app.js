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
    hot: '热点榜',
    starred: '我的收藏',
    daily: '跨境日报',
    weekly: '跨境周报',
    monthly: '跨境月报'
  };
  var REPORT_CFG = {
    daily: { title: '日报', eng: 'DAILY', cadence: 'DAILY · 每日更新' },
    weekly: { title: '周报', eng: 'WEEKLY', cadence: 'WEEKLY · 最近7天' },
    monthly: { title: '月报', eng: 'MONTHLY', cadence: 'MONTHLY · 最近30天' }
  };
  var CAT_ENG = {
    platform: 'Platforms',
    policy: 'Policy & IP',
    logistics: 'Logistics',
    marketing: 'Marketing',
    market: 'Markets'
  };
  var FEATURED_MIN_SCORE = 65;
  var SOURCE_TYPE_LABEL = { official: '官方', community: '社区' };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var STORE_KEY = 'cbhot-starred';
  var READ_KEY = 'cbhot-read';
  var THEME_KEY = 'cbhot-theme';

  var state = {
    view: 'featured',
    topic: null,
    category: 'all',
    keyword: '',
    unreadOnly: false,
    visibleCount: 60,
    dailyDate: null,
    starred: loadStarred(),
    read: loadObject(READ_KEY)
  };

  var feedEl = document.getElementById('feed');
  var tabsEl = document.getElementById('tabs');
  var emptyEl = document.getElementById('emptyState');
  var emptyTextEl = document.getElementById('emptyText');
  var retryButtonEl = document.getElementById('retryButton');
  var readToastEl = document.getElementById('readToast');
  var undoReadButtonEl = document.getElementById('undoReadButton');
  var titleEl = document.getElementById('feedTitle');
  var searchEl = document.getElementById('searchInput');
  var topicNavEl = document.getElementById('topicNav');
  var mobileNavEl = document.getElementById('mobileNav');
  var freshnessEl = document.getElementById('freshnessLabel');
  var hotspotsEl = document.getElementById('hotspots');
  var unreadToggleEl = document.getElementById('unreadToggle');
  var themeToggleEl = document.getElementById('themeToggle');
  var mobileThemeToggleEl = document.getElementById('mobileThemeToggle');
  var lastReadKey = null;
  var readToastTimer = null;

  function loadObject(key) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) { return {}; }
  }

  function loadStarred() {
    return loadObject(STORE_KEY);
  }
  function saveStarred() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.starred)); } catch (e) { /* 隐私模式下忽略 */ }
  }
  function isStarred(it) {
    if (state.starred[it.eventId] || state.starred[it.id]) return true;
    return (it._eventItems || []).some(function (source) { return !!state.starred[source.id]; });
  }
  function toggleStar(it) {
    if (isStarred(it)) {
      delete state.starred[it.eventId];
      (window.NEWS_DATA || []).forEach(function (source) {
        if (source.eventId === it.eventId) delete state.starred[source.id];
      });
    } else {
      state.starred[it.eventId] = 1;
    }
    saveStarred();
    render();
  }

  function readKey(it) { return it.eventId || it.id; }
  function isRead(it) { return !!state.read[readKey(it)]; }
  function saveRead() {
    try { localStorage.setItem(READ_KEY, JSON.stringify(state.read)); } catch (e) { /* 隐私模式下忽略 */ }
  }
  function markUnread(it) {
    delete state.read[readKey(it)];
    saveRead();
    if (lastReadKey === readKey(it)) readToastEl.hidden = true;
    render();
  }
  function markRead(it) {
    if (isRead(it)) return;
    lastReadKey = readKey(it);
    state.read[lastReadKey] = 1;
    saveRead();
    readToastEl.hidden = false;
    clearTimeout(readToastTimer);
    readToastTimer = setTimeout(function () { readToastEl.hidden = true; }, 8000);
    setTimeout(render, 0);
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* 隐私模式下忽略 */ }
    var preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (preferred ? 'dark' : 'light');
    updateThemeButton();
  }
  function updateThemeButton() {
    var dark = document.documentElement.dataset.theme === 'dark';
    if (themeToggleEl) {
      themeToggleEl.textContent = dark ? '☀ 浅色' : '☾ 深色';
      themeToggleEl.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
    }
    if (mobileThemeToggleEl) {
      mobileThemeToggleEl.textContent = dark ? '☀' : '☾';
      mobileThemeToggleEl.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
    }
  }

  function dayLabel(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return { main: Number(p[1]) + '月' + Number(p[2]) + '日', sub: WEEKDAYS[d.getDay()] };
  }

  var CN_DIGIT = '〇一二三四五六七八九';
  function cnNum(n) {
    if (n <= 10) return n === 10 ? '十' : CN_DIGIT[n];
    if (n < 20) return '十' + CN_DIGIT[n % 10];
    return CN_DIGIT[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
  }
  function cnDate(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var year = String(p[0]).split('').map(function (ch) { return CN_DIGIT[Number(ch)]; }).join('');
    return year + '年' + cnNum(Number(p[1])) + '月' + cnNum(Number(p[2])) + '日　星期' +
      '日一二三四五六'.charAt(d.getDay());
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

  function normalizeNewsItems() {
    (window.NEWS_DATA || []).forEach(function (it) {
      if (typeof it.selected !== 'boolean') it.selected = Number(it.score || 0) >= FEATURED_MIN_SCORE;
      ['why', 'impact', 'action', 'deadline'].forEach(function (field) {
        if (typeof it[field] !== 'string') it[field] = '';
      });
      if (!Array.isArray(it.tags)) it.tags = [];
      if (!it.eventId) it.eventId = 'evt-item-' + it.id;
      if (!/^(official|media|community)$/.test(it.sourceType || '')) it.sourceType = 'media';
    });
  }

  function sourceTypeBadge(it) {
    var label = SOURCE_TYPE_LABEL[it.sourceType];
    return label ? el('span', 'source-type source-type-' + it.sourceType, label) : null;
  }

  function distinctSources(items) {
    var seen = {};
    var sourceByUrl = {};
    items.forEach(function (it) { sourceByUrl[it.url] = it.source; });
    return items.filter(function (it) {
      var key = it.ref ? (sourceByUrl[it.ref] || it.ref) : it.source;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function collapseEvents(items) {
    var grouped = {};
    items.forEach(function (it) {
      var key = it.eventId || ('evt-item-' + it.id);
      (grouped[key] = grouped[key] || []).push(it);
    });
    return Object.keys(grouped).map(function (key) {
      var group = grouped[key].slice().sort(function (a, b) {
        var scoreDiff = Number(b.score) - Number(a.score);
        if (scoreDiff) return scoreDiff;
        var aDetail = (a.summary ? 1 : 0) + (a.why ? 1 : 0);
        var bDetail = (b.summary ? 1 : 0) + (b.why ? 1 : 0);
        return (bDetail - aDetail) || byTimeDesc(a, b);
      });
      var rep = Object.assign({}, group[0]);
      rep._eventItems = group;
      return rep;
    });
  }

  function renderFreshness() {
    if (!freshnessEl) return;
    if (!(window.NEWS_DATA || []).length) {
      freshnessEl.textContent = '资讯暂不可用';
      freshnessEl.className = 'freshness freshness-stale';
      return;
    }
    var meta = window.NEWS_META || {};
    var latest = meta.latestItemAt || ((allDates()[0] || '') + 'T00:00:00+08:00');
    var when = latest ? new Date(latest) : null;
    if (!when || isNaN(when.getTime())) {
      freshnessEl.textContent = '更新时间未知';
      freshnessEl.className = 'freshness freshness-unknown';
      return;
    }
    var hours = Math.max(0, (Date.now() - when.getTime()) / 3600000);
    if (meta.status === 'failed') {
      freshnessEl.textContent = '最近抓取失败';
      freshnessEl.className = 'freshness freshness-stale';
      freshnessEl.title = '页面保留上一次成功抓取的数据';
    } else if (meta.status === 'partial' && hours <= 72) {
      freshnessEl.textContent = '部分来源延迟';
      freshnessEl.className = 'freshness freshness-delayed';
      freshnessEl.title = '最近一次抓取有部分来源失败';
    } else if (hours <= 24) {
      var latestDate = allDates()[0];
      var recent = (window.NEWS_DATA || []).filter(function (it) { return it.date === latestDate; });
      var selectedRecent = recent.filter(function (it) { return it.selected; });
      var processed = selectedRecent.filter(function (it) { return !!it.why; }).length;
      var pending = selectedRecent.length > 0 && processed < selectedRecent.length / 2;
      freshnessEl.textContent = pending ? '已抓取 · 待点评' : '数据已更新';
      freshnessEl.className = pending ? 'freshness freshness-delayed' : 'freshness freshness-fresh';
      if (pending) freshnessEl.title = '最近一天的资讯已有抓取数据，但尚无模型生成的推荐理由';
    } else if (hours <= 72) {
      freshnessEl.textContent = '数据延迟' + Math.floor(hours) + '小时';
      freshnessEl.className = 'freshness freshness-delayed';
    } else {
      freshnessEl.textContent = '数据停更' + Math.floor(hours / 24) + '天';
      freshnessEl.className = 'freshness freshness-stale';
    }
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

  // 以事件为单位统计近48小时的独立信源；同一来源多篇报道只计一次。
  function hotEvents() {
    var items = window.NEWS_DATA || [];
    if (!items.length) return [];
    var latest = items.map(function (it) { return new Date(it.date + 'T' + (it.time || '00:00') + ':00+08:00').getTime(); })
      .filter(function (n) { return Number.isFinite(n); })
      .sort(function (a, b) { return b - a; })[0];
    if (!latest) return [];
    var recent = items.filter(function (it) {
      var time = new Date(it.date + 'T' + (it.time || '00:00') + ':00+08:00').getTime();
      return Number.isFinite(time) && time >= latest - 48 * 3600000;
    });
    return collapseEvents(recent).filter(function (event) {
      // 没有足够事实内容的快讯不占用热点榜位置。
      return (event._eventItems || [event]).some(function (it) {
        return it.sourceType === 'official' || (it.summary || '').length >= 40;
      });
    }).map(function (event) {
      var sources = distinctSources(event._eventItems || [event]);
      var heat = sources.reduce(function (sum, source) {
        var time = new Date(source.date + 'T' + (source.time || '00:00') + ':00+08:00').getTime();
        var ageHours = Math.max(0, (latest - time) / 3600000);
        var weight = source.sourceType === 'official' ? 1.25 : source.sourceType === 'community' ? 0.6 : 1;
        return sum + weight * Math.pow(0.5, ageHours / 24);
      }, 0);
      event._sourceCount = sources.length;
      event._heat = Math.round(sources.length * 40 + heat * 30);
      return event;
    }).sort(function (a, b) { return (b._heat - a._heat) || byTimeDesc(a, b); });
  }

  function getItems() {
    var items = (window.NEWS_DATA || []).slice();
    if (state.view === 'featured') {
      items = items.filter(function (it) { return it.selected; });
    } else if (state.view === 'starred') {
      items = items.filter(isStarred);
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
    if (state.view === 'featured' || state.view === 'starred' || isReport) items = collapseEvents(items);
    if (state.unreadOnly && !isReport) items = items.filter(function (it) { return !isRead(it); });
    if (state.view === 'weekly') items = items.slice(0, 30);
    if (state.view === 'monthly') items = items.slice(0, 60);
    return items;
  }

  // ---------- 渲染 ----------

  function render() {
    var items = getItems();
    feedEl.innerHTML = '';
    renderHotspots();

    if (!(window.NEWS_DATA || []).length) {
      emptyEl.hidden = false;
      emptyTextEl.textContent = '资讯数据暂不可用，请稍后刷新页面';
      retryButtonEl.hidden = false;
      return;
    }
    retryButtonEl.hidden = true;

    if (state.view === 'hot') {
      emptyEl.hidden = true;
      renderHotRanking();
      return;
    }

    if (REPORT_CFG[state.view]) {
      emptyEl.hidden = true;
      renderReport(items);
      return;
    }
    if (!items.length) {
      emptyEl.hidden = false;
      emptyTextEl.textContent =
        state.view === 'starred' && !Object.keys(state.starred).length ? '还没有收藏，点条目右侧的星标即可收藏'
        : state.unreadOnly ? '没有未读结果，调整搜索或关闭只看未读'
        : state.view === 'featured' ? '这个筛选下暂时没有精选条目，可以切到全部查看'
        : '没有匹配的条目，换个关键词或分类试试';
      return;
    }
    emptyEl.hidden = true;
    renderTimeline(items);
  }

  function renderHotspots() {
    if (!hotspotsEl) return;
    hotspotsEl.innerHTML = '';
    var show = state.view === 'featured' && state.category === 'all' && !state.keyword;
    if (!show) {
      hotspotsEl.hidden = true;
      return;
    }
    var events = hotEvents().filter(function (it) { return !state.unreadOnly || !isRead(it); }).slice(0, 5);
    if (!events.length) {
      hotspotsEl.hidden = true;
      return;
    }

    var head = el('div', 'hotspots-head');
    head.appendChild(el('h2', 'hotspots-title', '当前热点'));
    var more = el('button', 'hotspots-more', '完整榜单 →');
    more.type = 'button';
    more.addEventListener('click', function () { setView('hot'); });
    head.appendChild(more);
    hotspotsEl.appendChild(head);
    var list = el('ol', 'hotspots-list');
    events.forEach(function (it) {
      var sources = distinctSources(it._eventItems || [it]);
      var li = el('li', 'hotspot-item');
      if (isRead(it)) li.classList.add('hotspot-read');
      var link = el('a', 'hotspot-link', it.title);
      link.href = it.url;
      link.target = '_blank';
      link.rel = 'noopener';
      li.appendChild(link);
      link.addEventListener('click', function () { markRead(it); });
      li.appendChild(el('span', 'hotspot-meta', it._heat + ' 热度 · ' + sources.length + ' 个信源'));
      list.appendChild(li);
    });
    hotspotsEl.appendChild(list);
    hotspotsEl.hidden = false;
  }

  function renderHotRanking() {
    var intro = el('div', 'hot-intro');
    intro.appendChild(el('p', 'hot-kicker', 'TRENDING · 48 HOURS'));
    intro.appendChild(el('h2', 'hot-intro-title', '过去48小时，大家在关注什么'));
    intro.appendChild(el('p', 'hot-intro-copy', '同一件事合并展示，每个独立信源只计一次。来源数决定基础热度，时效加分每24小时减半；仅纳入有事实摘要或官方来源的事件。'));
    feedEl.appendChild(intro);
    var events = hotEvents().filter(function (it) {
      if (state.category !== 'all' && it.category !== state.category) return false;
      if (state.keyword && (it.title + (it.summary || '')).toLowerCase().indexOf(state.keyword.toLowerCase()) < 0) return false;
      return !state.unreadOnly || !isRead(it);
    });
    if (!events.length) {
      feedEl.appendChild(el('p', 'mag-empty', '这个筛选下暂无热点'));
      return;
    }
    var list = el('ol', 'hot-ranking');
    events.slice(0, 30).forEach(function (it, i) {
      var item = el('li', isRead(it) ? 'hot-rank-item hot-rank-read' : 'hot-rank-item');
      item.appendChild(el('span', 'hot-rank-number', ('0' + (i + 1)).slice(-2)));
      var body = el('div', 'hot-rank-body');
      var rankMeta = el('div', 'hot-rank-meta', CAT_LABEL[it.category] + ' · ' + it._sourceCount + ' 个独立信源');
      if (isRead(it)) {
        var rankUnread = el('button', 'mark-unread', '已读 · 标为未读');
        rankUnread.type = 'button';
        rankUnread.addEventListener('click', function () { markUnread(it); });
        rankMeta.appendChild(rankUnread);
      }
      body.appendChild(rankMeta);
      var link = el('a', 'hot-rank-title', it.title);
      link.href = it.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.addEventListener('click', function () { markRead(it); });
      body.appendChild(link);
      if (it.summary) body.appendChild(el('p', 'hot-rank-summary', it.summary));
      item.appendChild(body);
      var heat = el('div', 'hot-rank-heat');
      heat.appendChild(el('strong', null, String(it._heat)));
      heat.appendChild(el('span', null, '热度'));
      item.appendChild(heat);
      list.appendChild(item);
    });
    feedEl.appendChild(list);
  }

  function renderTimeline(items) {
    var currentDate = null, idx = 0;
    var counts = {};
    items.forEach(function (it) { counts[it.date] = (counts[it.date] || 0) + 1; });
    items.slice(0, state.visibleCount).forEach(function (it) {
      if (it.date !== currentDate) {
        currentDate = it.date;
        var day = dayLabel(it.date);
        var bar = document.createElement('div');
        bar.className = 'daybar';
        bar.innerHTML = '<span class="daybar-main"></span><span class="daybar-sub"></span><span class="daybar-count"></span>';
        bar.children[0].textContent = day.main;
        bar.children[1].textContent = day.sub;
        bar.children[2].textContent = counts[it.date] + ' 条';
        feedEl.appendChild(bar);
      }
      feedEl.appendChild(renderRow(it, idx++, false));
    });
    if (items.length > state.visibleCount) {
      var more = el('button', 'load-more', '继续查看 · 还有 ' + (items.length - state.visibleCount) + ' 条');
      more.type = 'button';
      more.addEventListener('click', function () {
        state.visibleCount += 60;
        render();
      });
      feedEl.appendChild(more);
    }
  }

  // ---------- 杂志式报告（日报/周报/月报） ----------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function reportDateLine() {
    var dates = allDates();
    if (state.view === 'daily') {
      return cnDate(state.dailyDate || dates[0] || '');
    }
    var latest = dates[0];
    if (!latest) return '';
    var from = shiftDate(latest, state.view === 'weekly' ? -6 : -29);
    var f = dayLabel(from), t = dayLabel(latest);
    return f.main + ' 至 ' + t.main;
  }

  function reportVolDate() {
    if (state.view === 'daily') {
      return (state.dailyDate || allDates()[0] || '').replace(/-/g, '.');
    }
    return (allDates()[0] || '').replace(/-/g, '.');
  }

  function renderReport(items) {
    var cfg = REPORT_CFG[state.view];
    var wrap = el('div', 'mag');

    // 刊头
    var vol = el('div', 'mag-vol');
    vol.appendChild(el('span', null, 'VOL. ' + reportVolDate()));
    vol.appendChild(el('span', null, items.length + ' STORIES'));
    vol.appendChild(el('span', null, '跨境HOT ' + cfg.eng));
    wrap.appendChild(vol);

    var masthead = el('div', 'mag-masthead');
    var brand = el('div', 'mag-title');
    brand.appendChild(el('span', 'mag-title-cn', '跨境'));
    brand.appendChild(el('em', null, 'HOT'));
    brand.appendChild(el('span', 'mag-title-kind', cfg.title));
    masthead.appendChild(brand);
    masthead.appendChild(el('div', 'mag-date', reportDateLine()));
    masthead.appendChild(el('div', 'mag-cadence', cfg.cadence));
    wrap.appendChild(masthead);

    // 当日导语（enrich_llm --report 生成，可能没有）
    if (state.view === 'daily') {
      var reports = (window.NEWS_REPORTS || {}).daily || {};
      var intro = (reports[state.dailyDate || allDates()[0]] || {}).intro;
      if (intro) {
        var introBox = el('div', 'mag-intro');
        introBox.appendChild(el('div', 'mag-intro-label', '编辑导语'));
        introBox.appendChild(el('p', 'mag-intro-text', intro));
        wrap.appendChild(introBox);
      }
    }

    if (!items.length) {
      wrap.appendChild(el('p', 'mag-empty', '这个时间段没有条目'));
      if (state.view === 'daily') wrap.appendChild(buildDayNav());
      feedEl.appendChild(wrap);
      return;
    }

    // 分区
    var byCat = {};
    items.forEach(function (it) { (byCat[it.category] = byCat[it.category] || []).push(it); });
    var sections = [];
    REPORT_CAT_ORDER.forEach(function (cat) {
      if (byCat[cat] && byCat[cat].length) sections.push({ cat: cat, items: byCat[cat] });
    });

    // 看点目录
    var toc = el('div', 'mag-toc');
    toc.appendChild(el('div', 'mag-toc-label',
      (state.view === 'daily' ? '今日看点' : state.view === 'weekly' ? '本周看点' : '本月看点')));
    sections.slice(0, 4).forEach(function (sec, i) {
      var row = el('div', 'mag-toc-item');
      row.appendChild(el('span', 'mag-toc-num', ('0' + (i + 1)).slice(-2)));
      row.appendChild(el('span', 'mag-toc-cat', CAT_LABEL[sec.cat]));
      row.appendChild(el('span', 'mag-toc-title', sec.items[0].title));
      toc.appendChild(row);
    });
    wrap.appendChild(toc);

    // 正文分区
    sections.forEach(function (sec, i) {
      var secEl = el('section', 'mag-section');
      var head = el('div', 'mag-sechead');
      head.appendChild(el('span', 'mag-secnum', ('0' + (i + 1)).slice(-2)));
      var st = el('div', 'mag-sectitles');
      st.appendChild(el('div', 'mag-sectitle', CAT_LABEL[sec.cat]));
      st.appendChild(el('div', 'mag-seceng', CAT_ENG[sec.cat] + ' · ' + sec.items.length + '篇'));
      head.appendChild(st);
      secEl.appendChild(head);

      sec.items.forEach(function (it) {
        var block = el('article', 'mag-item');
        var title = el('a', 'mag-item-title', it.title);
        title.href = it.url;
        title.target = '_blank';
        title.rel = 'noopener';
        title.addEventListener('click', function () { markRead(it); });
        block.appendChild(title);
        var meta = el('div', 'mag-item-meta');
        meta.appendChild(el('span', null, it.source));
        var reportSourceType = sourceTypeBadge(it);
        if (reportSourceType) meta.appendChild(reportSourceType);
        if (state.view !== 'daily') meta.appendChild(el('span', null, shortDate(it.date)));
        if (it.ref) {
          var ref = el('a', 'row-ref', '原始来源');
          ref.href = it.ref;
          ref.target = '_blank';
          ref.rel = 'noopener';
          meta.appendChild(ref);
        }
        meta.appendChild(el('span', scoreClass(it.score), String(it.score)));
        block.appendChild(meta);
        if (it.summary) block.appendChild(el('p', 'mag-item-text', it.summary));
        secEl.appendChild(block);
      });
      wrap.appendChild(secEl);
    });

    // 统计
    var srcCount = {};
    items.forEach(function (it) {
      (it._eventItems || [it]).forEach(function (sourceItem) {
        srcCount[sourceItem.source] = 1;
      });
    });
    var hot = items.filter(function (it) { return it.score >= 75; }).length;
    var stats = el('div', 'mag-stats');
    [[items.length, state.view === 'daily' ? '今日条目' : '条目'],
     [hot, '高热条目'],
     [Object.keys(srcCount).length, '信源']].forEach(function (s) {
      var cell = el('div', 'mag-stat');
      cell.appendChild(el('div', 'mag-stat-num', String(s[0])));
      cell.appendChild(el('div', 'mag-stat-label', s[1]));
      stats.appendChild(cell);
    });
    wrap.appendChild(stats);

    // 引流卡
    var cross = state.view === 'daily'
      ? { text: '这周太忙没跟上？跨境周报把整周大事浓缩成5分钟', btn: '读本周周报 →', view: 'weekly' }
      : state.view === 'weekly'
        ? { text: '想看更长的趋势？跨境月报覆盖最近30天的头部动态', btn: '读本月月报 →', view: 'monthly' }
        : { text: '回到今天，看最新的高热条目', btn: '去最新精选 →', view: 'featured' };
    var crossEl = el('div', 'mag-cross');
    crossEl.appendChild(el('span', 'mag-cross-text', cross.text));
    var crossBtn = el('button', 'mag-cross-btn', cross.btn);
    crossBtn.type = 'button';
    crossBtn.addEventListener('click', function () { setView(cross.view); });
    crossEl.appendChild(crossBtn);
    wrap.appendChild(crossEl);

    if (state.view === 'daily') wrap.appendChild(buildDayNav());
    wrap.appendChild(el('div', 'mag-foot', '跨境HOT · 编辑系统自动生成'));
    feedEl.appendChild(wrap);
  }

  function buildDayNav() {
    var dates = allDates();
    var date = state.dailyDate || dates[0];
    var i = dates.indexOf(date);
    var nav = el('div', 'daynav daynav-bottom');
    var prev = el('button', null, '‹ 前一日');
    prev.type = 'button';
    prev.disabled = i < 0 || i >= dates.length - 1;
    prev.addEventListener('click', function () { state.dailyDate = dates[i + 1]; render(); window.scrollTo(0, 0); });
    var next = el('button', null, '后一日 ›');
    next.type = 'button';
    next.disabled = i <= 0;
    next.addEventListener('click', function () { state.dailyDate = dates[i - 1]; render(); window.scrollTo(0, 0); });
    nav.appendChild(prev);
    nav.appendChild(next);
    return nav;
  }

  function renderRow(it, idx, withDate) {
    var row = document.createElement('article');
    row.className = isRead(it) ? 'row row-read' : 'row';
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
    var typeBadge = sourceTypeBadge(it);
    if (typeBadge) meta.appendChild(typeBadge);
    var eventSources = distinctSources(it._eventItems || [it]);
    if (eventSources.length > 1) {
      meta.appendChild(el('span', 'source-count', '另有' + (eventSources.length - 1) + '个信源'));
    }
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
    score.title = '经营影响分';
    meta.appendChild(score);
    if (isRead(it)) {
      var unread = el('button', 'mark-unread', '标为未读');
      unread.type = 'button';
      unread.addEventListener('click', function () { markUnread(it); });
      meta.appendChild(unread);
    }

    var title = document.createElement('a');
    title.className = 'row-title';
    title.href = it.url;
    title.target = '_blank';
    title.rel = 'noopener';
    title.textContent = it.title;
    title.addEventListener('click', function () { markRead(it); });

    body.appendChild(meta);
    body.appendChild(title);
    if (it.summary) {
      var summary = document.createElement('p');
      summary.className = 'row-summary';
      summary.style.margin = '0';
      summary.textContent = it.summary;
      body.appendChild(summary);
    }
    if (it.why) {
      var why = el('p', 'row-why');
      why.appendChild(el('span', 'row-field-label', '推荐理由'));
      why.appendChild(document.createTextNode(it.why));
      body.appendChild(why);
    }
    if (it.impact || it.action || it.deadline) {
      var insight = el('div', 'row-insight');
      if (it.impact) {
        var impact = el('div', 'row-insight-line');
        impact.appendChild(el('span', 'row-field-label', '卖家影响'));
        impact.appendChild(document.createTextNode(it.impact));
        insight.appendChild(impact);
      }
      if (it.action) {
        var action = el('div', 'row-insight-line');
        action.appendChild(el('span', 'row-field-label', '建议动作'));
        action.appendChild(document.createTextNode(it.action));
        insight.appendChild(action);
      }
      if (it.deadline) {
        var deadline = el('div', 'row-insight-line');
        deadline.appendChild(el('span', 'row-field-label', '截止日期'));
        deadline.appendChild(document.createTextNode(it.deadline));
        insight.appendChild(deadline);
      }
      body.appendChild(insight);
    }
    if (eventSources.length > 1) {
      var related = el('div', 'row-related');
      related.appendChild(el('span', 'row-field-label', '相关信源'));
      eventSources.forEach(function (sourceItem) {
        var sourceLink = el('a', null, sourceItem.source);
        sourceLink.href = sourceItem.url;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener';
        related.appendChild(sourceLink);
      });
      body.appendChild(related);
    }

    var star = document.createElement('button');
    star.type = 'button';
    var on = isStarred(it);
    star.className = on ? 'star star-on' : 'star';
    star.textContent = on ? '★' : '☆';
    star.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    star.setAttribute('aria-pressed', String(on));
    star.addEventListener('click', function () {
      toggleStar(it);
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
        state.visibleCount = 60;
        renderTabs();
        render();
        window.scrollTo(0, 0);
      });
      tabsEl.appendChild(b);
    });
  }

  function setView(view, topicId) {
    state.view = (VIEWS[view] || view === 'topic') ? view : 'featured';
    state.visibleCount = 60;
    state.topic = topicId || null;
    if (view !== 'daily') state.dailyDate = null;
    if (view === 'topic') {
      var topic = TOPICS.filter(function (t) { return t.id === topicId; })[0];
      titleEl.textContent = topic ? '主题 · ' + topic.label : '主题';
    } else {
      titleEl.textContent = VIEWS[state.view] || VIEWS.featured;
    }
    if (unreadToggleEl) unreadToggleEl.hidden = !!REPORT_CFG[state.view];
    syncNavActive();
    render();
    window.scrollTo(0, 0);
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

  normalizeNewsItems();
  initTheme();
  renderFreshness();

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
      state.visibleCount = 60;
      render();
    }, 200);
  });

  if (unreadToggleEl) unreadToggleEl.addEventListener('click', function () {
    state.unreadOnly = !state.unreadOnly;
    state.visibleCount = 60;
    unreadToggleEl.setAttribute('aria-pressed', String(state.unreadOnly));
    unreadToggleEl.classList.toggle('filter-on', state.unreadOnly);
    render();
  });
  function toggleTheme() {
    var dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme); } catch (e) { /* 隐私模式下忽略 */ }
    updateThemeButton();
  }
  if (themeToggleEl) themeToggleEl.addEventListener('click', toggleTheme);
  if (mobileThemeToggleEl) mobileThemeToggleEl.addEventListener('click', toggleTheme);
  if (retryButtonEl) retryButtonEl.addEventListener('click', function () { location.reload(); });
  if (undoReadButtonEl) undoReadButtonEl.addEventListener('click', function () {
    if (lastReadKey) {
      delete state.read[lastReadKey];
      saveRead();
      lastReadKey = null;
      readToastEl.hidden = true;
      render();
    }
  });

  buildNav();
  renderTabs();
  setView('featured');
})();
