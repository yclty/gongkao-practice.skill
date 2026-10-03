# 考公上岸 Coach · 本地 Plugin 1.0.0

plugins/gongkao-coach 是当前便携 Plugin 的源码。公共依赖、Node 运行时和离线题库由 scripts/build_local_plugin.py 组装；不要把这个尚未组装的源码目录当完整安装包。

使用完整 Windows ZIP：解压后运行 install.cmd，在网页创建自己的档案，Codex 新聊天启用本地 Plugin，并粘贴网页复制的 AI 聊天入口。

网站和 AI 调用同一个本机服务。多人各自使用独立本地数据，普通作答自动保存，可暂停、重启续练、导出恢复备份。AI 教学使用宿主模型，独立网页用于训练与报告。

两份打包 Skill 从本目录同步；共享参考文件由 scripts/sync_local_plugin.py 同步。完整构建及验证说明见仓库根 README.md。
