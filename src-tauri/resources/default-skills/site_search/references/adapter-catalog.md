# Site Adapter Catalog

当前运行时事实源仍然是：

- `lime_site_list`
- `lime_site_search`
- `lime_site_info`

本文件只是当前内置 bundled adapters 的速查表，便于 `site_search` 快速选型。

## 适配器总览

| 适配器 | 域名 | 用途 | 必填参数 | 可选参数 | 登录要求 |
| --- | --- | --- | --- | --- | --- |
| `36kr/newsflash` | www.36kr.com | 采集 36Kr 快讯列表。 | 无 | limit | 无 |
| `bilibili/search` | search.bilibili.com | 按关键词采集 B 站视频搜索结果。 | query | limit | 无 |
| `github/issues` | github.com | 采集指定 GitHub 仓库的 issue 列表。 | repo | query, state, limit | 私有仓库或受限 issue 需要先在浏览器中登录 GitHub。 |
| `github/search` | github.com | 按关键词采集 GitHub 仓库搜索结果。 | query | limit | 若需要访问更完整的搜索结果，请先在浏览器中登录 GitHub。 |
| `linux-do/categories` | linux.do | 读取 linux.do 分类列表。 | 无 | limit | 请先在浏览器中登录 linux.do，再重试该命令。 |
| `linux-do/hot` | linux.do | 读取 linux.do 热门话题。 | 无 | limit, period | 请先在浏览器中登录 linux.do，再重试该命令。 |
| `smzdm/search` | search.smzdm.com | 按关键词采集什么值得买搜索结果。 | query | limit | 无 |
| `yahoo-finance/quote` | finance.yahoo.com | 读取 Yahoo Finance 股票行情摘要。 | symbol | 无 | 无 |
| `zhihu/hot` | www.zhihu.com | 采集知乎热榜问题列表。 | 无 | limit | 请先在浏览器中登录知乎，再重试该命令。 |
| `zhihu/search` | www.zhihu.com | 按关键词采集知乎搜索结果。 | query | limit | 请先在浏览器中登录知乎，再重试该命令。 |

## 语义映射

- 仓库搜索：`github/search`
- 仓库 issue：`github/issues`
- 视频搜索：`bilibili/search`
- 问题搜索：`zhihu/search`
- 热榜/热门：`zhihu/hot`、`linux-do/hot`
- 社区目录：`linux-do/categories`
- 快讯流：`36kr/newsflash`
- 商品搜索：`smzdm/search`
- 行情摘要：`yahoo-finance/quote`

## 使用提醒

- 适配器参数以 `lime_site_info` 返回为准，不要只依赖本文件。
- 如果用户没有指定站点，只是泛化调研，不应优先走 `site_search`，而应优先走 `research`。
- 如果用户要求保存结果到当前内容或项目，执行 `lime_site_run` 时再补 `content_id`、`project_id`、`save_title`。
