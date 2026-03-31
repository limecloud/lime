# A2UI - Agent-to-User Interface

结构化 UI 响应系统，对齐官方 React renderer 目录面，并兼容 Lime 当前业务链路中出现的简化表单、消息数组与 JSONL A2UI 消息。

## 功能概述

A2UI 允许 AI 返回结构化的表单组件，用户通过点击选项来回答，而不是打字输入。

## 文件索引

| 文件               | 说明                                             |
| ------------------ | ------------------------------------------------ |
| `index.ts`         | 模块导出入口                                     |
| `types.ts`         | A2UI 组件类型定义（基于 v0.10 规范）             |
| `parser.ts`        | A2UI JSON 解析器，支持简化表单、消息数组与 JSONL |
| `protocol.ts`      | 官方消息协议聚合层                               |
| `dataModel.ts`     | 数据路径与 JSON Pointer 解析                     |
| `catalog/basic/`   | 完整组件集事实源                                 |
| `catalog/minimal/` | 最小组件集事实源                                 |
| `components/`      | React 运行时入口与分发器                         |

## 规范版本

当前实现兼容官方 `v0.8 / v0.9 / v0.10` 相关消息形态，其中组件目录面对齐官方 React renderer 的 `catalog/basic` 与 `catalog/minimal` 组织方式。

## 支持的格式

### 1. 简化表单格式（推荐）

AI 返回简单的 JSON 格式，系统自动转换为完整 A2UI：

```json
{
  "type": "form",
  "title": "收集偏好",
  "description": "请选择你的偏好设置",
  "fields": [
    {
      "id": "audience",
      "type": "choice",
      "label": "目标受众",
      "options": [
        { "value": "business", "label": "商务人士" },
        { "value": "consumer", "label": "普通消费者" }
      ],
      "default": "business"
    }
  ],
  "submitLabel": "确认"
}
```

### 2. 官方 / 完整 A2UI 格式

符合 A2UI 规范的完整组件树结构，以及 `createSurface / updateComponents / updateDataModel` 这类消息流。

## 支持的组件

### 布局组件

- Row, Column, List, Card, Tabs, Modal, Divider

### 展示组件

- Text, Icon, Image, Video, AudioPlayer

### 交互组件

- Button, TextField, CheckBox, ChoicePicker, Slider, DateTimeInput

## 核心概念

### 动态值

支持字面量、数据绑定和函数调用：

- 字面量: `"Hello"`
- 数据绑定: `{ "path": "/user/name" }`
- 函数调用: `{ "call": "formatDate", "args": { "value": { "path": "/date" } } }`

### 验证规则 (checks)

```json
{
  "checks": [
    {
      "condition": {
        "call": "required",
        "args": { "value": { "path": "/email" } }
      },
      "message": "邮箱不能为空"
    }
  ]
}
```

## 使用方式

AI 响应中使用 `\`\`\`a2ui` 代码块包裹 JSON：

```markdown
\`\`\`a2ui
{
"type": "form",
...
}
\`\`\`
```

## 相关项目

- `aster-a2ui`: Rust 实现的 A2UI 协议库（位于 aster-rust 框架）

## 依赖关系

- 被 `StreamingRenderer` 与 `useWorkspaceA2UIRuntime` 用于提炼待处理表单
- 被 `AgentChatWorkspace`、输入栏与工作区确认卡共享
