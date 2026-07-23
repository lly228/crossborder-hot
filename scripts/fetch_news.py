# -*- coding: utf-8 -*-
"""多源抓取跨境电商资讯，合并进 data/news.js。

用法：
    python scripts/fetch_news.py                  常规抓取（新条目取详情页拿真实发布时间）
    python scripts/fetch_news.py --refresh-times  另外把已有条目的日期时间也按详情页刷新一遍
    python scripts/fetch_news.py --limit 20       限制每源本次最多处理的详情页数量（默认30）

行为：
- 逐源抓列表页，正则提取文章链接和标题（只接服务端渲染的源，无需浏览器）。
- 新条目抓一次详情页，取真实发布时间；拿不到时回退为抓取时刻。
- 关键词启发式分类和打热度分，作为占位；正式打分和点评由 scripts/enrich_llm.py 补。
- 与 data/news.js 按条目id去重，只追加不覆盖。
- 超过 RETENTION_DAYS 天的条目移到 data/archive/YYYY-MM.json 归档，页面只加载 news.js。
"""
import html as html_mod
import hashlib
import json
import re
import sys
import time
import urllib.request
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    if stream.encoding and stream.encoding.lower() not in ("utf-8", "utf8"):
        stream.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "news.js"
META_FILE = ROOT / "data" / "meta.js"
ARCHIVE_DIR = ROOT / "data" / "archive"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
RETENTION_DAYS = 30
DETAIL_SLEEP = 0.4  # 详情页抓取间隔，别打太快

HEADER = (
    "// 资讯数据。由 scripts/fetch_news.py 追加维护，也可手工编辑。\n"
    "// 字段说明见 README.md「数据字段」。\n"
    "window.NEWS_DATA = "
)

META_HEADER = (
    "// 数据管线状态。由 scripts/fetch_news.py 每次运行后更新。\n"
    "window.NEWS_META = "
)

CATEGORY_KEYWORDS = [
    ("policy", ["商标", "专利", "侵权", "维权", "发案", "合规", "新规", "监管", "税", "封号", "起诉", "诉讼", "下架", "审查", "禁令"]),
    ("logistics", ["物流", "海运", "空运", "清关", "海关", "关税", "海外仓", "FBA", "包装", "履约", "尾程", "头程", "仓储"]),
    ("marketing", ["广告", "ROAS", "投放", "营销", "推广", "选品", "流量", "转化", "冷启", "指南", "教程", "玩法", "带货"]),
    ("platform", ["亚马逊", "Amazon", "TikTok", "Temu", "SHEIN", "Shopee", "Lazada", "eBay", "速卖通", "沃尔玛", "Wayfair", "Etsy", "eMAG", "Ozon", "美客多", "站点", "平台"]),
]

SCORE_KEYWORDS = [
    (12, ["生效", "强制", "下架", "封号", "预警", "禁令"]),
    (8, ["新规", "政策", "调整", "更新", "关税", "税"]),
    (6, ["亚马逊", "TikTok", "Temu", "SHEIN", "Shopee"]),
    (4, ["旺季", "Prime", "黑五", "选品"]),
]

TAG_KEYWORDS = [
    ("亚马逊", ["亚马逊", "Amazon", "FBA", "FBM", "Prime"]),
    ("TikTok Shop", ["TikTok"]),
    ("Temu", ["Temu"]),
    ("SHEIN", ["SHEIN"]),
    ("Shopee", ["Shopee"]),
    ("Lazada", ["Lazada"]),
    ("速卖通", ["速卖通", "AliExpress"]),
    ("政策合规", ["新规", "政策", "监管", "合规", "禁令"]),
    ("知识产权", ["知识产权", "商标", "专利", "侵权", "维权", "诉讼", "起诉"]),
    ("物流仓储", ["物流", "海运", "空运", "清关", "海关", "海外仓", "仓储"]),
    ("广告营销", ["广告", "投放", "营销", "推广", "流量", "转化"]),
    ("选品", ["选品", "爆品", "品类"]),
]

EVENT_NOISE_WORDS = (
    "重磅", "突发", "刚刚", "官宣", "最新", "消息", "快讯", "跨境电商",
    "卖家注意", "卖家必看", "正式", "宣布", "发布",
)

EVENT_ALIASES = [
    ("tiktok shop", "tiktokshop"),
    ("wildberries", "野莓"),
    ("joybuy", "京东"),
    ("amazon", "亚马逊"),
    ("aliexpress", "速卖通"),
]

EVENT_ENTITIES = (
    "亚马逊", "tiktokshop", "temu", "shein", "shopee", "lazada",
    "速卖通", "ebay", "etsy", "野莓", "京东", "沃尔玛",
)

EVENT_SIGNALS = (
    "仓库被炸", "仓库火灾", "次日达", "数据中心", "税务报送",
    "运费补贴", "平台支持费", "佣金费率", "知识产权新规", "批量下架",
)


_HTML_CACHE = {}


def fetch_html(url, cache=False):
    if cache and url in _HTML_CACHE:
        return _HTML_CACHE[url]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    if cache:
        _HTML_CACHE[url] = text
    return text


def clean_text(text):
    text = html_mod.unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"@media[^{]*\{[^}]*\}", "", text)
    text = re.sub(r"\.css-[\w-]+\{[^}]*\}", "", text)
    text = re.sub(r"[\w.#: >,()-]*\{[^}]*\}", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.lstrip("{} ")
    if text.count("“") > text.count("”"):
        text += "”"
    if text.count("‘") > text.count("’"):
        text += "’"
    return text


# ---------- 源定义 ----------

def cifnews_extract(html):
    """雨果跨境首页。首页会混入置顶的旧文章，用「距最大id超过3000」过滤掉。"""
    pairs = re.findall(
        r'<a[^>]+href="(https?://www\.cifnews\.com/article/(\d+))"[^>]*>\s*([^<>]{10,90})\s*</a>',
        html,
    )
    if not pairs:
        return []
    max_id = max(int(aid) for _, aid, _ in pairs)
    seen, out = set(), []
    for url, aid, title in pairs:
        title = title.strip()
        if aid in seen or not title or max_id - int(aid) > 3000:
            continue
        seen.add(aid)
        out.append((aid, url, title))
    return out


def cifnews_detail_time(html):
    m = re.search(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})", html)
    return (m.group(1), m.group(2)) if m else None


def lsch_extract(html):
    """36氪出海首页。文章链接是8位hex短路径，过滤招募/活动/推广类。"""
    pairs = re.findall(r'<a[^>]+href="(/([0-9a-f]{8}))"[^>]*>(.*?)</a>', html, flags=re.S)
    seen, out = set(), []
    for path, hexid, inner in pairs:
        title = clean_text(inner)
        if hexid in seen or len(title) < 12:
            continue
        if re.search(r"36氪出海·(招募|活动|日文服务|英文服务)", title):
            continue
        seen.add(hexid)
        out.append(("lsch-" + hexid, "https://letschuhai.com" + path, title))
    return out


def lsch_detail_time(html):
    m = re.search(r"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})", html)
    return (m.group(1), m.group(2)) if m else None


def lsch_detail_summary(html):
    """取文章meta摘要。部分页面的meta是站点宣传语，识别到就放弃，留给LLM补。"""
    m = re.search(r'<meta name="description" content="([^"]{20,200})"', html)
    if not m:
        return ""
    text = m.group(1).strip()
    if "36氪出海" in text or "信息差" in text:
        return ""
    return text


def mjzj_parse_index(xml):
    """sitemap索引里编号最大的文章分卷是最新的。"""
    maps = re.findall(r"<loc>(https://mjzj\.com/sitemap/articles/(\d+))</loc>", xml)
    if not maps:
        return None
    return max(maps, key=lambda m: int(m[1]))[0]


def mjzj_parse_articles(xml, cap=80):
    """返回 [(id, lastmod)]，按lastmod倒序取最近cap条。"""
    rows = re.findall(
        r"<url><loc>https://mjzj\.com/article/([\w-]+)</loc><lastmod>([^<]+)</lastmod>", xml
    )
    rows.sort(key=lambda r: r[1], reverse=True)
    return rows[:cap]


def mjzj_discover(items):
    """卖家之家列表页是客户端渲染，走sitemap发现文章。
    标题留空，进详情页再取（最近一天的文章可能还没放出，会404，跳过等下轮）。"""
    latest = mjzj_parse_index(fetch_html("https://mjzj.com/sitemap.xml"))
    if not latest:
        return []
    return [
        ("mjzj-" + aid, "https://mjzj.com/article/" + aid, "")
        for aid, _ in mjzj_parse_articles(fetch_html(latest))
    ]


def mjzj_detail_title(html):
    m = re.search(r"<title>\s*(.*?)\s*-\s*卖家之家\s*</title>", html, flags=re.S)
    return clean_text(m.group(1)) if m else ""


def mjzj_detail_time(html):
    m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})', html)
    if m:
        return (m.group(1), m.group(2))
    m = re.search(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})", html)
    return (m.group(1), m.group(2)) if m else None


def mjzj_detail_summary(html):
    m = re.search(r'<meta name="description" content="([^"]{20,300})"', html)
    return clean_text(m.group(1)) if m else ""


def mjzj_detail_ref(html):
    """卖家之家转载的文章把原文出处写在HTML注释里：<!-- canonical: 原文URL -->。"""
    m = re.search(r"<!--\s*canonical:\s*(https?://[^\s>]+?)\s*-->", html)
    if m:
        return m.group(1)
    m = re.search(r'href="(https://www\.amz123\.com/kx/[A-Za-z0-9]+)"', html)
    return m.group(1) if m else ""


AMZ_SEED = "https://www.amz123.com/kx/wJEauwQ4"


def amz123_extract_links(html):
    """快讯页里的其他快讯链接（上一篇/下一篇导航 + 推荐列表）。"""
    return list(dict.fromkeys(re.findall(r'href="/kx/([A-Za-z0-9]+)"', html)))


def amz123_detail_title(html):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, flags=re.S)
    if m:
        return clean_text(m.group(1))
    m = re.search(r"<title>\s*(.*?)\s*-\s*AMZ123[^<]*</title>", html, flags=re.S)
    return clean_text(m.group(1)) if m else ""


def amz123_detail_time(html):
    m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})', html)
    if m:
        return (m.group(1), m.group(2))
    m = re.search(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})", html)
    return (m.group(1), m.group(2)) if m else None


def amz123_detail_summary(html):
    m = re.search(r'<meta name="description" content="([^"]{20,300})"', html)
    return clean_text(m.group(1)) if m else ""


def amz123_discover(items):
    """amz123列表页是客户端渲染、sitemap是坏的，从已知快讯页出发链式发现。

    种子：库里最近的amz123条目 + 转载文ref里的amz123链接，都没有就用固定种子。
    每个快讯页带上一篇/下一篇和推荐快讯链接，逐页扩散，页面进缓存供主流程复用。
    """
    known = {it["url"] for it in items}
    recent = sorted(items, key=lambda i: i["date"] + i["time"], reverse=True)
    seeds = [it["url"] for it in recent if it["id"].startswith("amz-")][:3]
    seeds += [it["ref"] for it in recent
              if it.get("ref", "").startswith("https://www.amz123.com/kx/")][:3]
    if not seeds:
        seeds = [AMZ_SEED]

    frontier = list(dict.fromkeys(seeds))
    visited, found, found_ids = set(), [], set()
    pages = 0
    while frontier and pages < 20 and len(found) < 30:
        url = frontier.pop(0)
        if url in visited:
            continue
        visited.add(url)
        html = fetch_detail(None, url)
        pages += 1
        if not html:
            continue
        for hexid in amz123_extract_links(html):
            u = "https://www.amz123.com/kx/" + hexid
            if u in known or hexid in found_ids or u in visited:
                continue
            found_ids.add(hexid)
            found.append(("amz-" + hexid, u, ""))
            frontier.append(u)
    return found


def _list_discover(list_url, extract):
    def discover(items):
        return extract(fetch_html(list_url))
    return discover


SOURCES = [
    {
        "name": "雨果跨境",
        "discover": _list_discover("https://www.cifnews.com/", cifnews_extract),
        "detail_time": cifnews_detail_time,
        "detail_summary": None,  # cifnews的meta描述就是标题，没用
        "detail_title": None,
        "detail_ref": None,
        "match_id": lambda item_id: item_id.isdigit(),
    },
    {
        "name": "36氪出海",
        "discover": _list_discover("https://letschuhai.com/", lsch_extract),
        "detail_time": lsch_detail_time,
        "detail_summary": lsch_detail_summary,
        "detail_title": None,
        "detail_ref": None,
        "match_id": lambda item_id: item_id.startswith("lsch-"),
    },
    {
        "name": "卖家之家",
        "discover": mjzj_discover,
        "detail_time": mjzj_detail_time,
        "detail_summary": mjzj_detail_summary,
        "detail_title": mjzj_detail_title,
        "detail_ref": mjzj_detail_ref,
        "match_id": lambda item_id: item_id.startswith("mjzj-"),
    },
    {
        "name": "AMZ123",
        "discover": amz123_discover,
        "detail_time": amz123_detail_time,
        "detail_summary": amz123_detail_summary,
        "detail_title": amz123_detail_title,
        "detail_ref": None,
        "match_id": lambda item_id: item_id.startswith("amz-"),
    },
]


# ---------- 加工 ----------

def categorize(title):
    for cat, kws in CATEGORY_KEYWORDS:
        if any(k in title for k in kws):
            return cat
    return "market"


def score(title):
    s = 55
    for pts, kws in SCORE_KEYWORDS:
        if any(k in title for k in kws):
            s += pts
    return min(s, 85)


def infer_tags(text):
    """从标题和摘要提取少量稳定标签，LLM加工后可以覆盖。"""
    return [
        label for label, keywords in TAG_KEYWORDS
        if any(keyword.lower() in text.lower() for keyword in keywords)
    ][:6]


def normalize_event_title(title):
    """生成仅用于事件相似度比较的标题文本。"""
    text = html_mod.unescape(title).lower()
    for source, target in EVENT_ALIASES:
        text = text.replace(source, target)
    for word in EVENT_NOISE_WORDS:
        text = text.replace(word.lower(), "")
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


def _bigrams(text):
    if len(text) < 2:
        return {text} if text else set()
    return {text[i:i + 2] for i in range(len(text) - 1)}


def event_similarity(title_a, title_b):
    """结合字符序列和二元组重合度，判断两个标题是否描述同一事件。"""
    a, b = normalize_event_title(title_a), normalize_event_title(title_b)
    if not a or not b:
        return 0.0
    seq = SequenceMatcher(None, a, b).ratio()
    a2, b2 = _bigrams(a), _bigrams(b)
    jac = len(a2 & b2) / len(a2 | b2) if a2 | b2 else 0.0
    base = max(seq, jac)
    shared_entity = any(entity in a and entity in b for entity in EVENT_ENTITIES)
    shared_signal = any(signal in a and signal in b for signal in EVENT_SIGNALS)
    def event_numbers(text):
        numbers = set()
        for value in re.findall(r"\d+(?:\.\d+)?", text):
            if len(value) < 2:
                continue
            if value.isdigit() and len(value) == 4 and 2020 <= int(value) <= 2039:
                continue
            numbers.add(value)
        return numbers
    numbers_a, numbers_b = event_numbers(a), event_numbers(b)
    if shared_entity and base >= 0.3 and (shared_signal or numbers_a & numbers_b):
        return max(base, 0.78)
    return base


def _event_hash(title):
    normalized = normalize_event_title(title) or title
    return "evt-" + hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]


def normalize_item(item):
    """补齐P0内容字段，兼容旧数据和未配置LLM的抓取结果。"""
    if isinstance(item.get("title"), str):
        item["title"] = clean_text(item["title"])
    item["selected"] = (
        item["selected"] if isinstance(item.get("selected"), bool)
        else item.get("score", 0) >= 65
    )
    for field in ("why", "impact", "action", "deadline"):
        if not isinstance(item.get(field), str):
            item[field] = ""
    if not isinstance(item.get("tags"), list):
        item["tags"] = infer_tags((item.get("title") or "") + (item.get("summary") or ""))
    else:
        item["tags"] = [str(tag).strip() for tag in item["tags"] if str(tag).strip()][:6]
    return item


def assign_event_ids(items, threshold=0.72, max_gap_days=3):
    """按发布时间递增匹配事件；已有条目顺序不影响最终分组。"""
    ordered = sorted(
        items,
        key=lambda it: (it.get("date", ""), it.get("time", ""), str(it.get("id", ""))),
    )
    leaders = []
    for item in ordered:
        normalize_item(item)
        try:
            item_date = datetime.strptime(item["date"], "%Y-%m-%d")
        except (KeyError, TypeError, ValueError):
            item_date = None
        best = None
        best_score = 0.0
        for leader in leaders:
            if item_date and leader["date"]:
                if abs((item_date - leader["date"]).days) > max_gap_days:
                    continue
            sim = event_similarity(item.get("title", ""), leader["title"])
            if sim >= threshold and sim > best_score:
                best, best_score = leader, sim
        if best:
            item["eventId"] = best["eventId"]
        else:
            event_id = _event_hash(item.get("title", "") or str(item.get("id", "")))
            item["eventId"] = event_id
            leaders.append({
                "date": item_date,
                "eventId": event_id,
                "title": item.get("title", ""),
            })
    return items


# ---------- 数据读写 ----------

def load_existing():
    if not DATA_FILE.exists():
        return []
    text = DATA_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.NEWS_DATA\s*=\s*(\[.*\]);?\s*$", text, flags=re.S)
    if not m:
        print("警告：无法解析现有 news.js，将视为空数据", file=sys.stderr)
        return []
    return json.loads(m.group(1))


def load_archives():
    """归档条目也要参与去重，否则被归档的旧文会被当成新文反复抓回来。"""
    rows = []
    if ARCHIVE_DIR.exists():
        for p in ARCHIVE_DIR.glob("*.json"):
            rows.extend(json.loads(p.read_text(encoding="utf-8")))
    return rows


def write_data(items):
    items.sort(key=lambda it: it["date"] + it["time"], reverse=True)
    DATA_FILE.write_text(
        HEADER + json.dumps(items, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def load_meta():
    if not META_FILE.exists():
        return {}
    m = re.search(
        r"window\.NEWS_META\s*=\s*(\{.*\});?\s*$",
        META_FILE.read_text(encoding="utf-8"),
        flags=re.S,
    )
    return json.loads(m.group(1)) if m else {}


def write_meta(items, source_results, started_at):
    previous = load_meta()
    success_count = sum(1 for row in source_results if row["status"] == "ok")
    if success_count == len(source_results):
        status = "ok"
    elif success_count:
        status = "partial"
    else:
        status = "failed"
    latest = max(
        (it.get("date", "") + "T" + it.get("time", "00:00") + ":00+08:00" for it in items),
        default="",
    )
    completed_at = datetime.now().astimezone().isoformat(timespec="seconds")
    meta = {
        "generatedAt": completed_at,
        "lastSuccessfulFetchAt": (
            completed_at if success_count else previous.get("lastSuccessfulFetchAt", "")
        ),
        "latestItemAt": latest,
        "status": status,
        "durationSeconds": round((datetime.now() - started_at).total_seconds(), 1),
        "sourceResults": source_results,
    }
    META_FILE.write_text(
        META_HEADER + json.dumps(meta, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def archive_old(items):
    """把超过保留期的条目移入 data/archive/YYYY-MM.json，返回保留的条目。"""
    cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d")
    keep = [it for it in items if it["date"] >= cutoff]
    old = [it for it in items if it["date"] < cutoff]
    if not old:
        return keep
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    by_month = {}
    for it in old:
        by_month.setdefault(it["date"][:7], []).append(it)
    for month, batch in by_month.items():
        path = ARCHIVE_DIR / (month + ".json")
        merged = {it["id"]: it for it in (json.loads(path.read_text(encoding="utf-8")) if path.exists() else [])}
        for it in batch:
            merged[it["id"]] = it
        rows = sorted(merged.values(), key=lambda it: it["date"] + it["time"], reverse=True)
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print("归档 %d 条 -> %s" % (len(batch), path.name))
    return keep


# ---------- 主流程 ----------

def fetch_detail(src, url):
    try:
        if url not in _HTML_CACHE:
            time.sleep(DETAIL_SLEEP)
        return fetch_html(url, cache=True)
    except Exception as e:
        print("  详情页抓取失败 %s: %s" % (url, e), file=sys.stderr)
        return ""


def main():
    started_at = datetime.now()
    args = sys.argv[1:]
    refresh_times = "--refresh-times" in args
    limit = 30
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])

    items = load_existing()
    everything = items + load_archives()
    known_ids = {it["id"] for it in everything}
    known_urls = {it["url"] for it in everything}
    # 同一篇文章可能挂在多个不同链接下（36氪出海出现过），标题也要去重
    known_titles = {(it["source"], it["title"]) for it in everything}
    # 转载文的原文链接。ref指向已收录条目时跳过，避免同一事件出现两遍
    known_refs = {it["ref"] for it in everything if it.get("ref")}
    now = datetime.now()
    added = 0
    source_results = []

    for src in SOURCES:
        try:
            listing = src["discover"](everything)
        except Exception as e:
            print("来源发现失败 %s: %s" % (src["name"], e), file=sys.stderr)
            source_results.append({
                "name": src["name"],
                "status": "failed",
                "discovered": 0,
                "added": 0,
                "error": type(e).__name__,
            })
            continue
        budget = limit
        source_added = 0
        for uid, url, title in listing:
            if uid in known_ids or url in known_urls or budget <= 0:
                continue
            if url in known_refs:
                # 这篇的内容已通过转载收录过
                continue
            budget -= 1
            date_s, time_s = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
            summary = ""
            ref = ""
            detail = fetch_detail(src, url)
            if detail:
                dt = src["detail_time"](detail)
                if dt:
                    date_s, time_s = dt
                if src["detail_summary"]:
                    summary = src["detail_summary"](detail)
                if src["detail_title"] and not title:
                    title = src["detail_title"](detail)
                if src["detail_ref"]:
                    ref = src["detail_ref"](detail)
            if not title:
                # 发现渠道没给标题且详情页也没拿到（如卖家之家未放出的新文），下轮再试
                continue
            if (src["name"], title) in known_titles:
                continue
            if ref and (ref in known_urls or ref in known_refs):
                continue
            entry = {
                "id": uid, "date": date_s, "time": time_s,
                "source": src["name"], "url": url,
                "score": score(title + summary), "category": categorize(title + summary),
                "title": title, "summary": summary,
            }
            normalize_item(entry)
            if ref:
                entry["ref"] = ref
            items.append(entry)
            known_ids.add(uid)
            known_urls.add(url)
            known_titles.add((src["name"], title))
            if ref:
                known_refs.add(ref)
            added += 1
            source_added += 1
            print("+ [%s] %s" % (src["name"], title[:40]))
        source_results.append({
            "name": src["name"],
            "status": "ok",
            "discovered": len(listing),
            "added": source_added,
        })

    if refresh_times:
        for src in SOURCES:
            targets = [it for it in items if src["match_id"](it["id"])][:limit]
            for it in targets:
                detail = fetch_detail(src, it["url"])
                dt = src["detail_time"](detail) if detail else None
                if dt and (it["date"], it["time"]) != dt:
                    print("~ 时间修正 %s: %s %s -> %s %s" % (it["id"], it["date"], it["time"], dt[0], dt[1]))
                    it["date"], it["time"] = dt

    assign_event_ids(items)
    items = archive_old(items)
    write_data(items)
    write_meta(items, source_results, started_at)
    print("本次新增 %d 条，news.js 现有 %d 条" % (added, len(items)))


if __name__ == "__main__":
    main()
