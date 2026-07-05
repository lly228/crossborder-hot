# 跨境HOT — 跨境电商行业信息精选

仿照 aihot.virxact.com 的信息流风格做的跨境电商行业资讯精选站。单页静态站，视图对标aihot：

- **精选**：热度分65以上的条目，按日期分组时间线
- **全部**：不设门槛的完整时间线
- **日报**：单日条目按热度排序，可前后翻天
- **周报/月报**：最近7天/30天按热度取头部条目，按分类分区展示
- **主题**：亚马逊、TikTok Shop、Temu·SHEIN·速卖通、东南亚、合规与知产、物流仓储六个关键词主题
- 全局搜索、分类筛选、本地收藏；移动端侧边栏收起，换横向滑动导航

## 怎么跑

不需要构建，不需要依赖，直接用浏览器打开 `index.html` 即可（数据走 `data/news.js`，非 fetch，file:// 协议下也能跑）。

要起本地服务的话：

```
python -m http.server 8642 --directory .
```

然后访问 http://localhost:8642

## 数据管线

三段式：抓取 → LLM加工 → 发布（静态文件即发布物）。

### 1. 抓取

```
python scripts/fetch_news.py                  # 常规抓取
python scripts/fetch_news.py --refresh-times  # 顺带刷新已有条目的发布时间
python scripts/fetch_news.py --limit 20       # 限制每源本次详情页抓取数
```

- 数据源：雨果跨境（cifnews.com）、36氪出海（letschuhai.com）、卖家之家（mjzj.com）、AMZ123快讯（amz123.com/kx）
- 雨果和36氪出海从首页列表发现文章；卖家之家走sitemap（网站给搜索引擎的文章清单）发现，最近一天的文章站方还没放出会404，下轮自动补上；AMZ123从已知快讯页出发链式发现（每页带上一篇/下一篇和推荐快讯链接）
- 去重同时对照在线数据和归档，防止被归档的旧文被重新抓回
- 新条目会抓详情页取真实发布时间，拿不到回退为抓取时刻
- 卖家之家的转载文在HTML注释里标注原文出处（canonical），存进 `ref` 字段；如果原文就是站内已收录的条目，转载直接跳过（跨源去重）
- 按条目id、链接、标题三重去重，只追加不覆盖
- 超过30天的条目自动移入 `data/archive/YYYY-MM.json`

### 2. LLM加工（打分＋点评＋校正分类）

```
python scripts/enrich_llm.py            # 处理所有点评为空的条目
python scripts/enrich_llm.py --all      # 全部重新加工
python scripts/enrich_llm.py --dry-run  # 只看要处理哪些，不调API
```

配置放环境变量或项目根目录 `.env.local`（已gitignore，密钥不入库）：

```
CBHOT_LLM_API_KEY=你的密钥
CBHOT_LLM_BASE_URL=https://api.deepseek.com/v1   # 任意OpenAI兼容接口，选填
CBHOT_LLM_MODEL=deepseek-chat                     # 选填
```

不配密钥时抓取照常工作，只是新条目没有点评、热度分是关键词启发式。

### 3. 自动化（GitHub Actions）

`.github/workflows/update.yml` 每天北京时间06:15和17:15自动抓取加加工，数据有变化就commit。推到GitHub后：

1. 仓库 Settings → Pages → Source 选 main 分支根目录，站点就发布了
2. 仓库 Settings → Secrets and variables → Actions，加 secret `CBHOT_LLM_API_KEY`（可选，加了才有LLM点评；`CBHOT_LLM_BASE_URL` 和 `CBHOT_LLM_MODEL` 用 variables 配）

### 测试

```
python scripts/test_fetch.py
```

覆盖分类、打分、列表提取过滤、标题清洗、时间解析、归档切分。

## 目录结构

```
index.html                  页面骨架
assets/style.css            全部样式（CSS变量设计令牌集中在 :root）
assets/app.js               渲染逻辑：分组、筛选、搜索、收藏
data/news.js                资讯数据，window.NEWS_DATA 数组（最近30天）
data/archive/YYYY-MM.json   过期归档
scripts/fetch_news.py       多源抓取
scripts/enrich_llm.py       LLM打分点评
scripts/test_fetch.py       自测
.github/workflows/update.yml  定时抓取workflow
```

## 数据字段

```
id        唯一标识（cifnews用文章数字id，36氪出海用 lsch-<hex>）
date      YYYY-MM-DD（详情页的真实发布日期）
time      HH:MM
source    来源名称
url       原文链接
score     热度分 0-100（>=75 高亮绿，>=65 品牌色，其余灰）
category  platform | policy | logistics | marketing | market
title     标题
summary   一句点评（LLM或人工写，可为空）
ref       原文出处链接（仅转载类条目有，选填字段）
```

## 备注

- amz123和卖家之家（mjzj.com）是客户端渲染，curl抓不到；亿恩、亿邦有WAF。接这些源要走无头浏览器或找它们的真实数据接口。
- 热度分在LLM加工前是关键词启发式，加工后以LLM为准。
- 精选定位：政策、封号、费用调整、知产发案这类直接影响经营的内容权重高，软文和活动宣传已在抓取层过滤一部分。
