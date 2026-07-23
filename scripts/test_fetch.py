# -*- coding: utf-8 -*-
"""fetch_news.py 核心逻辑的自测：分类、打分、列表提取过滤、归档切分。

用法：python scripts/test_fetch.py（全部通过时退出码0）
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_news as fn

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

failures = []


def check(name, cond):
    if not cond:
        failures.append(name)
    print(("ok " if cond else "FAIL ") + name)


# 分类
check("categorize 商标->policy", fn.categorize("KZOYNEA商标维权！") == "policy")
check("categorize FBA->logistics", fn.categorize("亚马逊FBA包装尺寸认证") == "logistics")
check("categorize 广告->marketing", fn.categorize("eMAG Ads广告基础设置") == "marketing")
check("categorize 亚马逊->platform", fn.categorize("亚马逊上线新功能") == "platform")
check("categorize 兜底->market", fn.categorize("刚刚，安克登陆港交所！") == "market")

# 打分
check("score 命中生效+新规+平台", fn.score("亚马逊新规7月生效") == 55 + 12 + 8 + 6)
check("score 无命中=55", fn.score("两个年轻人的创业故事") == 55)
check("score 上限85", fn.score("亚马逊TikTok新规生效强制下架关税旺季选品") == 85)

# P0内容字段与事件聚合
check("infer_tags 平台与合规", fn.infer_tags("亚马逊欧洲站发布知识产权新规") == ["亚马逊", "政策合规", "知识产权"])
legacy = {"id": "legacy", "date": "2026-07-01", "time": "10:00", "score": 70,
          "title": "亚马逊新规", "summary": "", "source": "测试", "url": "https://example.com/a"}
fn.normalize_item(legacy)
check("normalize_item 旧数据补精选", legacy["selected"] is True)
check("normalize_item 旧数据补P0字段", all(k in legacy for k in ("why", "impact", "action", "deadline", "tags")))
event_items = [
    {"id": "e1", "date": "2026-07-01", "time": "10:00", "score": 75,
     "title": "亚马逊欧洲站推出促销一键拓展功能", "summary": "", "source": "来源A", "url": "https://example.com/e1"},
    {"id": "e2", "date": "2026-07-02", "time": "11:00", "score": 72,
     "title": "亚马逊欧洲站上线促销一键拓展新功能", "summary": "", "source": "来源B", "url": "https://example.com/e2"},
    {"id": "e3", "date": "2026-07-02", "time": "12:00", "score": 70,
     "title": "TikTok Shop调整东南亚佣金费率", "summary": "", "source": "来源C", "url": "https://example.com/e3"},
]
fn.assign_event_ids(event_items)
check("assign_event_ids 相似事件合并", event_items[0]["eventId"] == event_items[1]["eventId"])
check("assign_event_ids 不同事件分开", event_items[0]["eventId"] != event_items[2]["eventId"])
first_event_ids = [it["eventId"] for it in event_items]
fn.assign_event_ids(event_items)
check("assign_event_ids 重复运行稳定", first_event_ids == [it["eventId"] for it in event_items])
check(
    "event_similarity 平台别名事件合并",
    fn.event_similarity(
        "Wildberries 4个仓库被炸，近2万中国店铺受影响",
        "野莓又有仓库被炸，大批货物烧毁",
    ) >= 0.72,
)
check(
    "event_similarity 同平台不同主题不合并",
    fn.event_similarity(
        "TikTok Shop欧洲中小卖家现在要不要做",
        "TikTok Shop旺季选品怎么做",
    ) < 0.72,
)

# cifnews 列表提取：旧id过滤
html_cif = (
    '<a href="https://www.cifnews.com/article/187296" title="x">欧洲热爆了！降温神器被疯抢</a>'
    '<a href="https://www.cifnews.com/article/119693">Falabella平台简介说明书</a>'
    '<a href="https://www.cifnews.com/article/187296">欧洲热爆了！降温神器被疯抢</a>'
)
rows = fn.cifnews_extract(html_cif)
check("cifnews 提取1条且去重", len(rows) == 1 and rows[0][0] == "187296")

# lsch 列表提取：短标题、招募活动过滤、css垃圾清理
html_lsch = (
    '<a href="/9f9745fe"><em class="x">.css-1s00u8u{line-height:28px;}</em>中国公司全球化周报，速卖通首发出海成交榜</a>'
    '<a href="/44f6cd00">36氪出海·活动｜投资合作高峰洽谈会成功举办</a>'
    '<a href="/aabbccdd">短标题</a>'
)
rows = fn.lsch_extract(html_lsch)
check("lsch 提取1条", len(rows) == 1 and rows[0][0] == "lsch-9f9745fe")
check("lsch 标题干净", rows[0][2] == "中国公司全球化周报，速卖通首发出海成交榜")
check("clean_text 去@media", fn.clean_text("@media screen and (min-width: 48em){}大停电后一年") == "大停电后一年")
check("clean_text 解HTML实体", fn.clean_text("一周要闻·阿联酋&#038;卡塔尔动态汇总") == "一周要闻·阿联酋&卡塔尔动态汇总")
check("clean_text 去残留大括号", fn.clean_text("}中国品牌出海，海外网红不够用了") == "中国品牌出海，海外网红不够用了")

# lsch 摘要：站点宣传语要放弃
check("lsch 摘要取正文摘要", fn.lsch_detail_summary('<meta name="description" content="经历了大停电痛楚的西班牙，迅速反思并走出此前的发展模式">') == "经历了大停电痛楚的西班牙，迅速反思并走出此前的发展模式")
check("lsch 摘要拒绝宣传语", fn.lsch_detail_summary('<meta name="description" content="聚焦中国公司全球化大事，36氪出海致力于消除信息差，让读者尽收眼底。">') == "")

# 卖家之家（sitemap发现 + 详情页提取）
idx_xml = '<sitemapindex><sitemap><loc>https://mjzj.com/sitemap/common</loc></sitemap><sitemap><loc>https://mjzj.com/sitemap/articles/2</loc></sitemap><sitemap><loc>https://mjzj.com/sitemap/articles/11</loc></sitemap></sitemapindex>'
check("mjzj 索引取最大分卷", fn.mjzj_parse_index(idx_xml) == "https://mjzj.com/sitemap/articles/11")
art_xml = ('<url><loc>https://mjzj.com/article/aaa111</loc><lastmod>2026-07-01T10:00:00</lastmod></url>'
           '<url><loc>https://mjzj.com/article/bbb222</loc><lastmod>2026-07-03T10:00:00</lastmod></url>')
rows = fn.mjzj_parse_articles(art_xml)
check("mjzj 分卷按时间倒序", [r[0] for r in rows] == ["bbb222", "aaa111"])
check("mjzj 标题去后缀", fn.mjzj_detail_title("<title>\n  亚马逊欧洲站推出促销一键拓展功能-卖家之家\n</title>") == "亚马逊欧洲站推出促销一键拓展功能")
check("mjzj 发布时间", fn.mjzj_detail_time('"datePublished":"2026-07-02T11:42:37+08:00"') == ("2026-07-02", "11:42"))
check("mjzj 摘要", fn.mjzj_detail_summary('<meta name="description" content="亚马逊欧洲站卖家后台新增全欧拓展功能，支持一键复制促销到多个站点。">') == "亚马逊欧洲站卖家后台新增全欧拓展功能，支持一键复制促销到多个站点。")
check("mjzj 原始来源canonical注释", fn.mjzj_detail_ref('<p></p><!-- canonical: https://www.amz123.com/kx/wJEauwQ4 --><p>正文</p>') == "https://www.amz123.com/kx/wJEauwQ4")
check("mjzj 原始来源href兜底", fn.mjzj_detail_ref('<a href="https://www.amz123.com/kx/wJEauwQ4">来源</a>') == "https://www.amz123.com/kx/wJEauwQ4")
check("mjzj 无来源返回空", fn.mjzj_detail_ref('<a href="https://mjzj.com/x">站内</a>') == "")

# AMZ123（链式发现 + 详情页提取）
amz_html = ('<a href="/kx/0CWptcE8" class="article-nav-prev"></a>'
            '<a href="/kx/B3jFUy0J" class="article-nav-next">下一篇</a>'
            '<a href="/kx/TV3AT2yu" class="kx-item-title">AI服务功能调整</a>'
            '<a href="/kx/0CWptcE8">重复的</a><a href="/kx">列表页不算</a>')
check("amz123 提取快讯链接去重", fn.amz123_extract_links(amz_html) == ["0CWptcE8", "B3jFUy0J", "TV3AT2yu"])
check("amz123 标题取h1", fn.amz123_detail_title('<h1 class="x">亚马逊欧洲站推出促销一键拓展功能</h1>') == "亚马逊欧洲站推出促销一键拓展功能")
check("amz123 标题title兜底", fn.amz123_detail_title("<title>某快讯标题-AMZ123跨境导航</title>") == "某快讯标题")
check("amz123 时间", fn.amz123_detail_time('"datePublished":"2026-07-02T11:42:37+08:00"') == ("2026-07-02", "11:42"))
check("amz123 摘要", fn.amz123_detail_summary('<meta name="description" content="AMZ123获悉，亚马逊欧洲站卖家后台新增全欧拓展功能，支持一键复制。">') == "AMZ123获悉，亚马逊欧洲站卖家后台新增全欧拓展功能，支持一键复制。")

# 详情时间解析
check("cifnews 时间", fn.cifnews_detail_time("发布于 2026-07-03 17:45 阅读") == ("2026-07-03", "17:45"))
check("lsch 时间", fn.lsch_detail_time('datetime="2026-07-05T09:15:00"') == ("2026-07-05", "09:15"))
check("时间缺失返回None", fn.cifnews_detail_time("没有时间") is None)

# 归档切分（写入scratch目录，不动真实数据）
import tempfile
with tempfile.TemporaryDirectory() as tmp:
    fn.ARCHIVE_DIR = Path(tmp)
    today = datetime.now()
    fresh = today.strftime("%Y-%m-%d")
    old = (today - timedelta(days=fn.RETENTION_DAYS + 10)).strftime("%Y-%m-%d")
    items = [
        {"id": "a", "date": fresh, "time": "10:00", "title": "新"},
        {"id": "b", "date": old, "time": "10:00", "title": "旧"},
    ]
    keep = fn.archive_old(items)
    check("归档后保留新条目", [it["id"] for it in keep] == ["a"])
    archived = list(Path(tmp).glob("*.json"))
    check("归档文件生成", len(archived) == 1 and old[:7] in archived[0].name)

# 抓取状态元数据
with tempfile.TemporaryDirectory() as tmp:
    original_meta_file = fn.META_FILE
    fn.META_FILE = Path(tmp) / "meta.js"
    fn.write_meta(
        [{"date": "2026-07-23", "time": "10:00"}],
        [
            {"name": "来源A", "status": "ok", "discovered": 2, "added": 1},
            {"name": "来源B", "status": "failed", "discovered": 0, "added": 0},
        ],
        datetime.now(),
    )
    meta = fn.load_meta()
    check("meta 部分失败状态", meta["status"] == "partial")
    check("meta 最新条目时间", meta["latestItemAt"] == "2026-07-23T10:00:00+08:00")
    fn.META_FILE = original_meta_file

print()
if failures:
    print("失败 %d 项: %s" % (len(failures), ", ".join(failures)))
    sys.exit(1)
print("全部通过")
