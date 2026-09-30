# 3 分钟开箱使用

这套系统采用：

**公共 Skill / 题库 + 每人独立 ChatGPT Project**

不要让两个人共用同一个 Project 做长期个性化训练。

## 方式 A：推荐方式

### 第 1 步：新建 Project

在 ChatGPT 中创建一个新的 Project，例如：

`考公上岸 - 张三`

每个学习者单独创建自己的 Project。

### 第 2 步：设置 Project 指令

将仓库根目录的：

`PROJECT_INSTRUCTIONS.md`

完整复制到该 Project 的项目指令中。

### 第 3 步：初始化

新开一个聊天，复制：

`BOOTSTRAP_PROMPT.md`

填写自己知道的信息，然后发送。

初始化结束后，日常基本只需要说：

`开始今天训练`

---

## 方式 B：极简方式

如果暂时不想配置完整 Project 指令：

1. 新建个人 Project。
2. 将 `BOOTSTRAP_PROMPT.md` 整段作为第一条消息发送。
3. 开始使用。

这种方式可以快速体验，但长期使用仍推荐配置 `PROJECT_INSTRUCTIONS.md`，这样跨多个聊天更稳定。

## 日常口令

- `开始今天训练`
- `今天只有10分钟`
- `复习到期错题`
- `专练资料分析`
- `查看我的能力画像`
- `给我本周周报`
- `继续上次训练`
- `开始申论训练`

## 多用户规则

一份 GitHub Skill 可以被多人共用，但：

- 每个人必须有自己的 Project；
- 不把个人错题、能力画像提交到公共仓库；
- 公共题库通过 question_id 共享；
- 用户自己的 attempt / mastery / review 状态保持私有。

## 给朋友使用

直接把本仓库地址发给对方，并让对方从 `QUICKSTART.md` 开始即可。

对方无需 Fork 仓库，除非他想自行修改训练规则或题库工具。
