const fs = require('fs');
const file = 'src/components/agent/chat/components/ChatNavbar.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the taskCenterChromeShellClassName
code = code.replace(
  /const taskCenterChromeShellClassName =[\s\S]*?";/,
  `const taskCenterChromeShellClassName =
  "flex items-center gap-1.5 bg-white rounded-t-[14px] pl-3 pr-2 py-1.5 relative z-10 before:absolute before:bottom-0 before:-right-3 before:w-3 before:h-3 before:shadow-[-4px_4px_0_4px_#fff] before:rounded-bl-[12px] before:bg-transparent";`
);

// Replace the render part for isTaskCenterChrome
const renderRegex = /if \(isTaskCenterChrome\) \{[\s\S]*?return \([\s\S]*?<Navbar[\s\S]*?>[\s\S]*?<div className=\{taskCenterChromeShellClassName\}>([\s\S]*?)<\/div>[\s\S]*?<\/Navbar>\s*\);\s*\}/;

const newRender = `if (isTaskCenterChrome) {
    return (
      <Navbar
        $compact
        $collapsed={false}
        $taskCenter
        data-testid="task-center-workspace-bar"
        style={{ padding: "8px 0 0 0", gap: 0, alignItems: "flex-end" }}
      >
        <div className="flex w-full items-end justify-between px-2 relative">
          <div className="flex items-center">
            {/* The white tab */}
            <div className={taskCenterChromeShellClassName}>
              <ProjectSelector
                value={projectId}
                onChange={(nextProjectId) => onProjectChange?.(nextProjectId)}
                open={workspaceSelectorOpen}
                onOpenChange={setWorkspaceSelectorOpen}
                passiveTrigger
                workspaceType={workspaceType}
                placeholder="选择工作区"
                dropdownSide="bottom"
                dropdownAlign="start"
                enableManagement={workspaceType === "general"}
                density="compact"
                chrome="workspace-tab"
                className="w-auto max-w-[280px]"
              />
            </div>
            {/* The + button outside the tab */}
            <div className="ml-3 mb-1.5 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md bg-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                onClick={() => {
                  setWorkspaceSelectorOpen((current) => !current);
                }}
                aria-label={workspaceSelectorOpen ? "收起工作区菜单" : "展开工作区菜单"}
              >
                <Plus size={15} />
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 mb-1.5 pr-2">
            {showContextCompactionAction ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={taskCenterIconButtonClassName}
                onClick={onCompactContext}
                disabled={contextCompactionRunning}
                aria-label={
                  contextCompactionRunning ? "正在压缩上下文" : "压缩上下文"
                }
                title={contextCompactionRunning ? "正在压缩上下文" : "压缩上下文"}
              >
                <Box size={15} />
              </Button>
            ) : null}

            {showHarnessToggle ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  taskCenterPillButtonClassName,
                  "gap-1 px-2.5",
                  harnessPanelVisible && "bg-white text-slate-900",
                  harnessAttentionLevel === "warning" &&
                    !harnessPanelVisible &&
                    "bg-amber-50/90 text-amber-800 hover:bg-amber-100 hover:text-amber-900",
                )}
                onClick={onToggleHarnessPanel}
                aria-label={
                  harnessPanelVisible
                    ? \`收起\${harnessToggleLabel}\`
                    : \`展开\${harnessToggleLabel}\`
                }
                aria-expanded={harnessPanelVisible}
                title={
                  harnessPanelVisible
                    ? \`收起\${harnessToggleLabel}\`
                    : \`展开\${harnessToggleLabel}\`
                }
              >
                <Sparkles size={12} />
                <span>{harnessToggleLabel}</span>
                {harnessPendingCount > 0 ? (
                  <span className="rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-700">
                    {harnessPendingCount > 99 ? "99+" : harnessPendingCount}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    harnessPanelVisible && "rotate-180",
                  )}
                />
              </Button>
            ) : null}

            {onToggleSettings ? (
              <Button
                variant="ghost"
                size="icon"
                className={taskCenterIconButtonClassName}
                onClick={onToggleSettings}
                aria-label="打开设置"
                title="打开设置"
              >
                <Settings size={16} />
              </Button>
            ) : null}
          </div>
        </div>
      </Navbar>
    );
  }`;

code = code.replace(renderRegex, newRender);
fs.writeFileSync(file, code);
