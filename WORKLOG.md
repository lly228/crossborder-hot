# WORKLOG

## 2026-07-05 16:24

从0搭了跨境HOT MVP：仿aihot.virxact.com风格的跨境电商资讯精选静态站。

做了什么：
- 抓取分析了aihot的页面结构和CSS（时间线行、40px等宽时间列、衬线体日期栏、评分分档着色、浅色主题），作为视觉基准
- 纯静态实现：index.html + assets/style.css + assets/app.js + data/news.js，无构建无依赖，双击index.html可用
- 功能：分类tab筛选（平台/政策合规/物流/营销/行情）、搜索（200ms防抖）、本地收藏（localStorage）、按日期分组时间线、空状态、响应式（760px断点收起侧边栏）
- 种子数据22条，抓自雨果跨境首页真实标题和链接，日期时间按抓取顺序近似分配
- scripts/fetch_cifnews.py：抓雨果跨境首页、关键词自动分类打分、按id去重合并进news.js。在scratchpad副本上实测新增7条且不重复种子数据

踩坑：
- amz123和卖家之家都是Nuxt客户端渲染，curl抓不到资讯列表，MVP数据源只能用服务端渲染的雨果跨境
- aihot不带UA的curl返回403，带浏览器UA正常
- Windows GBK控制台跑python打中文乱码，脚本里加了stdout reconfigure utf-8

预览验证：preview server（python http.server 8642）实测tab筛选、搜索、收藏、收藏视图、窄屏和1280宽布局，均正常，控制台无报错。

后续方向：接更多数据源（需无头浏览器或找接口）、summary用LLM生成、热度分换LLM打分、部署到静态托管。

## 2026-07-05 16:55

按复盘的优先级做了第二轮完善：多源采集、真实发布时间、LLM加工脚本、30天归档、GitHub Actions自动化。

做了什么：
- fetch_cifnews.py 重构为 fetch_news.py 多源架构（SOURCES注册表），新增36氪出海（letschuhai.com）源。亿恩、亿邦有WAF接不了
- 新条目抓详情页取真实发布时间；--refresh-times 把22条种子的近似时间全部刷成真实时间（最早的其实是6月18日的文章，之前近似分配到7月3日，失真明显，这步很值）
- 超30天条目自动归档到 data/archive/YYYY-MM.json，news.js 只保留近30天
- scripts/enrich_llm.py：OpenAI兼容接口的LLM加工（打分+一句点评+校正分类），密钥走 .env.local 或环境变量，未配密钥时管线照常跑。prompt只用正向指令没写反例（error_log规则2）。没有密钥，此脚本未实测调通，--dry-run 正常
- scripts/test_fetch.py：20项自测覆盖分类/打分/提取过滤/标题清洗/时间解析/归档
- .github/workflows/update.yml：每天北京时间06:15和17:15抓取+加工+commit
- git init 并首次提交。gh未安装，推GitHub和开Pages留给用户手动

踩坑：
- 36氪出海锚文本混着emotion的CSS规则文本（@media{...}、.css-xxx{...}），标题要过clean_text；部分文章meta description是站点宣传语不能当摘要
- cifnews首页混置顶旧文章，用「id距页面最大id超3000丢弃」过滤
- 实抓暴露的脏数据（3条脏标题、3条宣传语摘要）已用一次性脚本清洗，规则同步进了抓取脚本

当前数据：news.js 45条（雨果27+36氪出海18），13条待LLM补点评，归档12条。

## 2026-07-05 17:35

第三轮：借用户发现的「卖家之家转载引用amz123」线索，接入卖家之家源并做了跨源去重。

原理发现（用户提供的线索验证成立）：
- mjzj列表页虽是客户端渲染，但文章详情页是服务端渲染，且mjzj.com/sitemap.xml有完整文章清单（最后一个articles分卷最新）
- 最近一天的文章404（站方延迟放出），一天以上全部可抓，对每日精选够用
- 转载文的原文出处在HTML注释 <!-- canonical: URL --> 里，不在超链接里

做了什么：
- fetch_news.py 抽象出 discover 概念：列表页发现（cifnews/lsch）和sitemap发现（mjzj）统一走一个主流程；mjzj标题从详情页取
- 新增 ref 字段（原文出处），前端meta行显示「原始来源」小链接
- 跨源去重：新条目的ref指向已收录条目（url或ref重合）就跳过；实测删掉1条与雨果跨境重复的Shopee转载
- 修bug：36氪出海标题残留大括号（lstrip补刀）、同文多链接重复（source+title去重）
- 存量清洗：ref回填7条、跨文件去重1条、脏标题2条

测试：test_fetch.py 增至30项，全过。页面实测73条三源混排正常。

当前数据：news.js 73条（雨果32+36氪出海23+卖家之家18），归档30条。
