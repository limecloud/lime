# 代码本体图谱模块


## 模块结构

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口和导出 |
| `types.rs` | 基础类型定义 |
| `types_enhanced.rs` | 增强版类型定义 |
| `types_chunked.rs` | 分块模式类型定义 |
| `analyzer.rs` | 代码分析器 |
| `dependency_analyzer.rs` | 依赖分析器 |
| `call_graph_builder.rs` | 调用图构建器 |
| `incremental_cache.rs` | 增量缓存 |
| `layer_classifier.rs` | 架构层分类器 |
| `view_builder.rs` | 视图构建器 |
| `ontology_generator.rs` | 本体生成器 |
| `enhanced_generator.rs` | 增强版生成器 |
| `chunked_generator.rs` | 分块生成器 |
| `incremental_updater.rs` | 增量更新器 |
| `sync_manager.rs` | 双向同步管理器 |
| `symbol_reference_analyzer.rs` | 符号引用分析器 |
| `type_reference_analyzer.rs` | 类型引用分析器 |
| `semantic_generator.rs` | AI 语义生成器 |
| `server/` | 可视化服务器子模块 |
| `tests.rs` | 测试文件 |

## 主要功能

### 分析器
- `CodeMapAnalyzer` - 代码地图分析器
- `DependencyAnalyzer` - 依赖分析
- `CallGraphBuilder` - 调用图构建
- `SymbolReferenceAnalyzer` - 符号引用分析
- `TypeReferenceAnalyzer` - 类型引用分析

### 生成器
- `OntologyGenerator` - 基础本体生成
- `EnhancedOntologyGenerator` - 增强版生成
- `ChunkedBlueprintGenerator` - 分块生成
- `SemanticGenerator` - AI 语义生成

### 更新与同步
- `IncrementalBlueprintUpdater` - 增量更新
- `BlueprintCodeSyncManager` - 双向同步

### 可视化
- `VisualizationServer` - Web 可视化服务器

## 测试

```bash
cargo test -p aster --lib map::
```
