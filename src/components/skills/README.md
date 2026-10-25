# Skills 组件

现役入口是 `SkillsWorkspacePage.tsx`，由 `AppPageContent` 装配。它负责技能商店、内置技能和已安装技能，委托现役 API 完成安装、卸载、查看、导入、导出和标准创建。

| 文件 | 职责 |
| --- | --- |
| `SkillsWorkspacePage.tsx` / `SkillsWorkspacePageView.tsx` | 状态装配与页面展示 |
| `SkillsWorkspacePageViewModel.ts` | 列表选择与过滤 |
| `SkillsWorkspaceMarketplace.tsx` | 商店列表 |
| `SkillsWorkspaceInstalledSkills.tsx` | 已安装技能操作 |
| `SkillsWorkspaceDetailDialogs.tsx` / `SkillContentDialog.tsx` | 标准技能详情 |
| `SkillScaffoldDialog.tsx` | 手工创建与专家注册预填 |
| `SkillPackageInstallDialog.tsx` | 本地技能包安装 |
| `useSkillsWorkspaceLocalSkillActions.ts` | 本地技能操作 |

聊天消息不提供结果转技能、草稿回带或续用回放。专家注册可以预填名称、目录和结构字段，仍通过标准 scaffold API 创建；正常技能安装与聊天中的技能调用保持同一主链。

无产品消费者的旧页面及专属组件已删除；禁止从历史实现恢复第二套管理入口。验证见 [执行计划](../../../internal/exec-plans/chat-skill-save-removal-20261025.md)。
