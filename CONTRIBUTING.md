# 参与贡献

请先阅读 README 和 `docs/MAINTENANCE.md`。贡献代码及文案按本仓库 MIT 许可证提供；保留第三方来源、版权声明和许可。

提交前运行：

```sh
npm ci
npm run typecheck
npm test
npm run catalog:check
npm run audit:release
npm run package
```

涉及补丁引擎或扩展生命周期时，还需在隔离环境运行 `npm run test:integration`。报告真实验证过的平台，不将 CI 配置存在视为测试通过。

文案修改须保留占位符及其出现次数、否定关系、类型方向、数量、Python 版本要求和结构换行。附加诊断要能与上下文组合阅读。不要提交 Pylance 程序包、个人路径、缓存、日志或凭据。

提交 issue 请说明插件和 Pylance 版本、操作系统、复现步骤、预期和实际结果；源码及日志必须先脱敏。
