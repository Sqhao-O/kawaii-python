# 维护 Pylance 适配

维护分为词库和打包适配器两层。正常更新只审查变动的消息键；仅当 AST 数据块结构变化时才修改适配器。

## 数据与约束

- `resources/original.zh-cn.json`：当前适配版本的原始诊断文本基线。
- `resources/catalog.zh-cn.json`：词库版本及扁平消息键到中文文案的映射。
- `resources/compatibility.json`：适配器版本、精确 Pylance 版本、文件集合、原文件 SHA-256、完整中文消息表指纹和诊断数量。

当前基线有 838 个键，其中主诊断 665 个、附加诊断 173 个。覆盖率必须为 100%，不得遗漏、加未知键或给空字符串。占位符名称和出现次数必须一致。不要把运行时类型名称写死进模板。

附加诊断经常组成嵌套长消息。保留源/目标类型、协变/逆变方向、否定条件、数量以及 Python 版本要求。对本地化中可疑的翻译，查阅相同版本英文消息或公开 Pyright 源码；例如 `yieldWithinComprehension` 的原中文漏了否定词，可爱版已按实际含义写为“不允许”。

## 新版本流程

1. `npm run upstream:check` 检查官方更新记录中的最新稳定版本。每周工作流也会执行此步骤。
2. `node scripts/install-candidate.mjs <精确版本>` 将官方 Pylance 安装到 `.cache/candidate/`。
3. 对实际安装目录运行 `node --import tsx scripts/maintain.ts extract <目录>`，生成 `artifacts/candidate-report.json` 和候选消息表。
4. 检查新增、删除、文本和占位符变化，以及四份消息副本、文件哈希、表指纹。无法唯一识别中文表时停止，审查 AST 适配器。
5. 更新基线和受影响文案、词库版本、兼容清单。不再适用于当前基线的旧版本需从清单移除；不要让一个基线假装兼容不同结构。若要同时维护不同结构，先扩展按版本选择基线/词库的格式及测试。
6. 运行类型检查、词库校验、单元测试、三平台隔离集成测试，并检查原生 Problems、悬浮和 Error Lens 展示。
7. 通过后更新验证记录和版本号，构建 VSIX。新适配不通过测试，不进入发行版。

维护脚本不会自动应用候选补丁：

```sh
npm run inspect -- <Pylance目录>
node --import tsx scripts/maintain.ts extract <Pylance目录>
node --import tsx scripts/maintain.ts diff <Pylance目录>
node --import tsx scripts/maintain.ts dry-run <Pylance目录>
```

`extract` 额外输出候选消息；`diff` 输出差异；`dry-run` 检查当前版本兼容性并在内存生成、校验补丁。所有命令都不修改目标安装目录。

## 事务及状态

安装路径的真实路径决定备份分组和共享锁，避免不同 Profile 各自备份已修改的文件。事务日志在改动任何目标文件之前写入；原始备份和事务回滚备份先写入并同步。

正常写入保留原文件模式，单文件采用同目录临时文件替换；多文件通过日志回滚，不声称整个目录原子切换。检查到身份变化或第三方修改时拒绝覆盖。不要在应用期间重载窗口。

进程崩溃后，下次启动先恢复未完成事务。恢复必须校验安装版本、文件集合、当前哈希和回滚备份哈希。活跃进程持有的锁不会被抢占；未写完锁身份的异常中断需等待两分钟再重试。极端情况下在清理旧锁本身时再次中断，优先重新安装 Pylance，勿强制覆盖。

共享恢复开关优先于各 Profile 的自动应用偏好。未知 Pylance 版本不写入诊断文件；只有本插件随包发布的已验证兼容数据可被用于自动应用。

## 发布门槛

每次发行检查词库、引擎和扩展生命周期，以及 Pylance 首次加载和更新后的实际表现。Windows/Linux 工作流尚未运行成功时，不能把它们标记为实测通过。GitHub 工作流只产出报告和 VSIX，不上传 Marketplace，也不自动合并兼容数据。

公开前运行 `npm run audit:release`、`npm audit`，打包后再对 VSIX 运行审查脚本。`release.yml` 是手动触发的 GitHub 预览版发布流程，只上传 VSIX 与校验和；不会发布到 Marketplace。`package.json` 对打包工具的 minimatch 覆盖约束用于修复间接漏洞，更新打包工具时应重新核对并运行包内容审查。
