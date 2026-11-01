# Kawaii Python Diagnostics 0.1.0 预览版

保留 Pylance，将 838 条简体中文诊断替换为独立编写的可爱文案。适配 Pylance **2026.4.1**，其他版本拒绝修改。

## 安装

1. 安装官方 Python、Pylance 2026.4.1 和简体中文语言包，并将 VS Code 显示语言设为简体中文。
2. 关闭 `python.analysis.displayEnglishDiagnostics`。
3. 下载发行附件中的 `.vsix`，使用 VS Code 扩展面板的“从 VSIX 安装…”安装。
4. 打开本地 Python 工作区，运行 **Kawaii Python: 启用可爱报错**，按提示重载窗口。

此插件会备份并修改 Pylance 的中文消息表，影响共享同一安装的窗口。**禁用或卸载前必须先执行“恢复原版并停用”，然后重载。**

## 检查与范围

- 本项目为 MIT 开源；原始消息已逐条对照公开 Pyright 历史版本，完整第三方许可随包保留。
- 源码和 VSIX 均经过敏感信息规则扫描；缓存、凭据、私钥、本机路径和运行日志不随包发布。
- 运行时不上传用户源码或遥测，不下载远程补丁。
- Windows、Linux、macOS 的真实 VS Code 隔离集成、打包和安全检查均已通过 [三平台 CI](https://github.com/Sqhao-O/kawaii-python/actions/runs/41268429524)；macOS 另完成原生 UI 和实际 VSIX 安装验证。此版本仍为预览版。
- 不覆盖 Ruff/Pylint、运行时异常、Notebook、远程环境或英文诊断。

GitHub Releases 提供离线安装包；VS Code Marketplace 上架是独立流程，以市场页面实际状态为准。
