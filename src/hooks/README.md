# Hooks 目录

全局共享的 React Hooks。

## 文件索引

| 文件 | 说明 |
|------|------|
| `useSkillExecution.ts` | Skill 执行 Hook，监听 Tauri 事件并管理执行状态 |

历史 `useUnifiedChat.ts` compat Hook 已删除。
新 Agent / Codex 工作台统一走 `src/components/agent/chat/hooks/index.ts` 暴露的 `useAgentChatUnified`；
底层实现为 `src/components/agent/chat/hooks/useAsterAgentChat.ts`；
如果未来要恢复 General / Creator 能力，也应基于 `agent_runtime_*` 重建。

## 相关文档

- 架构设计：`docs/prd/chat-architecture-redesign.md`

## useSkillExecution

Skill 执行 Hook，提供 Skill 执行功能，监听 Tauri 事件并管理执行状态。

### 使用示例

```typescript
import { useSkillExecution } from "@/hooks/useSkillExecution";

function SkillRunner() {
  const {
    execute,
    isExecuting,
    currentStep,
    progress,
    error,
  } = useSkillExecution({
    onStepStart: (stepId, stepName, total) => {
      console.log(`开始步骤 ${stepName} (${stepId}/${total})`);
    },
    onComplete: (success, output) => {
      if (success) {
        console.log('执行成功:', output);
      }
    },
  });

  const handleExecute = async () => {
    const result = await execute('my-skill', 'user input');
    console.log('结果:', result);
  };

  return (
    <div>
      <button onClick={handleExecute} disabled={isExecuting}>
        执行
      </button>
      {isExecuting && (
        <div>
          <p>当前步骤: {currentStep}</p>
          <progress value={progress} max={100} />
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### 返回值

- `execute(skillName, input, provider?)` - 执行 Skill
- `isExecuting` - 是否正在执行
- `currentStep` - 当前步骤名称
- `progress` - 执行进度（0-100）
- `error` - 错误信息
- `executionId` - 当前执行 ID
- `totalSteps` - 总步骤数
- `currentStepIndex` - 当前步骤序号

### 事件回调

- `onStepStart(stepId, stepName, total)` - 步骤开始
- `onStepComplete(stepId, output)` - 步骤完成
- `onStepError(stepId, error, willRetry)` - 步骤错误
- `onComplete(success, output?)` - 执行完成

### 相关文档

- API 封装：`src/lib/api/skill-execution.ts`
- 设计文档：`.kiro/specs/skills-integration/design.md`
