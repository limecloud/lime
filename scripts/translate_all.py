#!/usr/bin/env python3
"""
Comprehensive AI-Assisted Translation Script
Translates all [TODO: Translate] entries from Chinese to English
"""

import json
import re
from pathlib import Path

EN_FILE = Path(__file__).parent.parent / 'src' / 'i18n' / 'patches' / 'en.json'

# Comprehensive translation dictionary organized by context
TRANSLATIONS = {
    # === Core Actions ===
    "加载": "Load", "已加载": "Loaded", "加载中": "Loading", "加载完成": "Loading complete",
    "加载失败": "Failed to load", "保存": "Save", "已保存": "Saved", "保存中": "Saving",
    "保存失败": "Failed to save", "删除": "Delete", "已删除": "Deleted", "删除失败": "Failed to delete",
    "添加": "Add", "已添加": "Added", "编辑": "Edit", "已编辑": "Edited",
    "取消": "Cancel", "确认": "Confirm", "确定": "OK", "关闭": "Close",
    "打开": "Open", "刷新": "Refresh", "重置": "Reset", "清空": "Clear All",
    "清除": "Clear", "复制": "Copy", "已复制": "Copied", "粘贴": "Paste",
    "搜索": "Search", "过滤": "Filter", "排序": "Sort", "导入": "Import",
    "导出": "Export", "上传": "Upload", "下载": "Download", "发送": "Send",
    "创建": "Create", "更新": "Update", "修改": "Modify", "查看": "View",
    "选择": "Select", "输入": "Input", "输出": "Output",
    
    # === Status & Messages ===
    "成功": "Success", "失败": "Failed", "错误": "Error", "警告": "Warning",
    "提示": "Tips", "信息": "Information", "详情": "Details", "帮助": "Help",
    "处理中": "Processing", "已完成": "Completed", "进行中": "In Progress",
    "等待": "Waiting", "暂无": "None", "未知": "Unknown", "其他": "Other",
    "正常": "Normal", "异常": "Abnormal", "启用": "Enable", "禁用": "Disable",
    
    # === Common UI ===
    "设置": "Settings", "配置": "Configuration", "选项": "Options",
    "关于": "About", "版本": "Version", "更新": "Update", "检查": "Check",
    "列表": "List", "表格": "Table", "图表": "Chart", "视图": "View",
    "模式": "Mode", "类型": "Type", "状态": "Status", "名称": "Name",
    "描述": "Description", "标签": "Tags", "分类": "Category",
    "管理": "Manage", "操作": "Actions", "工具": "Tools", "功能": "Features",
    
    # === Input/Output ===
    "输入": "Input", "输出": "Output", "请输入": "Please enter",
    "输入框": "Input box", "文本": "Text", "内容": "Content",
    "消息": "Message", "数据": "Data", "文件": "File", "图片": "Image",
    
    # === Navigation ===
    "返回": "Back", "下一步": "Next", "上一步": "Previous", "完成": "Complete",
    "跳过": "Skip", "继续": "Continue", "展开": "Expand", "收起": "Collapse",
    "显示": "Show", "隐藏": "Hide", "全部": "All", "更多": "More",
    "左侧": "Left", "右侧": "Right", "顶部": "Top", "底部": "Bottom",
    
    # === Time & Date ===
    "时间": "Time", "日期": "Date", "创建时间": "Created at",
    "更新时间": "Updated at", "最近": "Recent", "历史": "History",
    "小时": "hour", "天": "day", "分钟": "minute", "秒": "second",
    "小时前": "hours ago", "天前": "days ago",
    
    # === Model & AI ===
    "模型": "Model", "提供商": "Provider", "凭证": "Credentials",
    "API": "API", "密钥": "Key", "令牌": "Token", "认证": "Authentication",
    "请求": "Request", "响应": "Response", "延迟": "Latency",
    
    # === Flow Monitor ===
    "加载差异失败": "Failed to load diff",
    "配置面板": "Configuration panel",
    "差异摘要": "Diff summary",
    "对比": "Compare",
    "并排": "Side by side",
    "统一": "Unified",
    "显示差异": "Show differences",
    "显示全部": "Show all",
    "忽略空白": "Ignore whitespace",
    "请求差异": "Request diff",
    "响应差异": "Response diff",
    "元数据差异": "Metadata diff",
    "无差异": "No differences",
    "两个": "Two",
    "完全相同": "are identical",
    "修改的字段": "Modified fields",
    "删除的字段": "Deleted fields",
    "新增的字段": "Added fields",
    "修改的消息": "Modified messages",
    "删除的消息": "Deleted messages",
    "新增的消息": "Added messages",
    "不自动请求权限": "Don't auto-request permissions",
    "让用户手动控制": "Let user control manually",
    "暂无数据": "No data",
    "尝试调整过滤条件": "Try adjusting filter conditions",
    "或": "or",
    "清除过滤": "clear filters",
    "查看所有记录": "to view all records",
    "加载更多数据": "Load more data",
    "已加载全部": "All loaded",
    "条记录": "records",
    "点击查看详情": "Click to view details",
    "双击复制": "Double-click to copy",
    "内容预览": "Content preview",
    "响应内容预览": "Response content preview",
    "已复制请求": "Request copied",
    "复制为": "Copy as",
    "导出为": "Export as",
    "正在获取统计数据": "Fetching statistics",
    "获取到的基础统计数据": "Retrieved basic statistics",
    "个模型未显示": "models not shown",
    "图例": "Legend",
    "暂无时间线数据": "No timeline data",
    "请求时间线": "Request timeline",
    "时间分布": "Time distribution",
    "进度条": "Progress bar",
    "拦截的": "Intercepted",
    "不存在或已处理": "does not exist or already processed",
    "方法": "Method",
    "路径": "Path",
    "加载拦截配置失败": "Failed to load intercept configuration",
    "加载拦截列表失败": "Failed to load intercept list",
    "拦截器已启用": "Interceptor enabled",
    "等待匹配的": "Waiting for matching",
    "加载通知配置失败": "Failed to load notification configuration",
    "更新通知配置失败": "Failed to update notification configuration",
    "测试按钮": "Test button",
    "发送测试通知": "Send test notification",
    "预设": "Preset",
    "加载快速过滤器失败": "Failed to load quick filters",
    "编辑快速过滤器": "Edit quick filter",
    "过滤器": "Filter",
    "多获取一个": "Fetch one more",
    "因为可能包含当前": "because it may contain current",
    "没有指定要重放的": "No specified to replay",
    "重放失败": "Replay failed",
    "重放成功": "Replay successful",
    "查看重放结果": "View replay result",
    "更新会话失败": "Failed to update session",
    "归档操作失败": "Failed to archive",
    "响应预览": "Response preview",
    "评论": "Comments",
    "加载会话列表失败": "Failed to load session list",
    "创建会话失败": "Failed to create session",
    "会话": "Session",
    "包含": "Contains",
    "结构化数据格式": "Structured data format",
    "适合报告": "suitable for reports",
    
    # === FlowFilters ===
    "过滤模式切换": "Filter mode toggle",
    "流式传输中": "Streaming",
    "已取消": "Cancelled",
    
    # === Provider & Credentials ===
    "目标": "Target",
    "路由规则": "Routing rules",
    "负载均衡策略": "Load balancing strategy",
    "注入参数": "Injected parameters",
    
    # === Flow Monitor (Extended) ===
    "流式响应": "Streaming response",
    "流式传输": "Streaming",
    "流式接收": "Streaming receive",
    "流式传输中": "Streaming",
    "状态过滤": "Status filter",
    "特性": "Features",
    "标签过滤": "Tag filter",
    "请求耗时": "Request duration",
    "首字节到达": "First byte arrival",
    "响应完成": "Response complete",
    "时间点标记": "Time point markers",
    "请求发送": "Request sent",
    "等待响应": "Waiting for response",
    "响应接收": "Response received",
    "监控和分析": "Monitor and analyze",
    "提供详细的流量分析和调试功能": "Provides detailed traffic analysis and debugging features",
    "提供详细的流量分析": "Provides detailed traffic analysis",
    "修改和管理系统机器码": "Modify and manage system machine ID",
    "支持跨平台操作": "Supports cross-platform operations",
    "自动轮换": "Auto-rotation",
    "等主流": "and other mainstream",
    "主流": "Mainstream",
    "插件扩展": "Plugin extensions",
    "按需安装": "Install on demand",
    "监控和分析网络请求": "Monitor and analyze network requests",
    "在多个设备间同步": "Sync across multiple devices",
    "更多实用工具正在开发中": "More utility tools are under development",
    "响应流量": "Response traffic",
    "视图切换": "View toggle",
    "窗口大小调整下拉菜单": "Window size adjustment dropdown",
    
    # === Provider & Relay ===
    "等客户端": "and other clients",
    "数量验证": "Quantity validation",
    "总数应至少为": "Total should be at least",
    "分组应有": "Group should have",
    "国内": "Domestic",
    
    # === OAuth & Auth ===
    "请重启应用后重试": "Please restart the app and try again",
    "登录超时": "Login timeout",
    "授权流程超时": "Authorization flow timeout",
    "请在": "Please",
    "分钟内完成登录操作": "complete login within minutes",
    "请重试登录": "Please retry login",
    "请尝试使用系统浏览器模式": "Please try using system browser mode",
    "检查是否有浏览器扩展干扰了登录流程": "Check if browser extensions are interfering with login flow",
    "授权成功但": "Authorization successful but",
    "可能是服务器暂时不可用": "Server may be temporarily unavailable",
    
    # === Common Patterns ===
    "个": "items",
    "条": "records",
    "次": "times",
    "项": "items",
    "位": "digits",
    "个模型": "models",
    "个文件": "files",
    "个工具": "tools",
    "个插件": "plugins",
    "个过滤器": "filters",
    "条记录": "records",
    
    # === Directions & Positions ===
    "上": "Up",
    "下": "Down",
    "左": "Left",
    "右": "Right",
    "前": "Front",
    "后": "Back",
    "中": "Middle",
    "内": "Inside",
    "外": "Outside",
    
    # === Size & Quantity ===
    "大": "Large",
    "中": "Medium",
    "小": "Small",
    "多": "Many",
    "少": "Few",
    "高": "High",
    "低": "Low",
    
    # === Quality & State ===
    "好": "Good",
    "差": "Poor",
    "新": "New",
    "旧": "Old",
    "快": "Fast",
    "慢": "Slow",
    "强": "Strong",
    "弱": "Weak",
    "不存在": "does not exist",
    "返回列表": "Back to list",
    "代码模式": "Code mode",
    "显示原始": "Show raw",
    "标签页": "Tabs",
    "元数据": "Metadata",
    "时间线": "Timeline",
    "导出状态提示": "Export status prompt",
    "正在导出": "Exporting",
    "可选": "Optional",
    "必填": "Required",
    "默认": "Default",
    "自定义": "Custom",
    "标准": "Standard",
    "高级": "Advanced",
    "基础": "Basic",
    
    # === Additional Base Words ===
    "拦截": "Intercept",
    "归档": "Archive",
    "认证": "Authentication",
    "粘贴": "Paste",
    "检查": "Check",
    "起个名字": "give it a name",
    "给这个": "Give this",
    "开头": "start with",
    "必须以": "Must start with",
    "安装": "Install",
    "本地": "Local",
    "直接": "Direct",
    "下载": "Download",
    "链接": "Link",
    "即将推出": "Coming soon",
    "功能": "Feature",
    "检查更新": "Check for updates",
    "重新抛出": "Re-throw",
    "以便": "so that",
    "显示": "display",
    "该": "This",
    "没有提供": "does not provide",
    "行为": "behavior",
    "参数": "parameters",
    "此": "This",
    "暂无": "No",
    "可配置的": "configurable",
    "设置项": "settings",
    "不允许": "not allowed",
    "关闭": "close",
    "结果": "result",
    "方式": "method",
    "格式的": "format",
    "或其他": "or other",
    "更新": "Update",
    "刷新": "Refresh",
    "最后": "Last",
    "使用": "Use",
    "内容": "content",
    "模态框": "modal",
    "头部": "header",
    "已配置的": "Configured",
    "开始": "Start",
    "配置": "Configure",
    "自定义": "custom",
    "项": "items",
    "无效": "invalid",
    "格式": "format",
    "点击": "Click",
    "卸载": "Uninstall",
    "确认": "Confirm",
    "对话框": "dialog",
    "终端": "Terminal",
    "模拟器": "emulator",
    "支持": "Support",
    "多": "Multiple",
    "标签页": "tabs",
    "和": "and",
    "搜索": "search",
    "功能": "features",
    "最后使用": "Last used",
    "格式无效": "Invalid format",
    "点击": "Click",
    "开始配置": "Start configuration",
    "该插件没有提供自定义": "This plugin does not provide custom",
    "配置插件的行为和参数": "Configure plugin behavior and parameters",
    "此插件暂无可配置的设置项": "This plugin has no configurable settings",
    "安装中不允许关闭": "Cannot close during installation",
    "安装结果显示": "Installation result display",
    "安装方式选择": "Installation method selection",
    "本地文件安装": "Local file installation",
    "或其他直接下载链接": "or other direct download links",
    "检查更新功能即将推出": "Check for updates feature coming soon",
    "卸载确认对话框": "Uninstall confirmation dialog",
    "终端模拟器": "Terminal emulator",
    "支持多标签页和搜索功能": "Supports multiple tabs and search features",
    
    # === Batch 2: Common Phrases ===
    "状态概览": "Status overview",
    "插件系统": "Plugin system",
    "重新加载插件": "Reload plugins",
    "通过安装器安装的": "Installed via installer",
    "按钮添加新插件": "button to add new plugin",
    "安装对话框": "Installation dialog",
    "无描述": "No description",
    "卸载插件": "Uninstall plugin",
    "作者": "Author",
    "钩子": "Hooks",
    "执行次数": "Execution count",
    "错误次数": "Error count",
    "超时时间": "Timeout",
    "管理和配置": "Manage and configure",
    "内置插件组件渲染": "Built-in plugin component rendering",
    "应该正确渲染": "Should render correctly",
    "应该为未知插件显示": "Should display for unknown plugin",
    "插件未找到": "Plugin not found",
    "应该为空字符串": "Should be empty string",
    "应该为随机": "Should be random",
    "大小写敏感性": "Case sensitivity",
    "应该区分大小写": "Should be case sensitive",
    "应该显示未找到": "Should display not found",
    "无法加载插件": "Cannot load plugin",
    "的用户界面": "user interface",
    "此操作将删除插件文件和相关配置": "This operation will delete plugin files and related configuration",
    "无法撤销": "Cannot be undone",
    "无法删除已启用的提示词": "Cannot delete enabled prompt",
    "输入系统提示词内容": "Enter system prompt content",
    "管理不同应用的系统提示词": "Manage system prompts for different applications",
    "工具的系统提示词": "System prompt for tools",
    "定义": "Define",
    "的行为和风格": "behavior and style",
    "可创建多个提示词模板": "Can create multiple prompt templates",
    "一键切换不同场景": "One-click switch between different scenarios",
    "如代码审查": "such as code review",
    "文档编写等": "documentation writing, etc.",
    "个提示词": "prompts",
    "当前启用": "Currently enabled",
    "创建第一个": "Create first",
    "创建新的提示词": "Create new prompt",
    "新建提示词": "New prompt",
    "编辑提示词": "Edit prompt",
    "现在有自己的表单": "now has its own form",
    "留空使用默认": "Leave empty to use default",
    "或输入自定义代理地址": "or enter custom proxy address",
    "排除模型": "Exclude models",
    "授权": "Authorization",
    "获取设备码": "Get device code",
    "根据类型渲染不同表单": "Render different forms based on type",
    "配置已保存": "Configuration saved",
    "集成": "Integration",
    "的路由和模型映射": "routing and model mapping",
    "消息提示": "Message prompt",
    "上游": "Upstream",
    "管理端点的上游服务器地址": "Manage upstream server address for endpoint",
    "限制管理端点为本地访问": "Restrict management endpoint to local access",
    "仅允许": "Only allow",
    "访问": "access",
    "管理端点": "Management endpoint",
    "模型映射": "Model mapping",
    "将不可用的模型请求映射到可用的替代模型": "Map unavailable model requests to available alternative models",
    "源模型": "Source model",
    "目标模型": "Target model",
    "添加模型映射": "Add model mapping",
    "表单验证": "Form validation",
    "有效表单验证": "Valid form validation",
    "有效的表单状态应通过验证": "Valid form state should pass validation",
    "有效的表单状态": "Valid form state",
    "缺少名称验证": "Missing name validation",
    "缺少名称的表单": "Form missing name",
    "缺少": "Missing",
    "验证": "Validation",
    "的表单应返回": "form should return",
    "的表单": "form",
    "名称长度验证": "Name length validation",
    "名称超过": "Name exceeds",
    "名称正好": "Name exactly",
    "个字符应通过验证": "characters should pass validation",
    "多个缺失字段验证": "Multiple missing fields validation",
    "兼容": "Compatible",
    "百川智能": "Baichuan AI",
    "名称不能为空": "Name cannot be empty",
    "名称不能超过": "Name cannot exceed",
    "个字符": "characters",
    "不能为空": "Cannot be empty",
    "默认使用": "Use by default",
    "添加自定义": "Add custom",
    "搜索厂商": "Search provider",
    "快速选择厂商": "Quick select provider",
    "或直接手动填写下方表单": "or manually fill in the form below",
    "大多数第三方": "Most third-party",
    "服务使用": "services use",
    "兼容格式": "compatible format",
    "从未使用": "Never used",
    "别名或掩码": "Alias or mask",
    "总使用次数": "Total usage count",
    "调用错误次数": "Call error count",
    "最后使用时间": "Last used time",
    "等工具": "and other tools",
    "导出的报告将包含当前时间范围内的所有统计数据": "Exported report will contain all statistics for current time range",
    "包括请求趋势": "including request trends",
    "延迟直方图等": "latency histograms, etc.",
    "文件系统访问": "File system access",
    "数据库访问": "Database access",
    "自定义配置": "Custom configuration",
    "成功导入": "Successfully imported",
    "服务器配置": "Server configuration",
    "没有找到": "Not found",
    "配置可导入": "configuration available for import",
    "同步完成": "Sync complete",
    "请输入服务器名称": "Please enter server name",
    "无法保存": "Cannot save",
    "同步到外部应用": "Sync to external apps",
    "从外部导入按钮": "Import from external button",
    "从外部应用导入": "Import from external apps",
    "全部导入": "Import all",
    "同步到外部按钮": "Sync to external button",
    "同步配置到所有外部应用": "Sync configuration to all external apps",
    "同步": "Sync",
    "什么是": "What is",
    "工具扩展协议": "Tool extension protocol",
    "能访问文件系统": "Can access file system",
    "数据库等外部资源": "databases and other external resources",
    "在此添加": "Add here",
    "服务器后": "After server",
    "可同步到": "Can sync to",
    "也可从这些工具导入已有的": "Can also import existing from these tools",
    "统一管理": "Unified management",
    "主内容区域": "Main content area",
    "左右分栏": "Left-right split",
    "左侧列表": "Left list",
    "服务器列表": "Server list",
    "新建": "New",
    "启用的应用标签": "Enabled app tags",
    "右侧编辑面板": "Right edit panel",
    "选择一个": "Select one",
    "服务器进行编辑": "server to edit",
    "或点击": "or click",
    "添加新的服务器": "add new server",
    "仅新建时显示": "Show only when creating new",
    "名称和描述": "Name and description",
    "横排": "Horizontal",
    "服务器名称": "Server name",
    "可选描述": "Optional description",
    "同步到哪些应用": "Sync to which apps",
    "同步到": "Sync to",
    "服务器吗": "server",
    
    # === Batch 3: UI & Form Elements ===
    "点击禁用": "Click to disable",
    "点击启用": "Click to enable",
    "删除按钮": "Delete button",
    "删除此": "Delete this",
    "标题和添加按钮": "Title and add button",
    "添加表单": "Add form",
    "别名输入": "Alias input",
    "别名": "Alias",
    "主账号": "Main account",
    "测试账号": "Test account",
    "点击上方": "Click above",
    "按钮添加第一个": "button to add first",
    "选中的": "Selected",
    "应与设置面板显示的": "should match what's displayed in settings panel",
    "设置面板应显示该": "Settings panel should display this",
    "设置面板应显示空状态": "Settings panel should display empty state",
    "选中状态变化时应保持同步": "Should stay in sync when selection state changes",
    "边界情况": "Edge cases",
    "空字符串": "Empty string",
    "应被视为有效选择": "should be treated as valid selection",
    "应被视为不同步": "should be treated as out of sync",
    "一个为": "One is",
    "一个不为": "One is not",
    "状态提取": "State extraction",
    "应正确提取选择状态": "Should correctly extract selection state",
    "应处理": "Should handle",
    "列表选择": "List selection",
    "列表中选择任意": "Select any from list",
    "应同步到设置面板": "Should sync to settings panel",
    "切换选择不同": "Switch to select different",
    "应正确同步": "Should sync correctly",
    "没有可用的": "No available",
    "没有启用的": "No enabled",
    "设置面板": "Settings panel",
    "确认对话框": "Confirmation dialog",
    "导入导出对话框": "Import/Export dialog",
    "检查连接": "Check connection",
    "错误详情": "Error details",
    "显示可用模型": "Show available models",
    "可用模型": "Available models",
    "强制为": "Force to",
    "删除保护": "Delete protection",
    "不可删除": "Cannot be deleted",
    "属性应为": "Property should be",
    "可删除": "Can be deleted",
    "互斥": "Mutually exclusive",
    "应互斥": "Should be mutually exclusive",
    "属性决定删除权限": "Property determines delete permission",
    "处理": "Handle",
    "时仍遵循删除规则": "still follows delete rules when",
    "时可删除": "can be deleted when",
    "无法删除系统预设": "Cannot delete system preset",
    "警告图标和提示": "Warning icon and message",
    "确定要删除": "Are you sure you want to delete",
    "数量警告": "Quantity warning",
    "删除后将一并移除": "Will be removed together after deletion",
    "无效的": "Invalid",
    "导出当前": "Export current",
    "配置或从文件导入配置": "configuration or import configuration from file",
    "不包含实际": "Does not contain actual",
    "生成导出配置": "Generate export configuration",
    "或粘贴配置": "or paste configuration",
    "导入结果": "Import result",
    "导入完成": "Import complete",
    "导入部分完成": "Import partially complete",
    "类型处理正确性": "Type handling correctness",
    "每个": "Each",
    "字段对所有": "field for all",
    "类型都是必需的": "types is required",
    "类型应需要": "Type should require",
    "具体": "Specific",
    "类型字段验证": "Type field validation",
    "类型只需要": "Type only requires",
    "类型需要": "Type requires",
    "所有": "All",
    "类型都应被支持": "types should be supported",
    "不存在的字段应返回": "Non-existent field should return",
    "服务的基础": "Service base",
    "项目": "Project",
    "服务位置": "Service location",
    "都有": "All have",
    "保存状态指示": "Save state indicator",
    "分组标题": "Group title",
    "折叠图标": "Collapse icon",
    "必须在": "Must be in",
    "分组正确性": "Grouping correctness",
    "应被分配到其": "Should be assigned to its",
    "应正确判断": "Should correctly determine",
    "是否属于指定分组": "whether it belongs to specified group",
    "分组后的": "After grouping",
    "总数应等于原始列表长度": "Total count should equal original list length",
    "每个分组内的": "Within each group",
    "应按": "Should be sorted by",
    "所有有效分组都应在结果中存在": "All valid groups should exist in result",
    "搜索正确性": "Search correctness",
    "过滤后的": "After filtering",
    "应都匹配搜索查询": "Should all match search query",
    "数量应小于等于原始数量": "Count should be less than or equal to original count",
    "空查询应返回所有": "Empty query should return all",
    "空白查询应返回所有": "Blank query should return all",
    "名称搜索应返回该": "Name search should return this",
    "搜索应返回该": "Search should return this",
    "搜索应不区分大小写": "Search should be case insensitive",
    "应对空查询返回": "Should return for empty query",
    "分组显示": "Group display",
    "应被分配到": "Should be assigned to",
    "应正确识别自定义": "Should correctly identify custom",
    "属于": "Belongs to",
    "混合列表中自定义": "Custom in mixed list",
    "应只出现在": "Should only appear in",
    "空的自定义": "Empty custom",
    "列表应返回空的": "List should return empty",
    "列表项显示完整性": "List item display completeness",
    "列表项应包含图标": "List item should contain icon",
    "名称和启用状态": "Name and enabled state",
    "应为非空字符串": "Should be non-empty string",
    "用于图标显示": "For icon display",
    "名称应为非空字符串": "Name should be non-empty string",
    "数量徽章正确性": "Count badge correctness",
    "数量应等于": "Count should equal",
    "数组长度": "Array length",
    "数量应为非负整数": "Count should be non-negative integer",
    "不同数量的": "Different count of",
    "数组应返回": "Array should return",
    "数量徽章": "Count badge",
    "支持工具调用": "Supports tool calls",
    "支持的模型": "Supported models",
    "显示更多提示": "Show more prompt",
    "设置面板字段完整性": "Settings panel field completeness",
    "应为有效": "Should be valid",
    "空状态处理": "Empty state handling",
    "具体字段验证": "Specific field validation",
    "应包含有效的分组": "Should contain valid grouping",
    "应标记为": "Should be marked as",
    "数组验证": "Array validation",
    "应为数组": "Should be array",
    "系统预设": "System preset",
    "仅自定义": "Custom only",
    "分隔线": "Divider",
    "配置表单": "Configuration form",
    "连接测试": "Connection test",
    "后再进行连接测试": "before performing connection test",
    "的代理": "proxy",
    "通过": "Via",
    "认证使用": "Authentication using",
    "服务": "Service",
    "登录": "Login",
    "然后复制到浏览器": "Then copy to browser",
    
    # === Batch 4: Authentication & Browser ===
    "支持指纹浏览器": "Supports fingerprint browser",
    "完成登录": "Complete login",
    "授权成功后": "After successful authorization",
    "名称输入": "Name input",
    "表单内容": "Form content",
    "按钮区域": "Button area",
    "系统浏览器选项": "System browser option",
    "系统浏览器": "System browser",
    "指纹浏览器选项": "Fingerprint browser option",
    "指纹浏览器": "Fingerprint browser",
    "指纹": "Fingerprint",
    "需安装": "Requires installation",
    "不可用警告图标": "Unavailable warning icon",
    "使用浏览器": "Use browser",
    "中的": "in",
    "自动完成": "Auto-complete",
    "获取方式": "Acquisition method",
    "登录后": "After login",
    "的值": "value",
    "粘贴从浏览器": "Paste from browser",
    "中获取的": "obtained from",
    "提交按钮": "Submit button",
    "进行认证": "Perform authentication",
    "留空使用官方": "Leave empty to use official",
    "过期": "Expired",
    "授权已过期": "Authorization expired",
    "用户取消登录": "User cancelled login",
    "在线登录": "Online login",
    "安装引导": "Installation guide",
    "当选择指纹浏览器但未安装时显示": "Display when fingerprint browser is selected but not installed",
    "当有错误且不在登录中时显示": "Display when there's an error and not logging in",
    "登录中状态": "Logging in state",
    "并输入以下代码": "and enter the following code",
    "复制代码": "Copy code",
    "重新打开浏览器": "Reopen browser",
    "取消登录": "Cancel login",
    "正在使用指纹浏览器登录": "Logging in using fingerprint browser",
    "登录完成后会自动返回": "Will automatically return after login completes",
    "显示登录选项": "Show login options",
    "第一行": "First line",
    "第二行": "Second line",
    "直接粘贴": "Paste directly",
    "通常包含": "Usually contains",
    "登录模式不需要手动提交": "Login mode doesn't require manual submission",
    "到浏览器完成登录": "to browser to complete login",
    "正在等待授权回调": "Waiting for authorization callback",
    "错误标题和关闭按钮": "Error title and close button",
    "故障排除建议": "Troubleshooting suggestions",
    "建议操作": "Suggested actions",
    "使用系统浏览器": "Use system browser",
    "开发模式下显示": "Display in development mode",
    "正在准备安装": "Preparing installation",
    "重试安装": "Retry installation",
    "正在安装": "Installing",
    "重新检测": "Re-detect",
    "点击下方按钮获取设备码": "Click button below to get device code",
    "然后在浏览器中完成": "Then complete in browser",
    "登录授权": "Login authorization",
    "用户码显示": "User code display",
    "验证链接": "Verification link",
    "检测健康": "Check health",
    "使用次数和操作按钮": "Usage count and action buttons",
    "健康状态应为": "Health status should be",
    "之一": "one of",
    "使用次数应为非负整数": "Usage count should be non-negative integer",
    "错误次数应为非负整数": "Error count should be non-negative integer",
    "应显示为": "Should display as",
    "使用次数为": "Usage count is",
    
    # === Extended Translations (Batch 1) ===
    "时间戳": "Timestamp",
    "请求开始": "Request start",
    "请求结束": "Request end",
    "响应开始": "Response start",
    "响应结束": "Response end",
    "总耗时": "Total duration",
    "提供商信息": "Provider information",
    "凭证名称": "Credential name",
    "重试次数": "Retry count",
    "上下文使用率": "Context usage rate",
    "客户端信息": "Client information",
    "路由信息": "Routing information",
    "差异内容": "Diff content",
    "视图模式切换": "View mode toggle",
    "并排视图": "Side-by-side view",
    "统一视图": "Unified view",
    "配置按钮": "Configuration button",
    "关闭按钮": "Close button",
    "差异配置": "Diff configuration",
    "忽略时间戳": "Ignore timestamps",
    "忽略": "Ignore",
    "差异": "Difference",
    "没有差异": "No differences",
    "路径头部": "Path header",
    "值对比": "Value comparison",
    "左侧值": "Left value",
    "右侧值": "Right value",
    "值显示": "Value display",
    "删除的值": "Deleted value",
    "新增的值": "Added value",
    "消息列表没有差异": "Message list has no differences",
    "左侧消息": "Left message",
    "右侧消息": "Right message",
    "简单过滤": "Simple filter",
    "表达式": "Expression",
    "仅在表达式模式显示": "Show only in expression mode",
    "表达式模式": "Expression mode",
    "帮助面板": "Help panel",
    "当前表达式状态": "Current expression status",
    "当前表达式": "Current expression",
    "搜索栏": "Search bar",
    "搜索内容": "Search content",
    "快捷过滤器": "Quick filters",
    "两种模式都显示": "Show in both modes",
    "时间预设": "Time presets",
    "收藏过滤": "Favorites filter",
    "收起高级过滤器": "Collapse advanced filters",
    "仅简单模式": "Simple mode only",
    "高级过滤": "Advanced filters",
    "清除过滤器": "Clear filters",
    "高级过滤器面板": "Advanced filter panel",
    "仅简单模式且展开时显示": "Show only in simple mode when expanded",
    "提供商过滤": "Provider filter",
    "范围": "Range",
    "最小": "Minimum",
    "最大": "Maximum",
    "延迟范围": "Latency range",
    "模型过滤": "Model filter",
    "输入模型名称": "Enter model name",
    "支持通配符": "Supports wildcards",
    "等待中": "Waiting",
    "查询": "Query",
    "查询结果": "Query results",
    "实时连接状态": "Real-time connection status",
    "连接中": "Connecting",
    "实时更新": "Real-time updates",
    "已暂停": "Paused",
    "离线": "Offline",
    "活跃": "Active",
    "数量": "Count",
    "请求速率显示": "Request rate display",
    "阈值警告数量": "Threshold warning count",
    "通知设置按钮": "Notification settings button",
    "通知权限被拒绝": "Notification permission denied",
    "右键打开设置": "Right-click to open settings",
    "点击启用通知": "Click to enable notifications",
    "通知已启用": "Notifications enabled",
    "通知已禁用": "Notifications disabled",
    "通知": "Notifications",
    "暂停": "Pause",
    "恢复按钮": "Resume button",
    "恢复实时更新": "Resume real-time updates",
    "暂停实时更新": "Pause real-time updates",
    "恢复": "Resume",
    "按耗时": "By duration",
    "降序": "Descending",
    "升序": "Ascending",
    "记录": "Records",
    "分页": "Pagination",
    "上一页": "Previous page",
    "下一页": "Next page",
    "通知设置面板": "Notification settings panel",
    "主行": "Main row",
    "展开按钮": "Expand button",
    "状态图标": "Status icon",
    "特性标记": "Feature markers",
    "包含工具调用": "Contains tool calls",
    "包含思维链": "Contains chain of thought",
    "发生错误": "Error occurred",
    "阈值警告": "Threshold warning",
    "延迟超限": "Latency exceeded",
    "超限": "Exceeded",
    "收藏按钮": "Favorite button",
    "阈值警告详情": "Threshold warning details",
    "展开详情": "Expand details",
    "基本信息": "Basic information",
    "已导出": "Exported",
    "复制请求": "Copy request",
    "获取到的增强统计数据": "Retrieved enhanced statistics",
    "头部工具栏": "Header toolbar",
    "统计仪表板": "Statistics dashboard",
    "调试按钮": "Debug button",
    "调试信息": "Debug information",
    "内存中没有": "Not in memory",
    "创建测试数据": "Create test data",
    "已创建": "Created",
    "个测试": "test items",
    "调试": "Debug",
    "时间范围选择": "Time range selection",
    "更新于": "Updated at",
    "标签页切换": "Tab switching",
    "概览": "Overview",
    "趋势": "Trends",
    "分布": "Distribution",
    "概览标签页": "Overview tab",
    "趋势标签页": "Trends tab",
    "分布标签页": "Distribution tab",
    "核心指标卡片": "Core metrics cards",
    "总请求数": "Total requests",
    "成功率": "Success rate",
    "平均延迟": "Average latency",
    "请求速率": "Request rate",
    "如果有增强统计": "If enhanced statistics available",
    "失败统计": "Failure statistics",
    "请求状态": "Request status",
    "平均输入": "Average input",
    "平均输出": "Average output",
    "总输入": "Total input",
    "总输出": "Total output",
    "按提供商分布": "Distribution by provider",
    "按模型分布": "Distribution by model",
    "按状态分布": "Distribution by status",
    "请求趋势图": "Request trend chart",
    "请求趋势": "Request trends",
    "成功率趋势": "Success rate trends",
    "按提供商": "By provider",
    "按提供商成功率": "Success rate by provider",
    "延迟直方图": "Latency histogram",
    "延迟分布": "Latency distribution",
    "错误分布": "Error distribution",
    "轴标签": "Axis labels",
    "图表区域": "Chart area",
    "网格线": "Grid lines",
    "数据条": "Data bars",
    "时间间隔": "Time interval",
    "项未显示": "items not shown",
    "直方图": "Histogram",
    "统计概览": "Statistics overview",
    "分布条": "Distribution bars",
    "详细列表": "Detailed list",
    "只显示前": "Show only first",
    "时间线可视化": "Timeline visualization",
    "时间轴背景": "Timeline background",
    "事件列表": "Event list",
    "时间分布条": "Time distribution bar",
    "请求发送完成": "Request sent complete",
    "事件内容": "Event content",
    "解析错误": "Parse error",
    "请检查格式": "Please check format",
    "等待处理": "Waiting for processing",
    "编辑中": "Editing",
    "已继续": "Continued",
    "已超时": "Timed out",
    "拦截请求": "Intercept request",
    "拦截响应": "Intercept response",
    "信息栏": "Information bar",
    "已修改": "Modified",
    "解析错误提示": "Parse error message",
    "编辑区域": "Edit area",
    "底部操作栏": "Bottom action bar",
    "修改后的内容将用于继续处理": "Modified content will be used for continued processing",
    "可以编辑内容后继续处理": "Can edit content and continue processing",
    "取消请求": "Cancel request",
    "应用修改并继续": "Apply changes and continue",
    "继续处理": "Continue processing",
    "无法解析": "Cannot parse",
    "请切换到原始视图编辑": "Please switch to raw view to edit",
    "拦截器": "Interceptor",
    "个待处理": "pending items",
    "快速切换按钮": "Quick toggle button",
    "已启用": "Enabled",
    "拦截类型选择": "Intercept type selection",
    "拦截类型": "Intercept type",
    "过滤表达式": "Filter expression",
    "留空则拦截所有匹配类型的": "Leave empty to intercept all matching types",
    "超时设置": "Timeout settings",
    "超时后继续": "Continue after timeout",
    "超时后取消": "Cancel after timeout",
    "被拦截的": "Intercepted",
    "待处理的拦截": "Pending intercepts",
    "空状态": "Empty state",
    "测试通知": "Test notification",
    "这是一条测试通知": "This is a test notification",
    "用于验证通知功能是否正常工作": "Used to verify notification functionality",
    "标题栏": "Title bar",
    "通知设置": "Notification settings",
    "权限状态": "Permission status",
    "通知权限": "Notification permission",
    "已授权": "Authorized",
    "已拒绝": "Denied",
    "重新授权": "Re-authorize",
    "请求权限": "Request permission",
    "基本设置": "Basic settings",
    "启用通知": "Enable notifications",
    "通知类型": "Notification types",
    "桌面通知": "Desktop notifications",
    "声音提示": "Sound alerts",
    "错误通知": "Error notifications",
    "阈值警告通知": "Threshold warning notifications",
    "警告通知": "Warning notifications",
    "无法删除预设过滤器": "Cannot delete preset filter",
    "确定要删除此过滤器吗": "Are you sure you want to delete this filter",
    "没有导入任何过滤器": "No filters imported",
    "可能已存在同名过滤器": "Filter with same name may already exist",
    "快速过滤器": "Quick filters",
    "创建过滤器": "Create filter",
    "导出过滤器": "Export filters",
    "导入过滤器": "Import filters",
    "过滤器列表": "Filter list",
    "创建第一个过滤器": "Create first filter",
    "创建过滤器对话框": "Create filter dialog",
    "编辑过滤器对话框": "Edit filter dialog",
    "创建快速过滤器": "Create quick filter",
    "输入过滤器名称": "Enter filter name",
    "例如": "For example",
    "等过滤器": "and other filters",
    "输入过滤器描述": "Enter filter description",
    "创建中": "Creating",
    "同一会话": "Same session",
    "相似请求": "Similar requests",
    "会话信息": "Session information",
    "刚刚": "Just now",
    "分钟前": "minutes ago",
    "批量重放": "Batch replay",
    "重放": "Replay",
    "重放数量提示": "Replay count prompt",
    "将重放": "Will replay",
    "将重放选中的": "Will replay selected",
    "结果显示": "Result display",
    "进度显示": "Progress display",
    "重放进度": "Replay progress",
    "修改请求选项": "Modify request options",
    "仅单个重放时显示": "Show only for single replay",
    "修改请求参数": "Modify request parameters",
    "修改模型": "Modify model",
    "输入新的模型名称": "Enter new model name",
    "重放间隔": "Replay interval",
    "避免触发速率限制": "Avoid triggering rate limits",
    "重放会创建新的": "Replay will create new",
    "并标记为": "and mark as",
    "重放完成后可以对比原始": "After replay, can compare original",
    "和重放": "and replay",
    "批量重放会按顺序执行": "Batch replay will execute sequentially",
    "每个请求之间有间隔": "Interval between each request",
    "重放中": "Replaying",
    "批量结果摘要": "Batch result summary",
    "总数": "Total",
    "详细结果列表": "Detailed result list",
    "确定要删除此会话吗": "Are you sure you want to delete this session",
    "取消归档": "Unarchive",
    "归档": "Archive",
    "输入会话描述": "Enter session description",
    "创建于": "Created on",
    "区域": "Area",
    "到会话": "to session",
    "搜索结果": "Search results",
    "此会话暂无": "This session has no",
    "添加第一个": "Add first",
    "从会话移除": "Remove from session",
    "时间信息": "Time information",
    "会话管理": "Session management",
    "创建会话": "Create session",
    "搜索会话": "Search sessions",
    "显示已归档": "Show archived",
    "会话列表": "Session list",
    "活跃会话": "Active sessions",
    "创建第一个会话": "Create first session",
    "已归档会话": "Archived sessions",
    "创建会话对话框": "Create session dialog",
    "编辑会话对话框": "Edit session dialog",
    "会话名称": "Session name",
    "输入会话名称": "Enter session name",
    "编辑会话": "Edit session",
    "等工具": "and other tools",
    "导出的报告将包含当前时间范围内的所有统计数据": "Exported report will contain all statistics for current time range",
    "包括请求趋势": "including request trends",
    "延迟直方图等": "latency histograms, etc.",
    "文件系统访问": "File system access",
    "数据库访问": "Database access",
    "自定义配置": "Custom configuration",
    "成功导入": "Successfully imported",
    "服务器配置": "Server configuration",
    "没有找到": "Not found",
    "配置可导入": "configuration available for import",
    "同步完成": "Sync complete",
    "请输入服务器名称": "Please enter server name",
    "无法保存": "Cannot save",
    "同步到外部应用": "Sync to external apps",
    "从外部导入按钮": "Import from external button",
    "从外部应用导入": "Import from external apps",
    "全部导入": "Import all",
    "同步到外部按钮": "Sync to external button",
    "同步配置到所有外部应用": "Sync configuration to all external apps",
    "同步": "Sync",
    "什么是": "What is",
    "工具扩展协议": "Tool extension protocol",
    "能访问文件系统": "Can access file system",
    "数据库等外部资源": "databases and other external resources",
    "在此添加": "Add here",
    "服务器后": "After server",
    "可同步到": "Can sync to",
    "也可从这些工具导入已有的": "Can also import existing from these tools",
    "统一管理": "Unified management",
    "主内容区域": "Main content area",
    "左右分栏": "Left-right split",
    "左侧列表": "Left list",
    "服务器列表": "Server list",
    "新建": "New",
    "启用的应用标签": "Enabled app tags",
    "右侧编辑面板": "Right edit panel",
    "选择一个": "Select one",
    "服务器进行编辑": "server to edit",
    "或点击": "or click",
    "添加新的服务器": "add new server",
    "仅新建时显示": "Show only when creating new",
    "名称和描述": "Name and description",
    "横排": "Horizontal",
    "服务器名称": "Server name",
    "可选描述": "Optional description",
    "同步到哪些应用": "Sync to which apps",
    "同步到": "Sync to",
    "服务器吗": "server",
    "请等待模型数据加载": "Please wait for model data to load",
    "无搜索结果": "No search results",
    "未找到匹配的模型": "No matching models found",
    "尝试其他搜索词": "Try other search terms",
    "选中指示器": "Selection indicator",
    "模型信息": "Model information",
    "能力标签和操作": "Capability tags and actions",
    "全部模型": "All models",
    "状态和能力标签": "Status and capability tags",
    "视觉": "Vision",
    "模式切换和刷新": "Mode toggle and refresh",
    "统计信息": "Statistics",
    "可用": "Available",
    "刷新按钮": "Refresh button",
    "等级选择器": "Tier selector",
    "专家模式": "Expert mode",
    "显示模型列表": "Show model list",
    "简单模式": "Simple mode",
    "显示当前选择": "Show current selection",
    "简单": "Simple",
    "专家": "Expert",
    "时清除模型选择": "Clear model selection when",
    "的模型": "models",
    "请选择": "Please select",
    "程序员": "Programmer",
    "编程工具": "Programming tools",
    "普通用户": "Regular user",
    "日常使用": "Daily use",
    "聊天和其他功能": "Chat and other features",
    "拦截桌面应用的浏览器启动": "Intercept browser launches from desktop apps",
    "支持手动复制": "Support manual copying",
    "到指纹浏览器": "to fingerprint browser",
    "直接跳到完成页": "Skip directly to completion page",
    "开始安装": "Start installation",
    "跳过安装": "Skip installation",
    "设置完成": "Setup complete",
    "所有插件已成功安装": "All plugins installed successfully",
    "您可以开始使用": "You can start using",
    "个安装失败": "installation failed",
    "您可以稍后在插件中心重试": "You can retry later in Plugin Center",
    "您已跳过插件安装": "You skipped plugin installation",
    "可以稍后在插件中心安装需要的插件": "Can install needed plugins later in Plugin Center",
    "您可以在左侧导航栏的": "You can find in the left navigation bar",
    "随时安装插件": "install plugins anytime",
    "开始使用": "Get started",
    "等待安装": "Waiting to install",
    "准备下载": "Preparing download",
    "请稍候": "Please wait",
    "正在为您安装选中的插件": "Installing selected plugins for you",
    "已为程序员推荐配置管理和": "Configuration management recommended for programmers and",
    "您可以根据需要选择插件": "You can select plugins as needed",
    "或稍后在插件中心安装": "or install later in Plugin Center",
    "您是哪类用户": "What type of user are you",
    "欢迎使用": "Welcome to",
    "聚合代理": "Aggregation proxy",
    "让我们花一分钟时间": "Let's take a minute",
    "根据您的使用场景推荐合适的插件": "to recommend suitable plugins based on your use case",
    "提升您的使用体验": "to enhance your experience",
}

def translate_text(chinese_text, context_key=""):
    """Translate Chinese text to English based on context"""
    # Direct match
    if chinese_text in TRANSLATIONS:
        return TRANSLATIONS[chinese_text]
    
    # Context-based patterns (order matters - most specific first)
    
    # Pattern: "加载X" → "Load X" / "Loading X"
    if chinese_text.startswith("加载"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"Load {TRANSLATIONS[rest].lower()}"
        return f"Load {rest}"
    
    # Pattern: "X失败" → "Failed to X" / "X failed"
    if chinese_text.endswith("失败"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            trans = TRANSLATIONS[base]
            # If it's a verb, use "Failed to X"
            if trans in ["Load", "Save", "Delete", "Add", "Edit", "Update", "Create", "Import", "Export"]:
                return f"Failed to {trans.lower()}"
            return f"{trans} failed"
        # Try to translate the base
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} failed"
        return f"{base} failed"
    
    # Pattern: "X成功" → "X successful" / "X successfully"
    if chinese_text.endswith("成功"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} successful"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} successful"
        return f"{base} successful"
    
    # Pattern: "已X" → "X" / "Already X" / "Xed"
    if chinese_text.startswith("已"):
        rest = chinese_text[1:]
        if rest in TRANSLATIONS:
            trans = TRANSLATIONS[rest]
            # If it's a verb, add "ed" or use past tense
            if trans in ["Archive", "Delete", "Add", "Edit", "Save", "Load", "Copy", "Export"]:
                return f"{trans}d" if not trans.endswith("e") else f"{trans}d"
            return trans
        return rest
    
    # Pattern: "X中" → "Xing" / "In progress"
    if chinese_text.endswith("中"):
        base = chinese_text[:-1]
        if base in TRANSLATIONS:
            trans = TRANSLATIONS[base]
            # Add "ing" for verbs
            if trans in ["Load", "Save", "Add", "Edit", "Create", "Export", "Install"]:
                return f"{trans}ing" if not trans.endswith("e") else f"{trans[:-1]}ing"
            return f"{trans} in progress"
        return f"{base}ing"
    
    # Pattern: "未X" → "Not X" / "Unused"
    if chinese_text.startswith("未"):
        rest = chinese_text[1:]
        if rest in TRANSLATIONS:
            return f"Not {TRANSLATIONS[rest].lower()}"
        if rest == "使用":
            return "Unused"
        return f"Not {rest}"
    
    # Pattern: "请X" → "Please X"
    if chinese_text.startswith("请"):
        rest = chinese_text[1:]
        if rest in TRANSLATIONS:
            return f"Please {TRANSLATIONS[rest].lower()}"
        rest_trans = translate_text(rest, context_key)
        if rest_trans:
            return f"Please {rest_trans.lower()}"
        return f"Please {rest}"
    
    # Pattern: "暂无X" → "No X"
    if chinese_text.startswith("暂无"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"No {TRANSLATIONS[rest].lower()}"
        return f"No {rest}"
    
    # Pattern: "X列表" → "X list"
    if chinese_text.endswith("列表"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} list"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} list"
        return f"{base} list"
    
    # Pattern: "X设置" → "X settings"
    if chinese_text.endswith("设置"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} settings"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} settings"
        return f"{base} settings"
    
    # Pattern: "X模式" → "X mode"
    if chinese_text.endswith("模式"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} mode"
        return f"{base} mode"
    
    # Pattern: "X类型" → "X type"
    if chinese_text.endswith("类型"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} type"
        return f"{base} type"
    
    # Pattern: "X文件" → "X file"
    if chinese_text.endswith("文件"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} file"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} file"
        return f"{base} file"
    
    # Pattern: "X选择器" → "X selector"
    if chinese_text.endswith("选择器"):
        base = chinese_text[:-3]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} selector"
        return f"{base} selector"
    
    # Pattern: "X字段" → "X field"
    if chinese_text.endswith("字段"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} field"
        return f"{base} field"
    
    # Pattern: "X路径" → "X path"
    if chinese_text.endswith("路径"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} path"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} path"
        return f"{base} path"
    
    # Pattern: "选择X" → "Select X"
    if chinese_text.startswith("选择"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"Select {TRANSLATIONS[rest].lower()}"
        rest_trans = translate_text(rest, context_key)
        if rest_trans:
            return f"Select {rest_trans.lower()}"
        return f"Select {rest}"
    
    # Pattern: "打开X" → "Open X"
    if chinese_text.startswith("打开"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"Open {TRANSLATIONS[rest].lower()}"
        rest_trans = translate_text(rest, context_key)
        if rest_trans:
            return f"Open {rest_trans.lower()}"
        return f"Open {rest}"
    
    # Pattern: "X名称" → "X name"
    if chinese_text.endswith("名称"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} name"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} name"
        return f"{base} name"
    
    # Pattern: "X信息" → "X information"
    if chinese_text.endswith("信息"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} information"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} information"
        return f"{base} information"
    
    # Pattern: "X错误" → "X error"
    if chinese_text.endswith("错误"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} error"
        return f"{base} error"
    
    # Pattern: "X包" → "X package"
    if chinese_text.endswith("包"):
        base = chinese_text[:-1]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} package"
        return f"{base} package"
    
    # Pattern: "X目录" → "X directory"
    if chinese_text.endswith("目录"):
        base = chinese_text[:-2]
        if base in TRANSLATIONS:
            return f"{TRANSLATIONS[base]} directory"
        base_trans = translate_text(base, context_key)
        if base_trans:
            return f"{base_trans} directory"
        return f"{base} directory"
    
    # Pattern: "启用X" → "Enable X"
    if chinese_text.startswith("启用"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"Enable {TRANSLATIONS[rest].lower()}"
        rest_trans = translate_text(rest, context_key)
        if rest_trans:
            return f"Enable {rest_trans.lower()}"
        return f"Enable {rest}"
    
    # Pattern: "禁用X" → "Disable X"
    if chinese_text.startswith("禁用"):
        rest = chinese_text[2:]
        if rest in TRANSLATIONS:
            return f"Disable {TRANSLATIONS[rest].lower()}"
        rest_trans = translate_text(rest, context_key)
        if rest_trans:
            return f"Disable {rest_trans.lower()}"
        return f"Disable {rest}"
    
    # Pattern: "X的Y" → "Y of X" / "X's Y"
    if "的" in chinese_text:
        parts = chinese_text.split("的", 1)
        if len(parts) == 2:
            left, right = parts
            left_trans = translate_text(left, context_key) or TRANSLATIONS.get(left, left)
            right_trans = translate_text(right, context_key) or TRANSLATIONS.get(right, right)
            # Common patterns
            if right in ["值", "内容", "配置", "设置", "信息", "状态", "名称", "类型", "列表", "文件"]:
                return f"{right_trans} of {left_trans}"
            return f"{left_trans}'s {right_trans}"
    
    # Pattern: "X和Y" → "X and Y"
    if "和" in chinese_text:
        parts = chinese_text.split("和", 1)
        if len(parts) == 2:
            left, right = parts
            left_trans = translate_text(left, context_key) or TRANSLATIONS.get(left, left)
            right_trans = translate_text(right, context_key) or TRANSLATIONS.get(right, right)
            return f"{left_trans} and {right_trans}"
    
    # Pattern: "X或Y" → "X or Y"
    if "或" in chinese_text:
        parts = chinese_text.split("或", 1)
        if len(parts) == 2:
            left, right = parts
            left_trans = translate_text(left, context_key) or TRANSLATIONS.get(left, left)
            right_trans = translate_text(right, context_key) or TRANSLATIONS.get(right, right)
            return f"{left_trans} or {right_trans}"
    
    # Pattern: "X后Y" → "Y after X"
    if "后" in chinese_text and not chinese_text.endswith("后"):
        parts = chinese_text.split("后", 1)
        if len(parts) == 2:
            left, right = parts
            left_trans = translate_text(left, context_key) or TRANSLATIONS.get(left, left)
            right_trans = translate_text(right, context_key) or TRANSLATIONS.get(right, right)
            return f"{right_trans} after {left_trans}"
    
    # Pattern: "X中Y" → "Y in X" (when not ending with 中)
    if "中" in chinese_text and not chinese_text.endswith("中"):
        parts = chinese_text.split("中", 1)
        if len(parts) == 2:
            left, right = parts
            left_trans = translate_text(left, context_key) or TRANSLATIONS.get(left, left)
            right_trans = translate_text(right, context_key) or TRANSLATIONS.get(right, right)
            return f"{right_trans} in {left_trans}"
    
    # Return None if no translation found
    return None

def main():
    print("=" * 60)
    print("  AI-Assisted Translation Script")
    print("=" * 60)
    print()
    
    print(f"Loading {EN_FILE}...")
    with open(EN_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    count = 0
    total = sum(1 for v in data.values() if isinstance(v, str) and v.startswith('[TODO: Translate]'))
    
    print(f"Found {total} entries to translate...")
    print()
    
    current_section = ""
    for key, value in data.items():
        # Track current section
        if key.startswith("// ==="):
            current_section = key
            
        if isinstance(value, str) and value.startswith('[TODO: Translate]'):
            chinese = value.replace('[TODO: Translate] ', '')
            translation = translate_text(chinese, current_section)
            
            if translation:
                data[key] = translation
                count += 1
                
                if count % 100 == 0:
                    print(f"Progress: {count}/{total} ({round(count/total*100)}%)")
    
    # Save
    print()
    print("Saving translations...")
    with open(EN_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print()
    print("=" * 60)
    print(f"✓ Translation complete!")
    print(f"  Translated: {count} entries")
    print(f"  Remaining: {total - count} entries")
    print(f"  Coverage: {round(count/total*100 if total > 0 else 0)}%")
    print("=" * 60)

if __name__ == '__main__':
    main()
