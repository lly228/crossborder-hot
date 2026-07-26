# 跨境HOT — 跨境电商行业信息精选

仿照 aihot.virxact.com 的信息流风格做的跨境电商行业资讯精选站。单页静态站，视图对标aihot：

- **精选**：由独立`selected`字段决定；同一事件的多信源条目折叠展示
- **最新重要5件事**：从最近3天精选事件中按影响分和信源数排序
- **全部**：不设门槛的完整时间线
- **日报**：杂志式版面（刊头、今日看点目录、按分类编号分区、统计栏），可前后翻天；配好LLM密钥后 `--report` 可生成编辑导语
- **周报/月报**：同版式，最近7天/30天按热度取头部条目分区展示
- **主题**：亚马逊、TikTok Shop、Temu·SHEIN·速卖通、东南亚、合规与知产、物流仓储六个关键词主题
- 全局搜索、分类筛选、本地收藏；移动端侧边栏收起，换横向滑动导航
- 顶部显示数据鲜度；超过24小时提示延迟，超过72小时提示停更

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

- 数据源：Amazon卖家论坛News and Announcements、知无不言公开问题、雨果跨境、36氪出海、卖家之家、AMZ123快讯
- 信源分为`official`、`media`、`community`。页面给官方和社区内容显示标签；社区内容只进入全部动态，不单独进入精选
- Amazon卖家论坛只收录原帖作者名以`_Amazon`结尾的官方公告，不把普通卖家帖子当官方消息
- 知无不言只抓公开问题，列表已标注的私密悬赏、付费围观和活动推广内容会在抓取层过滤
- 雨果和36氪出海从首页列表发现文章；卖家之家走sitemap（网站给搜索引擎的文章清单）发现，最近一天的文章站方还没放出会404，下轮自动补上；AMZ123从已知快讯页出发链式发现（每页带上一篇/下一篇和推荐快讯链接）
- 去重同时对照在线数据和归档，防止被归档的旧文被重新抓回
- 新条目会抓详情页取真实发布时间，拿不到回退为抓取时刻
- 新条目自动补`selected`、`tags`和`eventId`；每次运行结束写入`data/meta.js`
- 卖家之家的转载文在HTML注释里标注原文出处（canonical），存进 `ref` 字段；如果原文就是站内已收录的条目，转载直接跳过（跨源去重）
- 按条目id、链接、标题三重去重，只追加不覆盖
- 普通条目超过30天自动归档；官方公告保留90天，避免尚未生效的重要规则提前离开首页

### 2. LLM加工（打分＋点评＋校正分类）

```
python scripts/enrich_llm.py            # 处理所有P0内容字段未完成的条目
python scripts/enrich_llm.py --all      # 全部重新加工
python scripts/enrich_llm.py --report   # 生成最新一天的日报导语，写入 data/reports.js
python scripts/enrich_llm.py --dry-run  # 只看要处理哪些，不调API
```

配置放环境变量或项目根目录 `.env.local`（已gitignore，密钥不入库）：

```
CBHOT_LLM_API_KEY=你的密钥
CBHOT_LLM_BASE_URL=https://api.deepseek.com/v1   # 任意OpenAI兼容接口，选填
CBHOT_LLM_MODEL=deepseek-v4-pro                   # 选填
```

服务商换模型名时改这里。`scripts/enrich_llm.py`里的`RETIRED_MODELS`会把已下线的旧名字自动改写成同档在线模型，避免线上配置没跟上就整批加工失败。

不配密钥时抓取照常工作，新条目使用启发式评分和精选判断，事实摘要、推荐理由、卖家影响与行动建议可能为空。

### 3. 自动化（GitHub Actions）

`.github/workflows/update.yml`每天北京时间09:10和12:10自动抓取加加工，数据有变化就commit。`.github/workflows/deploy.yml`在页面或数据推送到`main`后自动部署，也会在更新工作流成功结束后部署最新数据：

1. 仓库Settings → Pages → Build and deployment → Source选择GitHub Actions
2. 仓库Settings → Secrets and variables → Actions，添加secret `CBHOT_LLM_API_KEY`（可选，加了才有LLM点评；`CBHOT_LLM_BASE_URL`和`CBHOT_LLM_MODEL`用variables配置）
3. 站点地址为`https://<用户名>.github.io/<仓库名>/`

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
data/meta.js                抓取状态与数据鲜度，window.NEWS_META 对象
data/archive/YYYY-MM.json   过期归档
scripts/fetch_news.py       多源抓取
scripts/enrich_llm.py       LLM打分点评
scripts/test_fetch.py       自测
.github/workflows/update.yml  定时抓取workflow
.github/workflows/deploy.yml  GitHub Pages部署workflow
```

## 数据字段

```
id        唯一标识（cifnews用文章数字id，36氪出海用 lsch-<hex>）
date      YYYY-MM-DD（详情页的真实发布日期）
time      HH:MM
source    来源名称
sourceType official | media | community，用于区分官方、媒体和社区信源
url       原文链接
score     热度分 0-100（>=75 高亮绿，>=65 品牌色，其余灰）
selected  是否进入精选流，布尔值；与score独立
category  platform | policy | logistics | marketing | market
title     标题
summary   事实摘要，可为空
why       推荐理由，可为空
impact    对哪些卖家、平台或地区有影响，可为空
action    卖家建议动作，可为空
deadline  明确的生效日或截止日，YYYY-MM-DD或空字符串
tags      1到6个标签的字符串数组
eventId   事件聚合ID；同一事件的不同信源共享同一个值
ref       原文出处链接（仅转载类条目有，选填字段）
```

## 备注

- amz123和卖家之家（mjzj.com）是客户端渲染，curl抓不到；亿恩、亿邦有WAF。接这些源要走无头浏览器或找它们的真实数据接口。
- Seller Central登录后后台消息不能由GitHub Actions安全、稳定地抓取，目前只接公开Seller Forums和公开帮助页线索。
- 微信公众平台`robots.txt`禁止通用爬虫抓取文章，项目不做公众号自动爬取。公众号内容只适合在获得授权后由作者提供标题、摘要和原文链接进行人工补录。
- 热度分和selected在LLM加工前由启发式生成，加工后以LLM的独立判断为准。
- 精选定位：政策、封号、费用调整、知产发案这类直接影响经营的内容优先，软文和活动宣传在抓取层先过滤一部分。
