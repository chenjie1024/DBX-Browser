# 上架 DBX 官方商店

本仓库按 [DBX 官方文档「开发和提交 DBX 插件」](https://dbxio.com/cn/docs/plugin-development)
和 [t8y2/dbx-store 的 CONTRIBUTING](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md) 准备。

一句话流程：**你只发布未签名候选包 → dbx-store 开候选 PR → 维护者审核并用仓库密钥签名 → 合并进目录**。
官方私钥只存在 dbx-store 的受保护环境里，开发者永远不接触。

## 0. 本地先装上（不等上架）

未签名包默认不能装。插件中心 → 设置 → 勾选 **「允许安装未签名开发包」**，再导入
`dist/com.dbx.webview-<ver>-windows-x64.dbxp` 即可。这个开关不会放宽官方商店的校验。

## 1. 发布源码与候选 Release

```bash
# 版本号必须是没发布过的新版本，且与 manifest.json 一致
git tag v0.7.6
git push origin v0.7.6
# 在 GitHub 上基于该 Tag 创建 Release 并发布
```

Release 发布后，`.github/workflows/plugin-release.yml` 会调用
`t8y2/dbx/.github/workflows/plugin-release-reusable.yml@plugin-sdk-v1`，
按平台构建候选包并附到 Release：

- `com.dbx.webview-<ver>-windows-x64.dbxp`（**未签名**）
- `com.dbx.webview-<ver>-windows-x64.artifact.json`
- `release-candidates.json`（汇总，商店自动化读这个）

> 不要把 `dist/` 或 `.dbxp` 提交进 Git。`.gitignore` 已经排除。

## 2. 让 dbx-store 自动开候选 PR（推荐）

本仓库在 `t8y2/dbx-store` 的 `automation/plugin-sources.json` 里登记后，
后续每个版本都不需要手工提 PR。要提交的条目（本仓库 `store/plugin-source-entry.json`）：

```json
{
  "repository": "chenjie1024/DBX-Browser",
  "metadataPath": ".dbx-store.json",
  "autoUpdate": true
}
```

首次登记：Fork `t8y2/dbx-store`，把这一条加进 `automation/plugin-sources.json` 的 `plugins` 数组，
提 PR 到 `main`。

## 3. 首次上架的手工 PR（自动同步还没生效时）

Fork `t8y2/dbx-store`，向 `main` 提一个 PR，包含两个文件：

- `publishers/chen3.json` —— 只在首次上架时需要，字段恰好是 `id` / `name` / `status`：
  ```json
  { "id": "chen3", "name": "chen3", "status": "active" }
  ```
- `candidates/com.dbx.webview.json` —— 候选元数据（本仓库 `store/candidates/com.dbx.webview.json` 是现成模板）。

候选文件规则（来自 `scripts/validate.mjs`，会被 CI 逐条校验）：

| 规则 | 说明 |
|---|---|
| 必填 | `schemaVersion` / `id` / `publisher` / `version` / `targets` |
| 哈希 | `sha256` 与 `size` 绑定**未签名候选包的精确字节**，签名时不一致直接拒绝 |
| 身份一致 | 包内 `manifest.json` 的 `id`/`version`/`publisher` 必须与候选文件一致 |
| URL | 必须 HTTPS，且**不能**指向 `t8y2/dbx-store` 的 Release（那是已签名产物） |
| target | `^[a-z0-9-]+$`，本项目只有 `windows-x64`（WebView2 + CDP，仅 Windows） |
| 不可覆盖 | 已上架或已撤销的版本不能重新提交 |
| 不许夹带 | 源码目录、`.dbxp` 二进制、私钥、Token 都不要放进 PR |

`sha256` / `size` 以 Release 里 `release-candidates.json` 的值为准（CI 构建的字节才算数）：

```bash
curl -sSL https://github.com/chenjie1024/DBX-Browser/releases/download/v0.7.6/release-candidates.json
```

## 4. 审核与签名

- CI 会先**保持红色**，显示 `open candidate(s) awaiting DBX Store signing` —— 这是故意的，防止未签名内容被合并。
- 维护者在 PR 上运行受保护的 **Sign plugin PR candidates** 工作流（`/sign` 评论或手动触发）：
  拉取固定 SHA-256 的候选包 → 校验未签名且身份匹配 → 用 `DBX_STORE_SIGNING_KEY` 做 Ed25519 签名 →
  发布签名包、artifact 元数据与签名回执 → 把 `plugins/com.dbx.webview.json`、
  重新生成的 `catalog/index.json` 写回 PR 分支，并删除 `candidates/com.dbx.webview.json`。
- CI 转绿后维护者合并 PR，插件出现在商店。

## 5. 更新已有版本

1. 改代码，递增 `manifest.json` 的 `version`（**不能复用旧版本号**，资产不可覆盖）；
2. 打新 Tag、发布新 Release；
3. 已登记自动同步的仓库：等同步工作流开候选 PR 即可；否则手工提交只含**新版本**的 `candidates/<id>.json`；
4. 维护者再签名、合并。

## 常见拒绝原因

- 包内 `manifest.json` 的 `publisher` 与 `publishers/<id>.json` 不一致；
- 哈希对不上（改过包、或用本地包冒充 CI 构建产物）；
- `signingKeyId` 被自行填写（候选文件里根本不该出现这个字段）；
- 权限与实际调用不符（本项目只用 `host.storage` 与 `host.events`）。

## 本仓库的现状

| 项 | 位置 |
|---|---|
| 商店元数据（自动同步读） | `.dbx-store.json` |
| 候选元数据模板 | `store/candidates/com.dbx.webview.json` |
| 发布者记录模板 | `store/publishers/chen3.json` |
| 自动同步登记条目 | `store/plugin-source-entry.json` |
| 发布工作流 | `.github/workflows/plugin-release.yml` |
