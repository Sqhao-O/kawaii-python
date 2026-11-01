# 公开发布前检查记录

检查日期：2026-11-01。目标仓库：`Sqhao-O/kawaii-python`；版本：0.1.0 预览版。

0.1.1 发布准备：已在 Marketplace 管理页核对发布者标识为 `sqhao`，扩展标识改为 `sqhao.kawaii-python-diagnostics`。通过网页发布，不创建、保存或上传个人访问令牌。原有 0.1.0 发行内容保留，README 增加恢复、卸载旧标识后再安装新标识的迁移步骤。Pylance 适配和词库不变，重新执行源码、包内容、测试和 CI 检查。

## 许可证及来源

- 本项目使用 MIT，保留完整授权与免责文本。
- 原始中文消息的 838 个键和值已逐条对照 Microsoft Pyright 的公开提交 `0653de232eef08dd1ee79373e26f59cfcc0c015f`，完全一致。来源、日期、数量和基线校验和记录在 `resources/provenance.json`。
- Pyright 的完整 MIT 许可在 `third_party/pyright/LICENSE.txt`；Acorn 与 acorn-walk 的版权及 MIT 文本在 `THIRD_PARTY_NOTICES.md`。
- 没有重新发布 Pylance 程序包或原始打包代码。Pylance 自身许可独立适用，本项目不是微软官方项目，不宣称获得微软认可。

## 敏感信息及包内容

- 清理历史调研记录中的个人绝对目录；使用公开 GitHub 账号标识，不写入私人邮箱。
- 对公开文件白名单和构建后的 VSIX 执行 `scripts/release-audit.py` 规则扫描，检查令牌、私钥、凭据 URL、明文凭据、本机用户目录和常见私人邮箱；未检出。
- 测试缓存、原版 Pylance 副本、备份、事务日志、运行日志和本机集成 JSON 报告不上传源码，不进入发行包。
- 效果截图经过目视核对；截图为 JPEG，文件扩展名已纠正，未包含账号、令牌或个人路径。账号注册页面截图仅保留在忽略的本机缓存中。
- 运行时只使用随包词库及兼容数据，不读取 Python 源码，不向网络上传诊断或遥测，不拉取远程可执行补丁。

## 依赖及验证

- `npm audit`：运行时及开发依赖合计 0 项已知漏洞。
- 将 VSIX 打包工具升级为 `@vscode/vsce` 4.1.0，并仅对该开发工具使用修复版本 `minimatch` 11.0.1 及以上的覆盖约束，消除其遗留的间接漏洞。重新验证打包及包内文件集合。
- 18 项自动化测试、TypeScript 检查及 838 条词库校验通过。
- macOS 原生 Problems、悬浮、Error Lens、实际 VSIX 安装与恢复验证记录见 `docs/VALIDATION.md`；Windows/Linux 以 Actions 的真实结果为准。

## 发布边界

README 包含前置条件、下载、安装、配置、启用、验证效果、恢复和卸载步骤。开头明确说明安装文件修改与共享窗口影响。

GitHub 预览版与 Marketplace 上架分别管理。Marketplace 需要账号本人完成首次资料与条款确认，并提供真实发布者标识及发布权限；未完成前不宣称已经上架。
