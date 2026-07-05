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
