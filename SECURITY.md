# 安全与隐私

运行时不读取 Python 源码，不向网络发送源码、诊断、路径或遥测，不下载远程补丁或执行 Pylance 消息表。所需词库和兼容数据随安装包发布。

插件会在首次主动启用后修改已验证版本的 Pylance 中文消息表，生成原始文件备份、哈希、共享开关和事务日志。备份位于扩展安装目录旁的 `.kawaii-python-diagnostics` 隐藏目录，包含原始 Pylance 文件和本机安装路径，不属于应上传的项目源码。日志也可能包含本机安装路径，提交 issue 前请脱敏。

开源仓库与 VSIX 不应包含：令牌、密码、私钥、`.env`、`.vsce`、`.npmrc`、个人目录路径、测试缓存、原始运行日志或原版 Pylance 程序文件。维护者发布前运行 `npm run audit:release`，打包后再执行 `python3 scripts/release-audit.py --vsix artifacts/kawaii-python-diagnostics-0.1.0.vsix`。

请通过仓库的 GitHub Security Advisory 私密报告入口报告漏洞；若入口不可用，可先提交不包含漏洞利用细节和敏感信息的 issue，请求维护者提供私密沟通渠道。不要在公开 issue 中上传 PAT、用户源码或未经脱敏的日志。
