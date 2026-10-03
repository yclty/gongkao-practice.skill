# 2024-03-30 事业单位 A/C 补题公开输入

这些文件是第三方公开回忆版的固定输入，题目及原网页内容的权利归原权利人；不将题目内容的许可等同于仓库软件许可。不标记为官方试卷或官方答案，不生成缺失解析。

- 职测 A：https://gwysydw.com/bs/sydw/news_246717.html（10 页）
- 职测 C：https://gwysydw.com/bs/sydw/news_246719.html（10 页）
- 综应 A：https://gwysydw.com/bs/sydw/news_246984.html
- 综应 C：https://gwysydw.com/bs/sydw/news_246986.html
- 职测 C 第二来源解析：https://www.kaoshiji.cn/liankaoclei/1989.html

`snapshot-manifest.json` 固定公开输入的 SHA-256；`assets-map.json` 保留图片来源。网页快照仅作离线解析输入，不在产品中执行网页脚本。`answer-keys.json` 是原答案图转录；`verified-answers.json` 记录 C 类第二来源答案和第 14 题的争议隔离。A 类保留第三方参考答案，未逐题独立校准。

`subjective-bank.jsonl` 和两份综应 Markdown 是从公开材料整理出的 17 个作答任务（其中 11 个书面任务），均为人工讲评，不接入正式自动评分及学习状态写入。材料图片随安装包离线提供。

运行仓库根目录的 `scripts/import_sydw_supplement.py --base <原题库JSONL> --output <新题库JSONL>` 可复现 200 个职测题位、199 道可交互题、30 处参考答案修正、共享材料与跨页选项，以及综应和图片打包输入。源目录保持只读；输出与源题库应使用不同文件名。
