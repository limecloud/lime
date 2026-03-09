## ProxyCast v0.82.0

### 🔧 优化与重构

- 大量 Rust 代码质量改进：为枚举类型添加 `#[derive(Default)]` 属性
- 实现 `FromStr` trait 替代手动 `from_str` 方法，提升代码规范性和类型安全性
- 修复不必要的 `unwrap()` 调用，改用更安全的 `if let` 模式
- 优化代码结构：修复 TypeScript lint 错误，移除未使用的变量和函数
- 修复 `react-hooks/exhaustive-deps` 警告，优化 Hook 依赖项

### 🐛 修复

- 修复 ThemeWorkbenchSidebar 组件中的 20+ 个 ESLint 错误
- 修复 useConfiguredProviders hook 中的依赖项警告
- 修复 Rust 代码中的 33 个 clippy 警告
- 修复 sticky_manager.rs 中的不必要的 unwrap 调用
- 修复 poster_material_dao.rs 中的不必要的 unwrap 调用

### 📦 其他

- AI 代码质量验证全部通过（57 个文件，平均分 97/100）
- 代码格式化和 lint 检查全部通过
- 为未来的 Rust 代码改进打下基础

---

**完整变更**: v0.81.0...v0.82.0
