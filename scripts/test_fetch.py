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

# lsch 摘要：站点宣传语要放弃
check("lsch 摘要取正文摘要", fn.lsch_detail_summary('<meta name="description" content="经历了大停电痛楚的西班牙，迅速反思并走出此前的发展模式">') == "经历了大停电痛楚的西班牙，迅速反思并走出此前的发展模式")
check("lsch 摘要拒绝宣传语", fn.lsch_detail_summary('<meta name="description" content="聚焦中国公司全球化大事，36氪出海致力于消除信息差，让读者尽收眼底。">') == "")

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

print()
if failures:
    print("失败 %d 项: %s" % (len(failures), ", ".join(failures)))
    sys.exit(1)
print("全部通过")
