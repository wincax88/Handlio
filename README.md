# Handlio

基于《客户操作手册与项目交接工具 PRD V1.0》从零实现的客户交接 Web App。英文界面，内容支持 Unicode 和中文。核心路径是截图本地处理、指南编辑、手册检查、不可变版本发布、邮箱邀请、客户提问、指定版本收件确认，以及 PDF / 离线 HTML ZIP 交付。

当前可在本地运行和验证完整手工交接流程。真实邮件、支付和 AI 需要配置供应商；本地验证码和付款模拟明确标注，不产生真实收款。完整 PRD 上线门槛尚需真实供应商、独立部署、恢复演练及人工验收，详见 [需求与验收对照](docs/implementation-status.md)。

## 启动

Sealos 自动部署使用 [GitHub Actions 配置说明](docs/sealos.md)。向 `main` 推送后自动测试、构建镜像和部署；生产 Resend API Key（或 SMTP）与集群凭据必须先配置为 GitHub Secrets。

需要 Node.js 22.13 或更新版本（当前使用 Node 内置 SQLite）。

```powershell
npm ci
npm run dev
```

打开 **http://localhost:5173**。API 监听 `127.0.0.1:3001`，Vite 代理 `/api`。请使用 localhost 地址，保持与默认 `APP_ORIGIN` 一致。若改用其他域名或端口，也需要修改 `APP_ORIGIN`。

首次启动自动创建 `.data/handlio.sqlite`。数据库、处理后图片、临时导出均在 `.data/`，不会提交 Git。原始截图不进入服务端或持久浏览器缓存。

Windows 中若 npm 默认镜像不可用，可执行 `npm ci --registry=https://registry.npmjs.org`，无需修改全局配置。

## 本地体验

1. 输入邮箱，获取页面上明确标注的开发验证码并验证。Resend / SMTP 配置完成后也可使用真实验证码邮件。
2. 新建项目，选择网站、软件实施或空白模板。补充每篇指南的目标、前提、角色、完成标准和实际步骤。
3. 在 Screenshots 中选择图片、遮盖敏感区域、逐图确认，再点击上传。Guides 中填写预期结果和替代说明，逐步标记已核对。
4. Handbook 中设置介绍、支持信息、品牌和交接清单。先预览并执行发布检查。
5. Billing 中为该项目创建开发订单，点击明确标注的付款模拟，获得开发权益。Versions 中重新检查、填写摘要并发布。
6. Handoff 中开启分享、邀请另一个邮箱，选择 Viewer / Reviewer / Confirmer。使用另一个浏览器或无痕窗口验证邀请邮箱；主浏览器的 Owner 不可代客户确认。
7. 指定 1–3 位必需确认人，发起当前版本的收件请求。客户可按步骤提问，解决阻断问题后明确确认该版。
8. Exports 中下载 PDF 或完整离线 ZIP。ZIP 全部解压后打开 `index.html`，阅读不依赖网络。

免费制作限制：1 个免费草稿、3 篇指南、20 个步骤、100 MiB；付费项目基线：10 篇指南、200 个步骤、1 GiB、50 位客户、300 次成功 AI 步骤、每托管窗口 200 个新导出且每日最多 10 次。基线为 $19 / 90 天，续期 $9 / 90 天，无自动续费。

## 验证与构建

```powershell
npm run check
npm test
npm run test:ui
npm run build
npm start
```

- `npm test`：真实 SQLite / HTTP 集成测试，覆盖租户隔离、CSRF、保存冲突、图片校验、支付幂等、版本确认、安全撤回、导出与到期。
- `npm run test:ui`：完整交接、截图遮盖和原型补齐回归，包含 360px 手机阅读和完整回执。使用独立虚构邮箱、5183 / 3011 测试端口、`.work/e2e-data` 数据库和本地供应商模拟。
- PDF 和浏览器测试优先使用 `CHROMIUM_EXECUTABLE_PATH`，Windows 中也可自动找到 Edge / Chrome。其他环境执行 `npx playwright install chromium`。
- 测试截图、PDF 样例和追踪信息只放在忽略目录 `.work/` 与 `test-results/`。
- `npm start` 服务生产构建产物和 API。生产模式还需配置 HTTPS Origin、随机会话密钥和 Resend / SMTP；详见 [部署与恢复](docs/deployment.md)。

## 代码结构

```text
src/             React 工作台、截图处理、编辑器、客户阅读器
shared/model.ts  Zod 内容契约、统一容量和报价基线
server/          身份、授权、账本、任务、私有图片和导出
tests/           服务端集成与 Playwright 浏览器测试
docs/            原始 PRD、架构、接口、供应商及上线验收说明
```

图片解码在无供应商凭据的短生命周期子进程中进行，受尺寸、像素、内存、时限和并发限制保护。发布事务同时提交快照和任务完成状态；发布快照具有数据库不可变触发器。客户资源逐请求鉴权，未采用永久公开图片地址。

详细设计见 [架构](docs/architecture.md)、[API 契约](docs/api.md)、[供应商适配器](docs/providers.md)和 [实施状态](docs/implementation-status.md)。仓库原有 OpenSpec 目录和 PRD 保持可用；本次未创建待批准的 OpenSpec 变更，也未发布到外部托管平台。
