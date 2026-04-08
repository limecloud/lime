# Codesign 模块

代码签名系统，用于签名和验证代码文件的安全模块。

## 模块结构

```
codesign/
├── mod.rs      # 模块入口和导出
├── types.rs    # 类型定义（签名、密钥、验证结果）
├── keys.rs     # 密钥生成和管理
├── signing.rs  # 签名和验证功能
├── storage.rs  # 签名存储和缓存
└── README.md   # 本文档
```

## 核心功能

### 类型定义 (types.rs)
- `HashAlgorithm` - 哈希算法枚举 (SHA256/384/512)
- `CodeSignature` - 代码签名结构
- `SignedFile` - 已签名文件
- `SigningKey` - 签名密钥
- `VerifyResult` - 验证结果

### 密钥管理 (keys.rs)
- `generate_key_pair()` - 生成新密钥对
- `get_key()` - 根据 ID 获取密钥
- `get_signing_key()` - 获取可用签名密钥

### 签名功能 (signing.rs)
- `hash_content()` - 计算内容哈希
- `sign_content()` - 签名内容
- `verify_signature()` - 验证签名
- `sign_file()` - 签名文件
- `verify_file()` - 验证文件

### 存储管理 (storage.rs)
- `init_signing()` - 初始化签名系统
- `save_key()` / `load_keys()` - 密钥持久化
- `cache_signature()` - 缓存签名
- `save_signatures()` / `load_signatures()` - 签名持久化
- `clear_signature()` - 清除签名
- `get_signed_files()` - 获取所有已签名文件
- `is_signed()` - 检查文件是否已签名

## 使用示例

```rust
use aster::codesign::{
    generate_key_pair, sign_file, verify_file,
    hash_content, HashAlgorithm,
};

// 生成密钥对
let key = generate_key_pair()?;

// 签名文件
let signed = sign_file("src/main.rs", Some(&key.id));

// 验证文件
let result = verify_file("src/main.rs");
if result.valid {
    println!("文件签名有效");
}

// 计算哈希
let hash = hash_content("content", HashAlgorithm::Sha256);
```

## 存储位置

- 密钥文件: `~/.aster/signing/keys.json`
- 签名文件: `~/.aster/signing/signatures.json`

## 注意事项

当前实现使用 HMAC-SHA256 作为简化签名方案。
如需完整的 Ed25519 非对称签名，需要添加 `ring` 或 `ed25519-dalek` 依赖。
