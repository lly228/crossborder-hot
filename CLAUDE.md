# CLAUDE.md — 跨境HOT

## 项目定位

仿 aihot.virxact.com 风格的跨境电商资讯精选静态站，MVP阶段。纯静态无构建，禁止引入打包工具和框架，保持双击 index.html 可用。

## 约定

- 数据文件是 `data/news.js`（`window.NEWS_DATA = [...]` 形式），不是 JSON fetch。原因：file:// 下没有 CORS 问题，用户双击就能打开。改数据格式前先想清楚这一点。
- 数据字段 schema 见 README.md「数据字段」一节，新增字段要同步更新 README、`scripts/fetch_news.py` 和 `scripts/enrich_llm.py`。
- 分类枚举固定五个：platform / policy / logistics / marketing / market，对应中文见 `assets/app.js` 里的 CATEGORIES。加分类要同时改 app.js、fetch_news.py 的关键词表和 enrich_llm.py 的 prompt。
- 视图逻辑全在 `assets/app.js`：精选由条目的 `selected` 布尔字段决定，`score` 只表示经营影响强度；旧数据缺 `selected` 时才用 FEATURED_MIN_SCORE=65 兜底。主题是 TOPICS 里的正则关键词，日报/周报/月报是纯前端对 NEWS_DATA 的过滤排序，没有独立数据文件。改主题只动 TOPICS 数组。
- 同一事件用 `eventId` 聚合。`scripts/fetch_news.py` 每次写数据前会按标题相似度补齐事件ID；精选流折叠同事件条目，全部动态保留原始条目。
- 数据鲜度放在 `data/meta.js` 的 `window.NEWS_META`，由抓取脚本每次运行后更新。页面仍然不能通过fetch读取本地数据。
- AMZ123 的发现方式是从已知快讯页链式爬（amz123_discover），种子来自库里最近的 amz-条目和转载ref，断种子时用 AMZ_SEED 兜底。它家 sitemap 是坏的，列表页是客户端渲染，别试。
- 加数据源：在 `scripts/fetch_news.py` 的 SOURCES 注册表里加一项（extract / detail_time / detail_summary / match_id 四个函数），只接服务端渲染的源。改完跑 `python scripts/test_fetch.py`。
- LLM密钥放 `.env.local`（已gitignore）或环境变量 CBHOT_LLM_API_KEY，禁止写进代码、commit和派工prompt。
- 设计令牌集中在 `assets/style.css` 的 `:root`，遵循 `~/.claude/rules/design_template.md` 的变量命名。不要写死色值到组件样式里。
- 视觉基准是 aihot 的浅色时间线风格：白底、40px等宽时间列、衬线体日期栏、评分按档位着色（>=75 绿、>=65 品牌橙、其余灰）。改版式前先对照参考站。

## 踩坑记录

- amz123 / mjzj.com 的列表页是客户端渲染，curl 拿不到，但**详情页是服务端渲染**。卖家之家走 sitemap 发现文章（sitemap索引的最后一个articles分卷最新），最近一天的文章会404（站方延迟放出），跳过即可下轮补上。amz123 的 sitemap.xml 本身是坏的（返回Nuxt错误页），目前通过卖家之家的转载间接覆盖 amz123 快讯。亿恩（ennews.com）和亿邦（ebrun.com）有WAF，抓不到。雨果跨境（cifnews.com）和36氪出海（letschuhai.com）是服务端渲染，可以直接抓。
- 卖家之家转载文的原文出处写在HTML注释 `<!-- canonical: URL -->` 里，不在超链接里。ref 指向站内已收录条目时视为重复跳过。
- aihot.virxact.com 无 UA 的 curl 会 403，带浏览器 UA 正常。
- 36氪出海的锚文本里混着emotion的CSS规则文本（`@media{...}`、`.css-xxx{...}`），标题必须过 `clean_text` 清洗；部分文章页的 meta description 是站点宣传语（含「36氪出海」「信息差」字样），不能当摘要用。
- cifnews 首页会混入置顶旧文章，抓取层用「文章id距页面最大id超过3000就丢弃」过滤。
- 详情页抓取间隔0.4秒，别去掉，避免被源站限流。
