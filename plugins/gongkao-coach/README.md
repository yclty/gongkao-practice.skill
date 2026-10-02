# 考公上岸 Coach · 本地 Plugin

这是仓库内用于 ChatGPT Desktop 本地 marketplace 测试的 **skills-first** 版本。

## 能测试什么

安装后可直接验证：

- “初始化我的考公系统”
- “开始练习”
- “暂停”
- “继续上次”
- “专练资料分析”
- Project 隔离规则
- Start-first 调度规则
- 错因 / SRS / 能力画像逻辑
- 没有 MCP 时的文字答题兜底

## 为什么这里没有 mcp.json

当前本地 marketplace 并不会自动把仓库里的 `localhost` MCP 暴露给 ChatGPT。

因此这个本地 Plugin 刻意保持 skills-first：

- ChatGPT Desktop：测试 Skill / 教练行为
- MCP Inspector：测试本地 MCP / QuestionProvider / reducer / UI resource

完整本地测试说明见仓库根目录：

`LOCAL_TEST_START_HERE.md`

## 同步来源

本目录下的两个 Skill 来自：

```text
plugin-package/gongkao-coach/skills/
```

修改正式 Skill 后，请运行仓库的同步检查，避免本地测试版本漂移。
