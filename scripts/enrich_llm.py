# -*- coding: utf-8 -*-
"""用LLM给资讯条目补点评、重打热度分、校正分类。

用法：
    python scripts/enrich_llm.py            处理所有 summary 为空的条目
    python scripts/enrich_llm.py --all      所有条目重新加工（含已有点评的）
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

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "news.js"
BATCH_SIZE = 15

HEADER = (
    "// 资讯数据。由 scripts/fetch_news.py 追加维护，也可手工编辑。\n"
    "// 字段说明见 README.md「数据字段」。\n"
    "window.NEWS_DATA = "
)

SYSTEM_PROMPT = """你是跨境电商行业资讯编辑，读者是平台卖家和出海从业者。对输入的每条资讯标题输出三项：

1. score：0到100的整数，衡量这条资讯对卖家经营的直接影响。政策生效、账号封禁、费用调整、商标专利发案这类直接影响钱和账号安全的给75到95；平台功能更新、重要市场数据给60到75；教程、案例故事、活动宣传给40到60。
2. summary：一句话点评，40到70个字，说清这条资讯影响哪类卖家、需要做什么动作。全部用中文标点，语气平实。
3. category：从 platform、policy、logistics、marketing、market 五个里选一个。platform是平台规则与功能，policy是政策法规与知识产权，logistics是物流仓储关税，marketing是营销投放选品方法，market是市场行情与行业动态。

只输出JSON数组，格式：[{"id":"条目id","score":80,"summary":"点评","category":"policy"}]"""


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


def call_llm(base_url, api_key, model, batch):
    user_content = json.dumps(
        [{"id": it["id"], "title": it["title"], "source": it["source"]} for it in batch],
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


def main():
    args = sys.argv[1:]
    do_all = "--all" in args
    dry_run = "--dry-run" in args

    load_env_local()
    items = load_items()
    targets = [it for it in items if do_all or not it.get("summary")]
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
            if row.get("summary"):
                it["summary"] = str(row["summary"]).strip()
            if row.get("category") in ("platform", "policy", "logistics", "marketing", "market"):
                it["category"] = row["category"]
            updated += 1
        print("批次 %d 完成，累计更新 %d 条" % (i // BATCH_SIZE + 1, updated))

    write_items(items)
    print("完成，共更新 %d 条 -> %s" % (updated, DATA_FILE))


if __name__ == "__main__":
    main()
