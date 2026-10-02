# 本地试用：从这里开始

本目录用于 **不公开发布** 的本地试用。

当前分两层：

## A. ChatGPT Desktop：测试 Skill / 教练逻辑

### 最省事：一键安装到个人 marketplace

双击：

```text
local-test\install-personal-plugin.cmd
```

脚本会：

- 把 `plugins/gongkao-coach` 复制到 `~/.codex/plugins/gongkao-coach`
- 安全更新 `~/.agents/plugins/marketplace.json`
- 保留已有其他插件条目

然后完全退出并重新打开 ChatGPT Desktop，在 Plugins Directory 中找到 `gongkao-coach` 并安装/启用。

也可以不用脚本，直接使用下面的 repo marketplace。

这一步可以测试：

- 初始化
- Start-first 调度思路
- Project 隔离
- 暂停 / 继续语义
- 错因与复习规则
- 文字答题兜底

仓库已经提供：

```text
.agents/plugins/marketplace.json
plugins/gongkao-coach/
```

### Repo marketplace 手动方式

1. 拉取或更新仓库：

```powershell
git pull
```

2. 完全退出并重新打开 ChatGPT Desktop。

3. 打开 Plugins Directory，切换到本仓库的本地 marketplace：

```text
考公上岸 · 本地测试
```

4. 安装：

```text
考公上岸 Coach
```

5. 新建一个独立 ChatGPT Project，例如：

```text
2027 国考
```

6. 新开聊天，输入：

```text
初始化我的考公系统
```

7. 初始化后输入：

```text
开始练习
```

日常只需要记：

```text
开始练习
暂停
继续上次
专练资料分析
```

> 一个 Project 对应一套独立个人状态。不要让不同学习者长期共用同一个 Project。

---

## B. 本地 MCP：测试题库 / 工具 / UI 服务

当前 ChatGPT 本地 marketplace 本身不会自动把 `localhost` MCP 接入 ChatGPT。

因此本地 MCP 先用 MCP Inspector 验证：

1. 双击：

```text
local-test\prepare-local-runtime.cmd
```

2. 脚本会寻找 `../gongkao`；如果没有，会自动从 GitHub 拉取 `yclty/gongkao` 的题库目录并生成 canonical JSONL。

3. 双击：

```text
local-test\start-mcp.cmd
```

4. 再双击：

```text
local-test\open-mcp-inspector.cmd
```

5. Inspector 中连接：

```text
http://localhost:8787/mcp
```

建议按顺序测试：

```text
initialize_project_learning_state
plan_training_session
start_quiz_from_bank
submit_quiz_answer
pause_quiz_session
apply_project_learning_events
```

本地健康检查：

```text
http://localhost:8787/
```

---

## 当前边界

Desktop 本地 Plugin 可以直接验证 **Skill**。

MCP Inspector 可以直接验证 **MCP / QuestionProvider / state reducer**。

ChatGPT 内的可点击答题卡需要 ChatGPT 能访问 MCP Server；这不由 repo marketplace 自动提供。因此 v0.8.1 不假装“本地安装后点击卡片即可工作”。

这两个层面都稳定后，再决定是否需要为 ChatGPT UI 增加一个稳定可访问的 MCP 入口。


## C. 导出带题库的线下包

先完成题库准备，然后双击：

```text
local-test\build-offline-package.cmd
```

输出：

```text
dist\gongkao-coach-offline.zip
```

这个 ZIP 会包含生成后的 canonical 题库，可以交给另一台机器继续做本地 MCP / Inspector 测试，不需要再次下载题库源。

> ChatGPT Desktop 的 Skill-only 本地插件仍然不会自动连接 localhost MCP。要在 ChatGPT 内直接刷导入真题，需要一个 ChatGPT 可访问的 MCP 地址；这与是否公开发布 Plugin 是两回事。
