# REA 证据记录

每个结论都要记录证据类型和边界，不能用静态结果冒充运行结果。

```yaml
evidence_id: ev_<id>
target:
  path_or_artifact: <absolute path or installed target>
  sha256: <digest when available>
  version: <observed version>
operation: <REA operation>
scope:
  selected_modules: []
  omitted_modules: []
  runtime_actions: []
facts:
  - kind: observation
    statement: <direct returned fact>
  - kind: inference
    statement: <bounded inference and supporting observations>
  - kind: unknown
    statement: <unresolved boundary>
limitations: []
next_check: <smallest follow-up that closes the gap>
```

## 证据等级

| 等级 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 静态源码/包分析 | 文件、符号、配置和可能的调用关系 | 运行成功、权限实际生效 |
| 运行观察 | 指定目标和动作下的行为 | 其他版本、其他平台或未覆盖路径 |
| Current fixture | 协议/投影合同在受控夹具中成立 | 真实 Electron、CLI、签名 helper |
| Desktop/CLI Gate B | 指定宿主的完整进程和 canonical 链路 | 另一宿主或另一平台 |
| Platform/packaged | 安装、签名、权限和升级可用 | 未测试的版本/架构 |

禁止使用“未找到字符串”“同名文件存在”“`/health` 返回 200”作为完整能力证据。
