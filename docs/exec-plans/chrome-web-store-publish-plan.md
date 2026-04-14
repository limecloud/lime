# Chrome Web Store 发布计划

## 目标

将 `extensions/lime-chrome` 以当前可发布版本提交到 Chrome Web Store，并沉淀可复用的上架材料，避免后续版本更新再次依赖口头说明。

## 当前状态

- 已确认扩展目录：`extensions/lime-chrome`
- 已确认扩展版本：`0.3.0`
- 已生成上传包：`tmp/lime-chrome-0.3.0.zip`
- 已发现安装页内预留商店链接：`https://chromewebstore.google.com/detail/lime-chrome/cpidmllglbedhpombjibeoalnafofipo`
- 公开链接当前未返回可见上架页，需在开发者后台确认该条目是草稿、私有条目还是无效占位

## 已完成

1. 检查扩展结构、`manifest.json`、README 与现有仓库脚本，确认仓库内没有现成的 Chrome 商店发布自动化
2. 识别审核敏感权限与行为：
   - `debugger`
   - `clipboardRead`
   - `notifications`
   - `host_permissions: <all_urls>`
3. 生成待上传 zip 产物，并记录哈希便于核对
4. 补齐仓库内可复用的发布文案与隐私政策工件
5. 生成首批 Chrome 商店截图草稿素材

## 阻塞项

1. 真正发布到 Chrome Web Store 需要进入 Google 开发者后台，属于高风险外部发布动作，必须先得到用户明确确认
2. 若开发者后台尚未保存截图、分类、数据使用问卷或发布地区信息，仍需在后台继续补齐
3. 若当前商店条目与安装页中的扩展 ID 不一致，需要在后台确认是否继续沿用旧条目或新建条目
4. 隐私政策需要一个公网可访问 URL；当前仓库内文件已就绪，但尚未推送到公开可访问位置

## 下一步

1. 进入 Chrome Web Store 开发者后台，确认 `cpidmllglbedhpombjibeoalnafofipo` 对应条目状态
2. 使用 `tmp/lime-chrome-0.3.0.zip` 上传扩展包
3. 将 `extensions/lime-chrome/CHROME_WEB_STORE_SUBMISSION.md` 中的文案和权限说明填入后台
4. 将 `extensions/lime-chrome/PRIVACY_POLICY.md` 对应的公开 URL 填入隐私政策字段
5. 完成数据使用问卷、截图与可见性配置后提交审核或发布

## 进度日志

### 2026-04-13

- 完成本地打包与审核风险盘点
- 确认需要先补齐发布文案与隐私政策，再进入发布后台
- 生成 3 张 `1280x800` 商店截图草稿，位于 `tmp/chrome-store-assets/`
- 由于发布属于外部生产动作，暂未执行任何登录、上传或提交操作
