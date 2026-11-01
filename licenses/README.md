# 上游来源与适配

上游原有授权与本目录材料同时随 Lime 分发。

| 来源                | revision                                   | 源路径                                                       | Lime 消费者与适配                                                                                                       |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| OpenAI Codex        | `6174d05a6a17255dda97be686072eee00c4a1bc9` | `codex-rs/keyring-store/src/**`                              | `infra/src/keyring-store/**`；crate import 改模块 import，mock 仅 test 编译                                             |
| OpenAI Codex        | 同上                                       | `codex-rs/secrets/src/**`                                    | `infra/src/secrets/**`；Lime 品牌与目录适配，裁掉无消费者的 git environment helper；Provider service 调用 Local backend |
| SpaceXAI Grok-build | `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` | `crates/codegen/xai-grok-shell-base/src/util/secure_file.rs` | `infra/src/secure_file.rs`；无源码改写，Provider 文件模式使用 Unix 权限与 Windows ACL helper                            |

Codex 的登录、云端账号、计费、遥测和单模型服务没有进入本次复制范围。Grok-build 的登录服务、refresh chain 和遥测也没有进入 Lime。Provider 的身份、多 Key、路由及自有服务端仍由 Lime 的现役 owner 管理。

Provider 适配层为共享文件增加有界进程锁，锁文件不删除；这属于 Lime 接线，不宣称是 Codex 原函数。凭据模式与恢复约束见[公开配置说明](../docs/content/03.providers/2.credential-storage.md)。

CLI launcher 的上游来源为同 revision 的 `codex-cli/bin/codex.js`，其 `codex-cli/package.json` 明确声明 Apache-2.0。Lime 既有 MIT 部分继续保留；组合包不再仅标 MIT。
