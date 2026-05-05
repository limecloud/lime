# AI 图层化设计时序图

> 状态：proposal  
> 更新时间：2026-05-05  
> 目标：固定首期核心用户流和系统调用顺序，确保生成、编辑、拆层、导出都回到 `LayeredDesignDocument`。

## 1. 原生分层生成时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant Generate as 生成主舞台
  participant Planner as Layer Planner
  participant Router as Provider Router
  participant Provider as Image Provider
  participant Processor as Matting / Inpaint
  participant Doc as Design Document Service
  participant Artifact as Artifact / Evidence

  User->>Generate: 输入海报需求
  Generate->>Planner: 请求图层计划
  Planner-->>Generate: 返回 layer plan
  Generate->>Router: 请求按层选择 provider/model
  Router-->>Generate: 返回 generation plan
  Generate->>Provider: 生成背景 / 主体 / 特效 / Logo
  Provider-->>Generate: 返回 raw assets
  Generate->>Processor: 抠图、alpha、clean plate 处理
  Processor-->>Generate: 返回 normalized assets
  Generate->>Doc: 创建 LayeredDesignDocument
  Doc-->>Generate: 返回 designId + preview
  Generate->>Artifact: 记录 design artifact 与 provider evidence
  Generate-->>User: 展示结果卡和“打开图层编辑”
```

关键约束：

1. 生成成功的判断不是 provider 返回图片，而是 document 创建成功。
2. evidence 记录 provider 调用，artifact 记录设计工程。

## 2. 打开与保存编辑时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant Canvas as Canvas Editor
  participant Doc as Design Document Service
  participant Store as Design Store
  participant Renderer as Preview Renderer

  User->>Canvas: 打开 designId
  Canvas->>Doc: load design
  Doc->>Store: 读取 design.json + assets
  Store-->>Doc: 返回文档和资源引用
  Doc-->>Canvas: 返回 LayeredDesignDocument
  Canvas-->>User: 渲染图层工作台

  User->>Canvas: 拖动角色层
  Canvas->>Canvas: 本地更新 transform
  Canvas->>Doc: 保存 layer patch
  Doc->>Store: 写入 design.json
  Doc->>Renderer: 更新 preview
  Renderer-->>Doc: 返回 latest preview
  Doc-->>Canvas: 保存成功
```

关键约束：

1. Canvas 可以做本地乐观更新，但最终必须保存 patch。
2. 保存失败时 UI 必须保留未保存状态，不能假装已写入。

## 3. 单层重生成时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant Canvas as Canvas Editor
  participant Doc as Design Document Service
  participant Router as Provider Router
  participant Provider as Image Provider
  participant Processor as Matting Processor
  participant Store as Asset Store
  participant Evidence as Evidence Pack

  User->>Canvas: 点击“重生成此层”
  Canvas->>Doc: 请求 layer context
  Doc-->>Canvas: 返回 prompt / bbox / style / neighbors
  Canvas->>Router: 选择 provider/model
  Router-->>Canvas: 返回 model decision
  Canvas->>Provider: 生成替代 asset
  Provider-->>Canvas: 返回 raw asset
  Canvas->>Processor: 透明通道和边缘处理
  Processor-->>Store: 写入新 asset
  Store-->>Doc: 返回 newAssetId
  Doc->>Doc: 更新 layer.assetId，保留 transform
  Doc->>Evidence: 记录 oldAssetId -> newAssetId
  Doc-->>Canvas: 返回更新后的 document
  Canvas-->>User: 展示新图层，可接受或回退
```

关键约束：

1. 重生成失败不能覆盖旧 asset。
2. 重生成成功只替换资产，不改 layer id、位置和层级。

## 4. 扁平图拆层时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant UI as 拆层确认页
  participant Analyzer as VLM / OCR Analyzer
  participant Segmenter as SAM / RMBG
  participant Inpaint as Inpaint Processor
  participant Doc as Design Document Service

  User->>UI: 上传 flat.png
  UI->>Analyzer: 识别对象、文字和布局
  Analyzer-->>UI: 返回对象候选和文字区域
  UI->>Segmenter: 请求主要对象 masks
  Segmenter-->>UI: 返回 masks + confidence
  UI->>Inpaint: 请求 clean plate
  Inpaint-->>UI: 返回 clean background 或失败原因
  UI-->>User: 展示候选图层和置信度
  User->>UI: 确认进入图层编辑
  UI->>Doc: 创建 extracted LayeredDesignDocument
  Doc-->>UI: 返回 designId
```

关键约束：

1. 低置信度层必须让用户确认。
2. clean plate 失败不阻断进入编辑，但必须显式提示风险。

## 5. 导出时序

```mermaid
sequenceDiagram
  participant User as 用户
  participant Canvas as Canvas Editor
  participant Doc as Design Document Service
  participant Exporter as Exporter
  participant Artifact as Artifact Store

  User->>Canvas: 点击导出
  Canvas->>Doc: 获取当前 document version
  Doc-->>Canvas: 返回 document snapshot
  Canvas->>Exporter: 请求 PNG / JSON / PSD-like
  Exporter->>Exporter: 渲染和打包
  Exporter->>Artifact: 写入 export artifact
  Artifact-->>Exporter: 返回 export refs
  Exporter-->>Canvas: 返回导出结果
  Canvas-->>User: 展示下载和打开位置
```

关键约束：

1. 导出必须绑定 document version。
2. PNG、JSON、PSD-like 都是同一份 document 的投影。

## 6. Provider 能力降级时序

```mermaid
sequenceDiagram
  participant Generator as Asset Generator
  participant Capability as Capability Resolver
  participant Provider as Image Provider
  participant Fallback as Local / Secondary Processor
  participant Doc as Design Document Service

  Generator->>Capability: 查询模型是否支持透明背景
  Capability-->>Generator: 不支持或未知
  Generator->>Provider: 生成普通图片
  Provider-->>Generator: 返回 opaque asset
  Generator->>Fallback: RMBG / SAM 后处理
  Fallback-->>Generator: 返回 RGBA asset
  Generator->>Doc: 写入 asset alphaMode=mask
```

关键约束：

1. 能力降级必须体现在 asset metadata。
2. UI 只显示“透明图层已生成”，不把降级细节暴露成主流程噪音。
