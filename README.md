# gongkao-practice.skill

已实现本地 AI 考公 Plugin 1.0.0：**同一个公共包供多人安装，各自保存个人数据；本地网页与桌面 AI 聊天共享进度，无需云服务器。**

以 Skill 0.9 的教学规则、调度与题库处理为基础，复用 gongkao 的题库快照和基础训练原则，增加独立 SQLite、自动保存、持久会话、stdio MCP 和完整 Windows 交付。

## 使用

1. 下载或复制 dist/ 中的 Windows x64 ZIP，完整解压，双击 install.cmd。
2. 网页创建自己的学习档案。以后通过桌面 Gongkao Coach 打开，点击“继续上次”。
3. Codex 新聊天启用“考公上岸 Coach”，从网页“档案与备份”复制 AI 聊天入口并粘贴。说“开始练习”“继续上次”“专练资料分析”。
4. 给别人发送公共 ZIP；换机时单独导出个人 .gkbackup。

包自带 Node、依赖、公共题库和题图，不需要接收者安装 Git/npm/Python/数据库。AI 教学使用桌面宿主的模型、账户和联网能力；独立网页用于训练、复盘、报告与备份。本版不含独立网页 AI API 聊天或离线大模型。

## 已实现

- 每人独立数据库，同一人可有多个考试目标；绑定、会话和作答归属检查。
- 普通单选自动正式保存，多选明确提交；同请求重试与同题位重复提交不多计。
- 训练题目与资源快照、思路草稿、暂停与重启续练；严格模拟保持固定截止时间，整卷一次判分。
- 覆盖诊断、专项、章节、20 题套题、完整整卷；库存不足不混入其他模块。
- 单一具体考点 15 题至少 9 对的基础过关；模块级标签不会被当作叶子过关。
- 关联兄弟题复习与 1/3/7/14/30 天调度；AI 错因建议与用户确认分开。
- 全程作答保留、真实 7/30 天报告、样本不足和未知速度的明确说明。
- 个人备份、恢复到新档案、旧 0.9 JSON 快照导入；升级和卸载保留个人数据。
- 只监听本机地址，网页一次性入口，公共包文件白名单与 SHA-256 校验。

个人数据默认在 %LOCALAPPDATA%/GongkaoCoach/data，独立于仓库、安装源、OneDrive 和插件缓存。同一系统账户的多档案提供逻辑隔离，需要保密时使用不同系统账户。

题库固定源 commit 71e9dd7e7bd2689014c7a8af18fdb62556a860c3，来自 yclty/gongkao。第三方导入保留来源；有些标签仍是大分类，需通过用户/AI 补充细分题目。缺图、无效答案或缺题的内容不能进入完整整卷。

## 验证与设计

- [验证报告](docs/local-plugin-verification.md)
- [目标设计与验收标准](docs/local-plugin-design.md)
- [运行时契约](references/local-runtime.md)
- [AI 教学闭环](references/pedagogy-protocol.md)
- [隐私与数据说明](PRIVACY.md)
- [试用与开发入口](LOCAL_TEST_START_HERE.md)

当前验证覆盖单机多档案、多数据目录、真实 ZIP/Windows PowerShell 5.1/Codex 安装命令、真实 stdio 客户端、本地网页、事务与重启、模拟时钟和备份恢复。详细证据与尚未覆盖的物理环境以验证报告为准；不把 CLI 安装发现等同于完整的桌面 AI 教学验收。

## 开发

需要 Node 24（发布包使用 24.19.0）与 Python：

```powershell
cd plugin-ui
npm ci --ignore-scripts
npm test
cd ..
python -X utf8 -m unittest discover -s tests -p "test_import*.py"
node scripts/check_local_source.mjs
```

先导入 gongkao 快照和离线图片，再构建：

```powershell
python -X utf8 scripts/import_gongkao_repository.py --source <gongkao快照目录> --output local-data/gongkao-question-bank.jsonl --download-assets --node <Node24路径> --source-commit <源commit>
python -X utf8 scripts/build_local_plugin.py --node <Node24路径> --node-license <对应Node版本LICENSE>
node scripts/verify_local_package.mjs dist/<完整包>.zip <codex.exe路径>
```

plugins/gongkao-coach 是便携源码；scripts/sync_local_plugin.py 同步共享参考文件与两份打包 Skill。完整包由 scripts/build_local_plugin.py 白名单组装，不能直接安装尚未包含运行时和题库的源码目录。每次正式升级递增插件与运行时版本。

原 server.js、旧 Project JSON 契约和内嵌答题卡保留为 0.9 历史兼容。正式状态以本机数据库为准，不再用总结写回。旧远端占位包不是 1.0 的完整交付方式。

软件帮助建立训练闭环，不保证录用。本版暂未实现可靠申论自动评分、后台主动督促或自动跨机器同步。
