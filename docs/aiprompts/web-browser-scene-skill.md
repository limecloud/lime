# Lime Web / Browser Scene Skill 设计提案

## 这份文档回答什么

本文件把外部 `web-access` 一类 skill 仓库里值得借鉴的内容，翻译成 Lime 自己可长期演进的设计语言，主要回答：

- 外部 Web skill 对 Lime 到底有什么帮助
- 哪些能力适合吸收进 Lime，哪些不应该直接引入
- `Scene Skill`、`site-adapter`、浏览器运行时、`a2ui`、产物保存之间应该如何解耦
- 面向网页读取、登录态访问、长文导出、素材保存这类场景时，Lime 应该如何做一套可复用主线

它是 `skill-standard.md`、`site-adapter-standard.md`、`command-runtime.md` 的专题补充文档。

## 什么时候先读

出现以下任一情况时，先读本文件，再决定是否写代码：

- 想新增一个“输入网址 -> 打开页面 -> 抽取内容 -> 保存产物”的 slash scene
- 想把浏览器读取、登录态访问、页面导出、图片下载做成可复用技能
- 想参考外部 `SKILL.md` 仓库改 Lime 的网页能力
- 想把某个网页导出需求做成长期产品能力，而不是一次性脚本
- 想给 `site-adapter` 增加预热、滚动、懒加载等待、媒体下载等通用能力

## 设计结论

### 1. 外部 `web-access` / Agent Skills 对 Lime 有帮助，但不能直接替代 Lime 运行时

可以借鉴的部分：

- Agent Skills 包结构
- Skill 作为 bundle 的组织方式
- 前置检查、站点经验、工具选择策略
- 针对动态页面的预热、滚动、媒体提取思路
- “像人一样判断是否完成任务”的流程设计

不应直接引入的部分：

- 外部自带的 CDP proxy / daemon / HTTP API
- 外部工具仓库定义的运行时协议
- 外部环境变量约定和执行入口
- 把外部 `SKILL.md` 或 SkillToolset 直接当成 Lime 产品事实源

### 2. Lime 的长期真相仍然是 `Scene Skill`

网页类 slash 场景的长期真相必须保持为：

`scene -> gate request -> a2ui -> Scene Skill -> site-adapter -> Lime runtime -> artifact/viewer`

固定边界如下：

- `Scene Skill` 负责产品语义、流程推进、步骤回放
- `gate request` 负责声明缺什么输入、补完后如何恢复
- `a2ui` 只负责收集输入，不负责定义协议
- `site-adapter` 负责页面执行与抽取，不负责产品命名
- Lime 浏览器运行时负责 CDP / session / tab 生命周期
- viewer 只消费产物，不反向定义运行时

### 3. 先做“通用网页场景框架”，再挂具体站点能力

不要为了 X、公众号、知乎分别长三套流程。

应该先沉淀一套通用 Web / Browser Scene Skill 框架，再把不同站点的差异下沉到：

- `site-adapter`
- `references/site-patterns`
- 运行时 helper
- 抽取后处理器

## 标准分层

### 1. Scene Skill 层

职责：

- 定义对用户可见的场景名称、说明、产物语义
- 组织完整流程
- 在对话中回放步骤，而不是把过程藏进工具卡
- 统一声明补参需求

推荐模式组合：

- 主模式使用 `Pipeline`
- 缺参使用 `Inversion`
- 产物输出使用 `Generator`
- 站点 / 浏览器能力封装使用 `Tool Wrapper`

### 2. Gate Request 层

职责：

- 表达缺失输入
- 表达字段校验规则
- 表达恢复点和继续执行条件

建议最小字段：

- `url`
- `project_id` 或等价项目上下文
- `target_language`
- `save_mode`
- `include_images`
- `overwrite_existing`

固定原则：

- `gate request` 是输入协议真相
- `a2ui` 是 GUI 映射层
- 不把表单结构写死进 skill catalog 或 site-adapter 参数

### 3. Site Adapter 层

职责：

- 页面进入
- DOM 预热
- 长页滚动
- 懒加载资源等待
- 内容抽取
- 标准化返回 `markdown_bundle` / `saved_content`

站点差异应优先留在这里，而不是上浮到 slash scene。

### 4. Runtime Helper 层

职责：

- 提供所有动态页面通用的执行辅助能力
- 不带业务语义
- 不带站点命名

适合沉淀的 helper：

- `waitForDomStable`
- `scrollUntilSettled`
- `waitForImagesReady`
- `resolveRoot`
- 延迟代码块与媒体的完整性检测

### 5. Artifact / Viewer 层

职责：

- 展示最终保存产物
- 优先打开项目内真实文件
- 渲染 Markdown 中的相对图片路径
- 不把过程状态冒充成最终产物

固定原则：

- 真正产物必须落项目目录
- 预览应打开保存后的 Markdown，而不是临时摘要
- 图片应作为同一产物包的一部分被渲染

## 推荐目录结构

对于一个长期可维护的 Web / Browser Scene Skill，建议目录按下面拆：

```text
skill/
├── SKILL.md
├── references/
│   ├── tool-routing.md
│   ├── site-patterns/
│   │   ├── x.com.md
│   │   └── ...
│   └── gotchas.md
├── templates/
│   └── markdown-export-template.md
├── examples/
│   └── export-result-example.md
└── scripts/
    └── validate-output.mjs
```

说明：

- `SKILL.md` 只放触发、路由、流程规则
- 工具选择矩阵放 `references/tool-routing.md`
- 站点经验放 `references/site-patterns/`
- 输出结构放 `templates/`
- 产物校验可放 `scripts/`

这里的 `SKILL.md` 应优先理解为 **Agent Skills 兼容包入口**，不是 Lime 最终运行时协议。

## 推荐流程主线

以下流程适用于“导出网页内容并保存为 Markdown”这一整类场景，而不只适用于 X。

### Step 1. 命中 Scene Skill

入口可以是：

- slash 场景
- 技能中心
- 输入框里的 URL 场景联想

但命中后统一收口到同一个 `Scene Skill`，不要在多个入口各写一套流程。

### Step 2. 产出 Gate Request

如果缺少以下任一信息，就先产出结构化 `gate request`：

- 目标 URL
- 目标项目
- 保存语言
- 是否下载图片

前端再把它映射成 `a2ui` 表单。

### Step 3. 运行时预检查

运行时预检查应该是 Lime 自己的过程步骤，而不是外部脚本真相。

适合检查：

- 当前是否有可用浏览器会话
- 当前站点是否需要登录态
- 当前项目是否允许落盘
- 当前 skill 所需参数是否已经补齐

这些步骤应回放到对话里。

### Step 4. 预热页面

在 `site-adapter` 里先做通用预热：

1. 等待 DOM 稳定
2. 滚动到稳定
3. 再次等待 DOM 稳定
4. 等待图片资源就绪
5. 再进入抽取

不要把这段逻辑写死在某个 slash 场景组件里。

### Step 5. 抽取标准内容

标准抽取至少包括：

- 标题
- 作者 / 来源
- 发布时间
- 正文段落
- 代码块
- 图片列表
- 封面或头图
- 源地址与 slug

抽取结果应标准化为：

- 主 Markdown 文档
- 媒体资源列表
- 元数据文件

### Step 6. 后处理

后处理不重新抓站点，只消费已保存结果。

推荐能力：

- 翻译为目标语言
- 保留 fenced code block
- 保留相对图片路径
- 清理无意义包装文案
- 校验代码块和图片是否缺失

### Step 7. 保存与预览

推荐保存结构：

```text
exports/<scene-key>/<slug>/
├── index.md
├── meta.json
└── images/
    ├── 001.jpg
    └── ...
```

viewer 打开时应优先定位：

- `index.md`
- 与其同目录的 `images/`

而不是打开工具过程或中间摘要。

## 外部 `web-access` 最值得吸收的四类内容

### 1. 工具选择矩阵

外部 skill 的价值之一，是把“什么时候用搜索、什么时候直接进浏览器、什么时候要读真实页面”讲清楚。

在 Lime 中，这些内容适合沉淀到：

- `references/tool-routing.md`
- 运行时提示词模板
- 站点 gotchas

而不适合直接写死在前端 if/else。

### 2. 站点经验库

不同站点的注意事项应留在 `references/site-patterns/` 一类位置，例如：

- URL 模式
- 登录前后差异
- 懒加载行为
- 代码块或图片常见丢失模式

这类内容是高信号知识，适合作为长期资产。

### 3. 动态页面预热思路

外部 skill 里“先滚动、等稳定、再提取”的思路非常值得保留，但应下沉为 Lime runtime helper，而不是保留外部 daemon。

### 4. 最小侵入原则

默认不打扰用户已有 tab、尽量使用受控 tab、完成后回收临时上下文，这类原则适合写进 Lime 的浏览器场景规范。

## 明确不要做的事情

- 不引入第二套浏览器 runtime
- 不在 Lime 内部再接一套外部 daemon
- 不把外部 `SKILL.md` 当成 Lime 协议
- 不把站点逻辑写死在 slash 组件里
- 不把缺参逻辑写成散落的弹窗或 toast
- 不让 viewer 打开“过程卡”冒充最终产物
- 不让翻译、摘要、抽取互相重抓站点

## 面向实现的推荐拆分

### A. 通用层

- Scene Skill 标准输入
- `gate request -> a2ui` 映射
- 通用预热 helper
- 通用 Markdown 产物协议
- 通用图片下载器

### B. 站点层

- X 长文导出
- 公众号文章导出
- 博客 / 文档页面导出

### C. 后处理层

- 翻译
- 结构校验
- 产物预览

这三层应保持单向依赖：

`scene -> adapter/helper -> post-process -> artifact`

不要反过来让 post-process 定义 scene 协议。

## 当前建议

对 Lime 当前阶段，最合适的路线是：

1. 继续坚持 `Scene Skill` 作为产品真相
2. 继续坚持 `site-adapter` 只是步骤执行器
3. 借鉴外部 `web-access` 的内容设计，不引入它的执行内核
4. 先把动态页面通用 helper、站点经验和 Markdown 产物协议沉淀稳
5. 再逐步扩展更多站点，而不是为每个站点单独长一套 slash 流程

一句话总结：

> 外部 `web-access` 最值得借鉴的是“怎么设计强 skill”，不是“把它的 proxy 搬进 Lime”。
