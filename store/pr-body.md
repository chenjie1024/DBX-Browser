首次提交 DBX 官方商店（版本 **0.7.7**）。

## 插件

- id: `com.dbx.webview`
- name: Browser
- publisher: `xingxi`
- version: `0.7.7`
- 源码: https://github.com/chenjie1024/DBX-Browser （tag `v0.7.7`）
- 许可证: MIT
- 平台: **仅 windows-x64**（sidecar 依赖 WebView2 + CDP；CI 的构建矩阵已限定为 windows-x64，Release 里只有 Windows 产物）

## 能力、权限与数据访问

- 能力：一个 workbench（阅读/浏览视图）、一个命令（打开工作台）、命令面板与工具栏菜单入口。
- 权限：仅 `host.storage`（保存站点设置、书签、本地书库索引）与 `host.events`。不申请网络、文件系统或剪贴板权限。
- 网络：由原生 sidecar 主动访问用户输入的网站（抓取正文、取图片），本地净化后交给 UI。无遥测、无自建后端、不向第三方上传数据。
- 原生 sidecar：Rust。Windows 上通过 WebView2 渲染「实时页面」并用 CDP 转发鼠标/键盘；仅在用户点击该功能时启动。
- 本地文件：用户导入的 txt 小说写入插件自己的数据目录（`DBX_PLUGIN_DATA_DIR`），不上传。

## 校验

- 候选包未签名；`sha256` = `0fc6c15ff247cdd12bb8d099073aace73faffb5118ff57074a672caec1ae9e6e`，`size` = 2783402，对应 Release 资产 `com.dbx.webview-0.7.7-windows-x64.dbxp`。
- 包内 `manifest.json` 的 id/version/publisher 与候选一致；`engines.dbx` = `>=0.7.3`。
- 无 `signingKeyId`。

如果维护者方便，也请把 `chenjie1024/DBX-Browser` 登记进 `automation/plugin-sources.json`（`autoUpdate: true`、`metadataPath: .dbx-store.json`），后续版本即可自动同步。
