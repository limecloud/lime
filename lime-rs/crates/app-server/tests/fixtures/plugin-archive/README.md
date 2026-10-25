# 插件 tar.gz 共同样例

此目录的 `index.json` 与 56 个归档和 LimeCore
`services/control-plane-svc/internal/service/testdata/plugin-archive/` 保持逐字节一致。
每个归档的 SHA-256 固定在 index；两端的真实 extractor/scanner 消费同一字节，验证接受/
拒绝结果、文件内容、manifest 选择与原字节摘要。Rust 分享 packer 另做正向包内容回读。

共同资源边界为：通用压缩输入 100 MiB、分享输出 50 MiB、普通文件总量 512 MiB、
普通文件与目录共 10000 条（不计 `./` 根目录和透明的 PAX/GNU metadata）、路径 256 层，
读取的 manifest 2 MiB；整个 tar 展开流最多 512 MiB + 32 MiB，包括 metadata 与全零 padding。
测试中的 `expandedLimit` 只缩小普通文件预算，并按同一公式计算流预算，以验证准确边界。
Core 的其他组件 metadata 保留单文件 1 MiB/累计 8 MiB 的静态扫描配额。

相对树包含隐藏文件，保留正常执行权限；拒绝越界、非 UTF-8、反斜杠/冒号、路径前后空白、
重复/冲突、链接/特殊/稀疏文件、目录 body、非零尾部、CRC/截断和额外 gzip 流。
这些共同资源与安全约束不冒充 Lime 原代码的全部限制，Lime 源码仍是行为参照。

唯一生成器为本目录 `generate.py`。从 Lime 仓库执行：

```bash
python3 "lime-rs/crates/app-server/tests/fixtures/plugin-archive/generate.py" \
  --mirror "/path/to/limecore/services/control-plane-svc/internal/service/testdata/plugin-archive"
```

修改样例时同时生成两仓，运行两端 corpus 测试并比较整个目录的归档/index 摘要。
损坏的归档均为显式负向夹具，不用于生产 fallback，不读取用户插件或凭据。
