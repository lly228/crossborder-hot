# -*- coding: utf-8 -*-
"""用LLM补事实摘要、经营影响、行动建议、精选判断、评分和分类，以及生成日报导语。

用法：
    python scripts/enrich_llm.py            处理所有P0内容字段未完成的条目
    python scripts/enrich_llm.py --all      所有条目重新加工（含已有点评的）
    python scripts/enrich_llm.py --report   给最新一天生成日报导语，写入 data/reports.js
    python scripts/enrich_llm.py --dry-run  只打印将要发送的条目，不调API

配置（环境变量，或项目根目录 .env.local 文件里的 KEY=VALUE 行）：
    CBHOT_LLM_API_KEY    必填，API密钥
    CBHOT_LLM_BASE_URL   默认 https://api.deepseek.com/v1（任意OpenAI兼容接口）
    CBHOT_LLM_MODEL      默认 deepseek-chat

.env.local 已在 .gitignore 里，密钥不入库。
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    if _stream.encoding and _stream.encoding.lower() not in ("utf-8", "utf8"):
        _stream.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "news.js"
REPORTS_FILE = ROOT / "data" / "reports.js"
BATCH_SIZE = 15

REPORTS_HEADER = (
    "// 报告附加内容（当日导语等），由 scripts/enrich_llm.py --report 生成，可为空。\n"
    "// 结构：{ \"daily\": { \"YYYY-MM-DD\": { \"intro\": \"当日导语文本\" } } }\n"
    "window.NEWS_REPORTS = "
)

INTRO_PROMPT = """你是跨境电商日报的编辑，读者是平台卖家和出海从业者。根据当日资讯清单写一段80到120字的日报导语：概括当天最值得卖家注意的1到3件事，说清各自影响哪类卖家。全部用中文标点，语气平实，不用感叹号。只输出导语正文，无需其他内容。"""

HEADER = (
    "// 资讯数据。由 scripts/fetch_news.py 追加维护，也可手工编辑。\n"
    "// 字段说明见 README.md「数据字段」。\n"
    "window.NEWS_DATA = "
)

SYSTEM_PROMPT = """你是跨境电商行业资讯编辑，读者是亚马逊、TikTok Shop、Temu、SHEIN、Shopee、Lazada等平台的中小卖家和运营负责人。对每条资讯输出：

1. score：0到100的整数，衡量对卖家经营的直接影响。政策生效、账号封禁、费用调整、商标专利发案给75到95；平台功能更新、重要市场数据给60到75；教程、案例故事、活动宣传给40到60。
2. selected：布尔值。卖家值得在当天花时间阅读时为true。它是编辑判断，与score分别判断。
3. summary：40到90字的事实摘要，只概括发生了什么。
4. why：30到70字的推荐理由，说明为什么值得关注。
5. impact：30到70字，说明影响哪些平台、地区或卖家。
6. action：20到60字，给出卖家可以执行的下一步；信息不足时输出空字符串。
7. deadline：明确存在生效日或截止日时输出YYYY-MM-DD，否则输出空字符串。
8. tags：1到6个简短中文标签，优先使用平台、地区、政策合规、知识产权、物流仓储、广告营销、选品。
9. category：从platform、policy、logistics、marketing、market中选一个。platform是平台规则与功能，policy是政策法规与知识产权，logistics是物流仓储关税，marketing是营销投放选品方法，market是市场行情与行业动态。
10. title：原始标题不是中文时，翻译成准确、简洁的中文标题；原始标题是中文时保持原样。

信源类型会随条目提供：official是平台官方，media是行业媒体，community是社区讨论。社区讨论只能作为经验、问题线索或卖家反馈，不得把未经官方证实的说法写成确定事实；community条目的selected必须为false。

只输出JSON数组。每个对象包含id、title、score、selected、summary、why、impact、action、deadline、tags、category。"""


def load_env_local():
    env_file = ROOT / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def load_items():
    text = DATA_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.NEWS_DATA\s*=\s*(\[.*\]);?\s*$", text, flags=re.S)
    return json.loads(m.group(1))


def write_items(items):
    DATA_FILE.write_text(
        HEADER + json.dumps(items, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def normalize_items(items):
    for it in items:
        if not isinstance(it.get("selected"), bool):
            it["selected"] = int(it.get("score", 0)) >= 65
        for field in ("why", "impact", "action", "deadline"):
            if not isinstance(it.get(field), str):
                it[field] = ""
        if not isinstance(it.get("tags"), list):
            it["tags"] = []
        if it.get("sourceType") not in ("official", "media", "community"):
            it["sourceType"] = "media"
        if it["sourceType"] == "community":
            it["selected"] = False
    return items


def call_llm(base_url, api_key, model, batch):
    user_content = json.dumps(
        [{
            "id": it["id"],
            "title": it["title"],
            "source": it["source"],
            "source_type": it.get("sourceType", "media"),
            "source_summary": it.get("summary", ""),
        } for it in batch],
        ensure_ascii=False,
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.3,
    }
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    return json.loads(content)


def call_llm_text(base_url, api_key, model, system, user):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.4,
    }
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


def load_reports():
    if not REPORTS_FILE.exists():
        return {"daily": {}}
    m = re.search(r"window\.NEWS_REPORTS\s*=\s*(\{.*\});?\s*$",
                  REPORTS_FILE.read_text(encoding="utf-8"), flags=re.S)
    return json.loads(m.group(1)) if m else {"daily": {}}


def gen_report(base_url, api_key, model, items, dry_run):
    """给最新一天生成日报导语。"""
    dates = sorted({it["date"] for it in items}, reverse=True)
    if not dates:
        print("没有数据")
        return
    date = dates[0]
    day_items = sorted([it for it in items if it["date"] == date],
                       key=lambda it: it["score"], reverse=True)
    listing = "\n".join(
        "- [%s] %s：%s" % (it["source"], it["title"], it.get("summary") or "无摘要")
        for it in day_items[:20]
    )
    print("生成 %s 的日报导语，素材 %d 条" % (date, min(len(day_items), 20)))
    if dry_run:
        print(listing)
        return
    intro = call_llm_text(base_url, api_key, model, INTRO_PROMPT, listing)
    reports = load_reports()
    reports.setdefault("daily", {})[date] = {"intro": intro}
    REPORTS_FILE.write_text(
        REPORTS_HEADER + json.dumps(reports, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print("导语已写入 %s" % REPORTS_FILE)
    print(intro)


def main():
    args = sys.argv[1:]
    do_all = "--all" in args
    dry_run = "--dry-run" in args
    do_report = "--report" in args

    load_env_local()
    items = normalize_items(load_items())

    if do_report:
        api_key = os.environ.get("CBHOT_LLM_API_KEY")
        if not api_key and not dry_run:
            print("缺少 CBHOT_LLM_API_KEY，设置环境变量或写入 .env.local 后重试", file=sys.stderr)
            sys.exit(1)
        gen_report(
            os.environ.get("CBHOT_LLM_BASE_URL", "https://api.deepseek.com/v1"),
            api_key, os.environ.get("CBHOT_LLM_MODEL", "deepseek-chat"),
            items, dry_run,
        )
        return
    required_fields = ("summary", "why", "impact")
    targets = [
        it for it in items
        if do_all or any(not it.get(field) for field in required_fields)
    ]
    if not targets:
        print("没有需要加工的条目")
        return
    print("待加工 %d 条" % len(targets))

    if dry_run:
        for it in targets:
            print("  [%s] %s" % (it["id"], it["title"][:50]))
        return

    api_key = os.environ.get("CBHOT_LLM_API_KEY")
    if not api_key:
        print("缺少 CBHOT_LLM_API_KEY，设置环境变量或写入 .env.local 后重试", file=sys.stderr)
        sys.exit(1)
    base_url = os.environ.get("CBHOT_LLM_BASE_URL", "https://api.deepseek.com/v1")
    model = os.environ.get("CBHOT_LLM_MODEL", "deepseek-chat")

    by_id = {it["id"]: it for it in items}
    updated = 0
    for i in range(0, len(targets), BATCH_SIZE):
        batch = targets[i:i + BATCH_SIZE]
        try:
            results = call_llm(base_url, api_key, model, batch)
        except Exception as e:
            print("批次 %d 调用失败: %s" % (i // BATCH_SIZE + 1, e), file=sys.stderr)
            continue
        for row in results:
            it = by_id.get(str(row.get("id")))
            if not it:
                continue
            if isinstance(row.get("score"), int) and 0 <= row["score"] <= 100:
                it["score"] = row["score"]
            if isinstance(row.get("selected"), bool):
                it["selected"] = row["selected"]
            if isinstance(row.get("title"), str) and row["title"].strip():
                it["title"] = row["title"].strip()
            if row.get("summary"):
                it["summary"] = str(row["summary"]).strip()
            for field in ("why", "impact", "action"):
                if isinstance(row.get(field), str):
                    it[field] = row[field].strip()
            deadline = row.get("deadline")
            if isinstance(deadline, str) and (
                not deadline or re.fullmatch(r"\d{4}-\d{2}-\d{2}", deadline)
            ):
                it["deadline"] = deadline
            tags = row.get("tags")
            if isinstance(tags, list):
                it["tags"] = [
                    str(tag).strip() for tag in tags
                    if str(tag).strip()
                ][:6]
            if row.get("category") in ("platform", "policy", "logistics", "marketing", "market"):
                it["category"] = row["category"]
            updated += 1
        print("批次 %d 完成，累计更新 %d 条" % (i // BATCH_SIZE + 1, updated))

    normalize_items(items)
    write_items(items)
    print("完成，共更新 %d 条 -> %s" % (updated, DATA_FILE))


if __name__ == "__main__":
    main()
