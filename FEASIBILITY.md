# Python 可爱报错 VS Code 扩展：可行性探索

> 这是实现前的调研快照。当前插件、安装方式及验证结果见 `README.md` 和 `docs/VALIDATION.md`。

调研日期：2026-10-30。完成了参考仓库、上游源码、公开 API 和本机安装包的只读检查；未实现插件、未修改现有扩展，尚未在 Extension Development Host 中验证效果。

## 结论

可以制作。需要先明确“替换”的范围：

- **保持 Pylance，显示可爱版行尾提示和附加悬浮说明**：可行，适合作为首版。原生 Problems 面板和诊断悬浮中的原文仍然保留。
- **让 Problems、原生诊断悬浮及读取诊断的插件都得到改写后的文案**：需要控制诊断发布端。推荐基于开源 Pyright 制作独立扩展，并在发布前改写文案；使用时需处理与 Pylance 的功能冲突。
- **直接修改 Pylance 安装包**：本机包内能找到诊断模板，存在补丁实验空间，但未验证修改后的加载效果。版本耦合、更新覆盖和恢复成本使其不适合作为默认发行方案。
- **运行时 traceback**：属于另一条链路，需要运行包装器或异常钩子，不能由编辑器诊断转换直接覆盖。

## 参考项目实际做了什么

[kawaii-vscode-cpptools 的说明](https://github.com/Gary-0925/kawaii-vscode-cpptools/blob/main/README.md)要求用户替换 C/C++ 扩展的 `bin/messages/zh-cn/messages.json`。仓库提供可爱化消息文件，并未提供接管其他扩展诊断的通用插件。其兼容性依赖目标扩展版本与文件结构。

## Python 的报错来源

| 场景 | 常见来源 | 可爱化接入位置 |
| --- | --- | --- |
| 编辑时语法、未定义变量、导入和类型提示 | Pylance / Pyright | 读取 diagnostics 后额外展示；或控制语言客户端/服务端后在发布前改写 |
| 风格及静态检查 | Ruff、Pylint 等独立工具 | 需要分别适配 source、规则码和消息格式 |
| 执行后的 NameError、TypeError 等 | Python 解释器 | 自有运行入口、异常钩子或 traceback 格式化 |
| Notebook、测试、调试中的异常 | 各自运行及展示链路 | 后续单独验证，首版不承诺统一覆盖 |

[Pylance 官方仓库](https://github.com/microsoft/pylance-release/blob/main/README.md)说明 Pylance 本身不开源，核心类型引擎来自开源 Pyright。Python 扩展、Pylance 和解释器的报错不能视作同一个消息库。

## 已核实的技术边界

### 1. 普通扩展能读诊断，但没有公开的跨扩展覆盖接口

[VS Code API](https://code.visualstudio.com/api/references/vscode-api#languages)提供 `languages.getDiagnostics()` 和 `onDidChangeDiagnostics`，可以获取现有诊断和更新事件。

`createDiagnosticCollection()` 创建自身管理的诊断集合。将 Pylance 的诊断复制并改写到新集合，会新增一份诊断；集合名字相同也不能据此接管原集合。公开 API 没有获取其他扩展集合并覆盖其内容的入口。不能将修改 `getDiagnostics()` 返回对象当作可靠的回写机制。

可用 Decoration 绘制行尾文案，用 HoverProvider 添加说明。二者属于附加展示，不会删除原生诊断悬浮，也不会改写 Problems。

[Error Lens 的实现](https://github.com/usernamehw/vscode-error-lens/blob/master/src/decorations.ts)采用读取 diagnostics 并绘制装饰的方式，可以借鉴其展示思路。与 Error Lens 同时启用行尾展示时，需要配置其中一方以避免 Python 提示重叠。

### 2. 本机 Pylance 不是替换一个诊断 JSON 即可

本机只读检查目标：`~/.vscode/extensions/ms-python.vscode-pylance-2026.4.1`。

- 根目录存在 `package.nls.zh-cn.json`，检查到的键包含 `ClientLoc.*`，用于客户端界面等文案。
- 诊断中文模板和 `Diagnostic` 键出现在 `dist/pyright.bundle.js` 等打包文件中；浏览器及 Copilot 相关包中也有副本。
- 因此不能凭根目录 JSON 的存在，认为它就是完整诊断消息库。也尚未确认不同运行模式实际加载哪些副本。

这一结论限定于上述安装版本，不能外推为所有 Pylance 版本的固定布局。

### 3. Pyright 提供清晰的改造位置

[Pyright 本地化源码](https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/localization/localize.ts)按稳定的消息键查找模板，并替换命名参数；[中文消息库](https://github.com/microsoft/pyright/blob/main/packages/pyright-internal/src/localization/package.nls.zh-cn.json)包含 `Diagnostic` 和附加诊断文本。

因此可以维护一份可爱化模板覆盖表，保留 `{name}`、`{argType}`、`{paramType}` 等占位符，在构建或消息查询时应用。比在最终文本中做大量正则替换更准确。

另一接入点是在自身语言客户端发布诊断前转换文案：[语言客户端源码](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/client.ts)支持 push diagnostics 的 `middleware.handleDiagnostics`；[pull diagnostics 源码](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/diagnostic.ts)有独立中间件。不能把这些钩子注入另一个扩展已经创建的 Pylance 客户端；选择客户端方案时需覆盖所启用的 push/pull 路径。

[Pyright 扩展入口](https://github.com/microsoft/pyright/blob/main/packages/vscode-pyright/src/extension.ts)也明确处理了与 Pylance 的重叠冲突。制作独立版本时还需要调整扩展身份及命令等，不能默认同时运行两套语言服务。

### 4. 运行时可另做，但需要专门的运行入口

[Python 的 sys.excepthook](https://docs.python.org/3/library/sys.html#sys.excepthook)允许定制顶层未捕获异常的展示。可通过“以可爱模式运行 Python”命令启动包装器，在目标文件执行前安装钩子；语法错误也需在包装器的编译/加载阶段处理。

线程、异步任务、子进程、测试框架、Notebook 和调试器各有异常处理方式，不能仅凭一个钩子承诺全覆盖。实现时还需保持解释器选择、工作目录、参数、退出码和 traceback 定位语义。

## 路线比较

| 路线 | 与 Pylance 配合 | 改写原生 Problems | 主要代价 | 判断 |
| --- | --- | --- | --- | --- |
| 附加行尾提示 / 悬浮 | 可以 | 不可以 | 最终文本匹配、避免重复展示 | 推荐首版 |
| 独立 Pyright 扩展 + 模板覆盖 | 需处理冲突 | 可以，限自身诊断 | 跟进上游、语言服务打包与兼容 | 推荐完整替换路线 |
| Pylance 安装包补丁 | 依赖版本 | 理论上可能，未实测 | 打包结构变化、更新覆盖、回滚 | 仅供受控实验 |
| 自有运行命令 + 异常格式化 | 可以 | 不属于静态诊断 | 运行环境与异常链路适配 | 后续独立功能 |

## 建议的最小验证

先制作轻量附加展示原型，范围为 `.py` 文件的 Pylance/Pyright 诊断，覆盖未定义变量、缺失导入、参数类型、参数数量、缩进和括号等常见问题。

转换按 `source + code + message` 分层匹配。规则码可能对应多个具体消息，部分语法诊断也未必带规则码，不能只按 code 套统一句子。保留变量名、类型名、模块名及错误细节；中文、英文诊断分别适配；未匹配时回退原文。优先使用本地词库，无需模型服务。

例如，未定义变量 `name` 可显示为：“咦，`name` 还没被定义呢，先给它赋个值吧～”。悬浮可附原文与规则码，支持原文/可爱版切换。

验证重点是：错误修复后提示及时消失；编辑过程中无明显闪烁；多行诊断和同一行多个问题可读；中英文均能回退；原有定位和 Quick Fix 保持可用；与 Error Lens 的展示互不重叠。

如果验收标准要求原生 Problems 也必须被替换，应直接选择 Pyright 路线。附加展示原型无法通过增加一个诊断集合升级为无重复的完整替换。
