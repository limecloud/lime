# Warp 对照流程图

> 状态：current research reference  
> 更新时间：2026-04-29  
> 目标：把 Lime 多模态演进中的关键决策流程画清楚，尤其防止从 `@` 命令、viewer 或 CLI 旁路倒推底层事实源。

## 1. 新增多模态能力决策流程

```mermaid
flowchart TB
    Start["要新增或修复一个多模态能力"] --> Contract{是否已有底层\nModalityRuntimeContract}
    Contract -->|有| Reuse["复用 contract"]
    Contract -->|没有| Build["先补 contract schema / truth source / artifact / evidence"]

    Build --> Capability{模型能力矩阵是否支持}
    Reuse --> Capability
    Capability -->|否| AddCap["补 capability tag / candidate set / routing evidence"]
    Capability -->|是| Profile{ExecutionProfile 是否覆盖权限与执行策略}
    AddCap --> Profile

    Profile -->|否| AddProfile["补 model roles / permission roles / fallback"]
    Profile -->|是| Artifact{Artifact graph 是否有 domain kind}
    AddProfile --> Artifact

    Artifact -->|否| AddArtifact["补 domain artifact / viewer mapping"]
    Artifact -->|是| Executor{Executor adapter 是否声明能力}
    AddArtifact --> Executor

    Executor -->|否| AddExec["补 binding / progress / cancel / resume / failure mapping"]
    Executor -->|是| Bind["绑定 @ / button / scene 入口"]
    AddExec --> Bind
    Bind --> Check["运行 contract / governance / acceptance 检查"]
```

固定判断：

1. `@` 命令绑定在最后。
2. 没有 contract 时，不允许用入口代码临时绕过。
3. artifact、viewer、evidence 都必须在入口绑定前有定义。

## 2. Executor 选择流程

```mermaid
flowchart TB
    Need["Runtime contract requires executor"] --> Local{本地结构化 executor 可用?}
    Local -->|是| LocalExec["使用 Local ServiceSkill / Tool / Browser"]
    Local -->|否| Gateway{是否声明 Gateway call?}
    Gateway -->|是| GatewayExec["使用 LimeCore Gateway"]
    Gateway -->|否| CloudScene{是否声明 Scene cloud run?}
    CloudScene -->|是| CloudExec["使用 LimeCore Scene cloud run"]
    CloudScene -->|否| CLI{是否显式允许 local_cli?}
    CLI -->|是| CLIExec["使用 typed local_cli adapter"]
    CLI -->|否| Block["阻断并输出 executor gap"]

    LocalExec --> Evidence["写 executor decision evidence"]
    GatewayExec --> Evidence
    CloudExec --> Evidence
    CLIExec --> Evidence
    Block --> Evidence
```

固定判断：

1. 本地结构化 executor 优先。
2. Gateway / cloud scene 需要 contract 显式声明。
3. CLI 只能是 typed adapter，不能成为默认 current 捷径。

## 3. 权限与降级流程

```mermaid
flowchart TB
    Request["Contract 请求能力"] --> Profile["合并 ExecutionProfile"]
    Profile --> NeedPerm{需要高风险权限?}
    NeedPerm -->|否| Allow["allow"]
    NeedPerm -->|是| Rule{规则已有 allow / deny / ask?}
    Rule -->|allow| Allow
    Rule -->|deny| Deny["deny + reason"]
    Rule -->|ask| Ask["询问用户"]
    Ask --> User{用户选择}
    User -->|同意| Allow
    User -->|拒绝| Deny
    User -->|改用低风险| Fallback{是否有真实 fallback?}
    Fallback -->|有| UseFallback["执行声明过的 fallback"]
    Fallback -->|无| Deny

    Allow --> Evidence["记录权限来源"]
    Deny --> Evidence
    UseFallback --> Evidence
```

禁止：

1. `browser_control` 被拒绝后伪装成 WebSearch 完成。
2. `media_upload` 被拒绝后偷偷走本地临时文件上传。
3. 无真实 fallback 时输出“已完成”。

## 4. Artifact / Viewer 选择流程

```mermaid
flowchart TB
    Result["Executor 返回结果"] --> Kind{是否匹配 domain artifact kind?}
    Kind -->|是| Domain["写 domain artifact"]
    Kind -->|否| Generic{是否只是兜底文件?}
    Generic -->|是| GenericFile["写 generic_file 并标明限制"]
    Generic -->|否| Gap["阻断：artifact kind gap"]

    Domain --> Viewer{是否有 viewer mapping?}
    GenericFile --> Viewer
    Viewer -->|有| Open["打开对应 viewer"]
    Viewer -->|无| NoOpen["只显示轻卡 + viewer gap"]

    Open --> Evidence["artifact event"]
    NoOpen --> Evidence
    Gap --> Evidence
```

固定判断：

1. 多模态主结果应尽量是 domain artifact。
2. `generic_file` 不是失败，但不能伪装成完整体验。
3. 没有 viewer mapping 时，要暴露 gap，不能让聊天消息假装打开成功。

## 5. LimeCore 协作流程

```mermaid
flowchart TB
    Boot["Lime 启动或刷新"] --> Fetch{LimeCore 可用?}
    Fetch -->|是| Online["读取 online catalog / model offer / policy"]
    Fetch -->|否| Fallback["读取 local fallback catalog"]

    Online --> Merge["合并 provider precedence"]
    Fallback --> Merge
    Merge --> Contract["更新 contract registry"]
    Merge --> Profile["更新 execution profile constraints"]

    Contract --> Run{运行时需要云执行?}
    Profile --> Run
    Run -->|否| Local["本地 executor"]
    Run -->|显式 Gateway| Gateway["LimeCore Gateway"]
    Run -->|显式 cloud scene| Scene["LimeCore Scene run"]

    Local --> Evidence["Lime evidence"]
    Gateway --> Audit["LimeCore audit + Lime evidence key"]
    Scene --> Audit
```

固定判断：

1. online catalog 命中时，客户端不再维护第二份业务定义。
2. fallback 只做韧性，不做产品事实源扩张。
3. audit 与 evidence 必须通过关联键互相解释。

## 6. current / compat / deprecated / dead 收敛流程

```mermaid
flowchart TB
    Path["发现一个旧路径或新提案"] --> Current{是否服务底层 current contract?}
    Current -->|是| Keep["current：继续强化"]
    Current -->|否| Needed{是否仍有真实用户或迁移依赖?}
    Needed -->|是| Compat["compat：保留委托，不加新能力"]
    Needed -->|否| Blocks{是否阻碍主线?}
    Blocks -->|是| Dead["dead：删除或下线"]
    Blocks -->|否| Deprecated["deprecated：写退出条件"]

    Keep --> Guard["加治理检查"]
    Compat --> Exit["登记退出条件"]
    Deprecated --> Exit
    Dead --> Remove["删除后验证主链"]
```

固定判断：

1. compat 不是续命许可。
2. deprecated 必须有退出条件。
3. dead 路径如果阻塞 current contract，应优先清掉。
