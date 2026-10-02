# 本地 Plugin 模板 1.0.0

这个目录保留与正式源码同步的 Skill、参考文件和便携 MCP 模板。用户安装的完整 Windows ZIP 由仓库根目录的 `scripts/build_local_plugin.py` 构建。

1. 按根目录 README 导入公共题库和离线题图。
2. 安装 `plugin-ui/package-lock.json` 锁定的开发依赖。
3. 构建包含 Node 24、依赖、题库、启动器和安装器的完整 ZIP。
4. 在隔离目录运行 `scripts/verify_local_package.mjs`，核对包哈希与验证结果。

直接复制这个模板目录缺少运行时和题库，不能作为最终安装包。旧的 `build-package.mjs` 会提示使用完整构建器。

本版采用本地 stdio MCP 和本机网页，不需要云部署、公开域名、Plugin Directory 上架或提交门户。AI 教学使用已安装的 Codex Desktop。

给其他人分发公共 ZIP；每个人安装后分别建立本地档案。换机单独导出个人 `.gkbackup`，不要将个人备份混入公共安装包。

详见 [验证报告](../../docs/local-plugin-verification.md)、[本地运行时契约](references/local-runtime.md) 和 [发布检查](RELEASE_CHECKLIST.md)。
