# OpenClaw Windows 检测问题后续记录

## 状态

- 结论：纳入下个迭代
- 范围：`OpenClaw` Windows 安装检测与诊断可观测性
- 优先级：中高

## 背景

用户反馈在 Windows 环境下已经安装了 `OpenClaw`，但应用内仍显示“未检测到 OpenClaw”。

这类问题通常不是“未安装”，而是“当前进程没有正确解析到 `openclaw` 命令”，典型场景包括：

- 安装完成后应用进程未刷新到最新 `PATH`
- `openclaw` 安装在 `npm` 全局目录，但该目录未进入当前进程可见路径
- `npm config get prefix`、`where openclaw` 与应用内补充搜索目录之间存在不一致

## 现象

- 页面提示：`未检测到 OpenClaw`
- 用户实际情况：系统中已完成 `OpenClaw` 安装
- 用户感知：会误以为需要重复安装，或者认为安装功能失效

## 影响

- 容易触发重复安装操作
- 会降低 Windows 用户对安装流程稳定性的信任
- 故障定位成本高，用户需要手工提供 `where openclaw`、`npm config get prefix` 等信息

## 本次已确认的处理方向

建议下个版本正式带上以下能力：

1. Windows 检测前主动刷新当前进程 `PATH`
2. 将 `npm` 全局前缀目录纳入 `openclaw` 命令补充搜索范围
3. 当检测到 npm 包已存在但命令未生效时，显示“待刷新”而不是“未检测到”
4. 在安装页直接展示诊断信息，包括：
   - `npm` 命令路径
   - `npm global prefix`
   - `OpenClaw` 包路径
   - `where openclaw` 命中结果
   - 补充搜索目录
   - 补充目录中的 `openclaw` 命中结果

## 建议验收标准

- Windows 已安装 `OpenClaw` 但当前进程未命中命令时：
  - 不再提示继续重复安装
  - 页面显示“待刷新”或等价状态
  - 页面给出明确的重新检测/重启应用引导
- 诊断面板可直接暴露关键路径信息，便于用户截图反馈
- `cargo test windows_` 相关回归通过
- OpenClaw 前端页面测试通过

## 建议补充

- 后续可将这组诊断信息并入“故障诊断导出 JSON”
- 若后续还有类似问题，可统一沉淀为“命令可见性诊断”能力，而不是仅服务于 `OpenClaw`
