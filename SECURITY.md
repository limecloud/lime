# 安全问题

优先使用 [GitHub 私密漏洞报告入口](https://github.com/limecloud/lime/security/advisories/new)。该入口取决于仓库是否开启 Private vulnerability reporting；若未开启，可先创建只请求私密联系渠道的 issue，不公开漏洞细节、利用载荷或凭据。维护者尚未承诺固定响应时限或历史版本的安全维护周期。

报告请包含受影响版本、操作系统、最小复现、所需权限和可验证的影响。使用自行生成的测试凭据，删除日志中的 API Key、token、用户路径及私密内容。普通功能错误请使用 GitHub issues。

Provider 凭据默认经系统密钥库保护的加密文件存储；headless 文件模式是显式配置，见[凭据存储](docs/content/03.providers/2.credential-storage.md)。密钥库不可用时不会自动降级到明文。日志与测试证据不得包含原始凭据。

维护者应在变更中记录根因、受影响边界、回归验证和依赖审查结果；发布修复时提供匹配的源码与版本信息。
