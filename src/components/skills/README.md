# Skills 组件

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

Skills 组件模块提供 Skill 管理和执行的 UI 界面，包括：

- Built-in / Local / Remote Skills 分组展示与管理
- Skill 仓库管理
- Skill 执行对话框
- Workflow 执行进度展示

## 文件索引

| 文件                       | 说明                                       |
| -------------------------- | ------------------------------------------ |
| `index.ts`                 | 模块导出入口                               |
| `SkillsPage.tsx`           | Skills 主页面，展示 Skill 列表             |
| `SkillsPage.test.tsx`      | Skills 主页面分组与筛选测试                |
| `SkillCard.tsx`            | Skill 卡片组件，展示单个 Skill 信息和操作  |
| `SkillCard.test.ts`        | SkillCard 组件测试                         |
| `RepoManagerPanel.tsx`     | Skill 仓库管理面板                         |
| `SkillExecutionDialog.tsx` | Skill 执行对话框，显示详情、输入表单和进度 |
| `WorkflowProgress.tsx`     | Workflow 进度展示组件                      |

## 组件依赖关系

```
SkillsPage
├── SkillCard (Skill 列表项)
├── RepoManagerPanel (仓库管理)
└── SkillExecutionDialog (执行对话框)
    └── WorkflowProgress (执行进度)
```

## 当前行为

- `Built-in Skills` 展示 ProxyCast 随应用提供的内置技能，默认可用，不显示安装/卸载入口
- `Local Skills` 直接读取本地目录中的技能，优先展示，不依赖远程网络
- `Remote Skills` 展示仓库缓存中的远程技能，点击刷新时才同步最新仓库列表
- 搜索和安装状态筛选会先作用于全量技能，再按分组渲染结果

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
