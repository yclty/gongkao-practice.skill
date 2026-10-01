# 考公上岸 Coach Plugin Package

这个目录是公开 Plugin 的发布源模板。

最终用户不需要 Developer Mode，也不需要复制项目指令。发布后的目标体验是：

1. 在 Plugin Directory 安装“考公上岸 Coach”。
2. 为自己创建一个独立 ChatGPT Project（长期使用时推荐）。
3. 说“初始化我的考公系统”。
4. 之后直接说“我现在有10分钟，开始今天训练”。

## 构建

不要直接上传模板目录。

在仓库根目录运行：

```bash
MCP_URL="https://your-production-domain.example/mcp" \
DEVELOPER_NAME="你的已验证发布者名称" \
node plugin-package/build-package.mjs
```

生成：

```text
dist/gongkao-coach/
├── plugin.json
├── mcp.json
├── skills/
└── assets/
```

然后把 `dist/gongkao-coach/` 目录打成 ZIP 上传到 OpenAI Plugin submission portal。

## 发布前必须完成

- MCP 使用真实公网 HTTPS 域名
- 发布者在 OpenAI Platform 完成个人或企业验证
- `DEVELOPER_NAME` 与验证身份匹配
- MCP 域名完成 challenge 验证
- MCP tool scan 无错误
- UI CSP 与实际资源域名一致
- 5 个正向 + 3 个负向审核用例通过
- 隐私、条款、支持、网站 URL 均可公网访问
- 主图标通过审核
