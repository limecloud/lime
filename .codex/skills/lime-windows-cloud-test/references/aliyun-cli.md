# 无影 CLI 合同

helper 从参考项目的 `shou-windows-cloud-test/scripts/wuying.py` 复制，保留资源身份核对、无重复变更投递、分块传输和摘要验证；Lime 适配独立状态目录、测试根、CLI 发现及可选择的 overlay 写集。原始参考由用户提供，路径为 `/Users/coso/Documents/dev/ai/bugu/shou/.agents/skills/shou-windows-cloud-test/`，读取日期 2026-11-11。

helper 使用官方 CLI 的 `ecd` RPC、API 版本 `2020-09-30`。`--force` 只绕过本地旧 metadata 校验，不提升云端权限。运行时核对当前官方 help/API；本页与模板不固定价格、库存或购买请求。

| 操作                  | 核心参数与成功条件                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DescribeDesktops`    | 本次 RegionId、DesktopId.1；核对 EndUserIds、OfficeSiteId、PostPaid、实际状态                                     |
| `RunCommand`          | Type=RunPowerShellScript、PlainText、有限 Timeout；交互用户传 EndUserId                                           |
| `DescribeInvocations` | 沿 InvokeId，IncludeOutput/IncludeInvokeDesktops=true；核对单实例 ExitCode=0、Dropped=0、InvocationStatus=Success |
| `StartDesktops`       | 精确本次实例；回执后轮询 Running                                                                                  |
| `StopDesktops`        | 精确实例、StoppedMode=StopCharging；回执后轮询 Stopped                                                            |
| `DeleteDesktops`      | 仅本次授权允许释放时使用精确实例；回执后确认查询为空                                                              |

账号只保存 CLI profile、地域、办公网络、EndUserId、可选 CLI 路径和钥匙串引用。凭据留在官方 CLI 与钥匙串；不要输出认证配置。资源读取失败时可有限重试；创建、安装、启停或释放结果未知时先查询原操作和实例，不盲目重放。

`StopCharging` 停止相应计算费用，保留磁盘；`KeepCharging` 仍收计算费，断开远程连接也不关机。磁盘、带宽和快照独立核对。参考官方[开关机说明](https://help.aliyun.com/zh/wuying-workspace/user-guide/start-stop-or-release-cloud-computers)和 [StopDesktops metadata](https://api.aliyun.com/meta/v1/products/Ecd/versions/2020-09-30/apis/StopDesktops/api.json)，费用以当前报价及实际入账为准。

`DescribeDesktops` 的 `Stopped` 只证明关机，不证明使用何种计费模式；官方 [DescribeDesktops metadata](https://api.aliyun.com/meta/v1/products/Ecd/versions/2020-09-30/apis/DescribeDesktops/api.json) 没有返回该模式。helper 的 `compute_stop_requested` 仅表示本次实际投递，`compute_billing_status=not_verified` 不宣称账单停费；已有停机实例也必须核对原请求与实际计费。

释放只处理本轮资源清单，另核对本次附属收费网络和快照；不清理其他实例、共用账号或办公网络。遇预算截止先执行既有授权的收尾，再补导出；不能为追求完整日志持续产生费用。
