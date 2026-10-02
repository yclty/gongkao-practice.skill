# 本地试用：从这里开始（1.0.0）

先使用 dist/ 下已验证的 Windows x64 ZIP。完整解压，运行 install.cmd；无需云服务器或单独安装 Node/npm/Python。

建立本地学习档案，做三题并暂停。重新打开网页点“继续上次”。在“档案与备份”复制 AI 聊天入口，在 Codex 新聊天启用考公上岸 Coach 后粘贴，即可共用正式进度。

给别人发送公共 ZIP；不要把个人 data 目录或 .gkbackup 放进去。个人数据默认在 %LOCALAPPDATA%/GongkaoCoach/data。

开发验证：

```powershell
# Node 24，依赖安装后
node plugin-ui/run-tests.js
python -X utf8 scripts/sync_local_plugin.py
python -X utf8 scripts/build_local_plugin.py --node C:/path/to/node24/node.exe --node-license C:/path/to/LICENSE.txt
node scripts/verify_local_package.mjs dist/<release>.zip C:/path/to/codex.exe
```

verify_local_package.mjs 使用临时数据目录和独立的 Codex 配置，仅注册测试副本。它检查真实 ZIP 解压、Windows PowerShell 5.1 安装、工具启动、强制重启、两个数据目录、跨入口与备份、重复安装和模拟到期。

构建使用 local-data/ 的公开题库与图片缓存。先运行 import_gongkao_repository.py --download-assets 导入 gongkao 快照，并获取对应 Node 版本 LICENSE。包只拷贝白名单文件，版本与 SHA-256 写入 release-manifest.json。

旧 local-test 下的 skills-only/HTTP 测试仅用于 0.9。不要用旧安装脚本替代当前完整包。
