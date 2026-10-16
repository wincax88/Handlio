# API 契约

所有路径以 `/api` 为前缀。除登录挑战、验证、健康检查、签名 Webhook 和公开帮助提交外，需要会话 Cookie。Cookie 为 HttpOnly / SameSite=Lax，生产为 Secure。浏览器修改请求必须来自 `APP_ORIGIN` 并带会话返回的 `X-CSRF-Token`。返回 `X-Request-ID`，正文默认 `Cache-Control: no-store`。

会话获取：`GET /session` 返回用户、工作区、CSRF、配置后的供应商能力及本地模式标识。工作区 ID 来自服务端会话，业务写入不会以客户端 workspaceId 作为授权。

## 身份

| 方法      | 路径                  | 输入 / 行为                                                                             |
| --------- | --------------------- | --------------------------------------------------------------------------------------- |
| POST      | `/auth/challenges`    | `email`, `purpose: owner/client/reauth`, 客户需 `publicId`, 首次客户验证需邀请 `invite` |
| POST      | `/auth/verify`        | `challengeId`, 六位 `code`, 同一 `purpose`；成功建立 Cookie 或更新近期验证时间          |
| POST      | `/auth/logout`        | 撤销本会话                                                                              |
| POST      | `/auth/logout-others` | 撤销当前用户其他会话                                                                    |
| GET/PATCH | `/settings`           | 工作区 name、timezone、supportEmail、expiryReminders                                    |

验证码 10 分钟有效、同邮箱至少间隔 60 秒、每小时最多 5 次、挑战最多错误 5 次，另有 IP 限流。新挑战使旧挑战失效；使用后不能重放。

设备维度另使用签名 `handlio_device` Cookie（HttpOnly、SameSite=Lax、生产 Secure、仅 /api/auth 路径、30 天），SQLite 只保存带密钥的摘要与风险计数。每设备每小时最多 20 次验证码请求、60 次验证请求，累计 10 次无效验证码 / 挑战触发 15 分钟冷却，跨邮箱 / IP 请求共享同一设备计数。计数与冷却跨重启保留；429 响应包含 `Retry-After` 和等待秒数。无阻断且 24 小时未活动的风险记录由维护任务清理。设备 Cookie 被清除时无法继续识别该设备，因此原邮箱和 IP 限流不被替代，不采集浏览器指纹。

## 项目、草稿与素材

| 方法      | 路径                       | 输入 / 行为                                                                                   |
| --------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| GET       | `/projects`                | 自有未删除且未过最终窗口项目，按更新时间排序                                                  |
| POST      | `/projects`                | `name`, `clientName`, `title`, `template: website/software/blank`；幂等键                     |
| GET/PATCH | `/projects/:id`            | 总览；修改 `name`, `clientName`, `lifecycle: active/archived`, `sharing`                      |
| DELETE    | `/projects/:id`            | `name` 必须准确匹配，最近 10 分钟邮箱验证；先建墓碑                                           |
| POST      | `/projects/:id/copy`       | `name`, `clientName`, `reviewed:true`；仅复制结构与文字，重核客户内容，不复制分享、权益或确认 |
| PATCH     | `/projects/:id/draft`      | `baseRevision`, 完整 `draft`；成功返回新 revision，冲突返回 409                               |
| GET       | `/projects/:id/assets`     | 自有安全资产 metadata                                                                         |
| POST      | `/projects/:id/assets`     | 已合并 PNG/JPEG/WebP 二进制；`X-Sanitized:true`；`Idempotency-Key`；最多 20 MiB               |
| GET       | `/assets/:id?release=:rid` | 私有图像逐请求鉴权；客户必须能访问引用该图的 release                                          |
| POST      | `/projects/:id/validate`   | 检查已保存修订，返回 `id`, `revision`, `blockers`, `warnings`                                 |

内容字段与长度约束以 `shared/model.ts` 的 Zod 契约为准。指南和步骤 ID 必须唯一稳定，排序与显示序号分离。每步一张图，纯文字需明确标记。发布排除内部 source note 和未纳入指南。

项目创建接受可选 `language`（规范化 BCP 47 标签）和 `timezone`（有效时区名称）；省略时使用 `en` 和工作区时区。后续通过 `PATCH /projects/:id/draft` 保存，沿用 `baseRevision` 冲突及项目权限 / 权益校验；工作区时区后续变化不改项目设置。已存旧草稿缺字段时补显示默认值 `en` / `UTC`，无需数据库列迁移。

草稿新增 `sectionTitles: {overview,checklist,support}`，标题去首尾空白后 1–120 字符；`sectionOrder` 包含上述三个固定 ID 与 `guide:<guide_id>`。固定 ID 必须各出现一次，重复或未知章节类型返回 400。指南增加 / 删除后自动补齐 / 移除指南引用，完整顺序同时决定指南编号；固定章节可放在指南之间。未纳入发布的指南及其布局引用从快照剔除。模板 / 旧内容的默认顺序为概览、指南、清单、支持。复制时指南 ID 与布局引用一并映射，恢复时沿用旧版设置创建新草稿。

语言、时区、章节标题及顺序随发布快照和 manifest hash 冻结。客户目录、正文、PDF 和离线 HTML 采用相同章节映射与日期时区；HTML `lang` 和 PDF 文档语言随快照设置，界面仍为英文，不自动翻译正文。UTC 付款 / 到期逻辑不受显示时区影响。旧发布快照不因默认展示值而改写；导出渲染键已从 `handlio-v1` 更新为 `handlio-v2`。

## 版本与客户交接

| 方法  | 路径                                       | 输入 / 行为                                                                               |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| GET   | `/projects/:id/releases`                   | Owner 历史快照和变更列表                                                                  |
| POST  | `/projects/:id/releases`                   | `draftRevision`, `validationId`, `summary`, `warningReason`；幂等键；返回 202 `jobId`     |
| POST  | `/releases/:id/restore`                    | 合法旧版复制为新草稿，不改版本号和确认                                                    |
| POST  | `/releases/:id/withdraw`                   | `reason`, `security`，最近 10 分钟重新验证                                                |
| GET   | `/projects/public/:publicId/preview`       | Owner 发布预览，不授予客户访问                                                            |
| GET   | `/projects/:id/handoff`                    | Owner 查看成员、问题、请求和通知状态                                                      |
| POST  | `/projects/:id/invites`                    | `email`, `role: Viewer/Reviewer/Confirmer`, `download`；幂等键；7 天邀请                  |
| PATCH | `/projects/:id/members/:mid`               | `role`, `download`, `status: active/removed`                                              |
| GET   | `/client/handbooks/:publicId?release=:rid` | 当前或获授权历史 release，只返回客户可见内容                                              |
| POST  | `/releases/:id/read`                       | 已验证客户前台正文可见 5 秒后，由阅读器发送；按成员、版本、日期去重                       |
| POST  | `/releases/:id/questions`                  | `body`, `stepId: string/null`, `blocking`；反馈角色；幂等键                               |
| POST  | `/questions/:id/replies`                   | `body`；Owner 或有权限的线程作者追加，不无痕改原文                                        |
| PATCH | `/questions/:id`                           | Owner `resolved` + `resolution` + 可选 `resolvedReleaseId`；作者可 `withdrawn`            |
| POST  | `/releases/:id/confirmation-requests`      | `memberIds` 1–3 个，`note`, `dueAt`；当前共享版、必需清单已完成、无阻断问题               |
| POST  | `/confirmation-requests/:id/confirm`       | `releaseId`, `manifestHash`, `acknowledgement:true`, `wordingVersion: receipt-v1`；幂等键 |
| POST  | `/confirmation-requests/:id/remind`        | 每请求最多 24 小时一次；仅未完成必需确认人                                                |

客户身份由会话获得，不能传任意 confirmedBy。确认提交在事务中再次校验当前版本、请求状态和阻断问题。新版替代未完成旧请求；旧确认继续指向旧版。分享暂停、成员移除、到期和安全撤回在新请求时立即生效。

## 任务、导出与账单

| 方法     | 路径                     | 输入 / 行为                                                                  |
| -------- | ------------------------ | ---------------------------------------------------------------------------- |
| POST     | `/projects/:id/ai-jobs`  | `stepIds` 1–20 个、`consent:true`；供应商和告知已配置；幂等键                |
| GET      | `/projects/:id/jobs`     | Owner 任务列表                                                               |
| GET      | `/jobs/:id`              | 授权任务状态、受控产物 metadata；无跨项目探测                                |
| POST     | `/jobs/:id/cancel`       | Owner 取消排队或运行任务，释放未完成预留                                     |
| POST     | `/releases/:id/exports`  | `format: pdf/html`, `paper: A4/Letter`；幂等键；返回 202 `jobId`             |
| GET      | `/jobs/:id/download`     | 每次复核版本、成员下载、期限及缓存有效期，无永久公开对象链接                 |
| DELETE   | `/jobs/:id/export`       | Owner 删除临时产物，并使其复用句柄失效                                       |
| GET      | `/billing`               | 自有订单、额度快照和权益期限                                                 |
| POST     | `/billing/checkouts`     | `projectId`, `product: project/renewal`；服务端定金额；幂等键                |
| POST     | `/webhooks/billing`      | 原始签名 JSON；事件与交易去重；权威提供商查询后才开权                        |
| POST     | `/billing/local-confirm` | 仅非生产且无真实适配器：`orderId`，本地模拟                                  |
| POST     | `/billing/local-refund`  | 同上，本地全额退款模拟                                                       |
| POST/GET | `/support`               | POST `email`, `kind: help/privacy/security/refund`, `body`；GET 自己请求状态 |
| GET      | `/ops`                   | 环境白名单及最近验证；仅诊断 metadata                                        |
| PATCH    | `/ops/requests/:id`      | 受控支持状态更新 `status`, `reason`，记录前后状态                            |

## 错误和幂等

统一错误格式：

```json
{
  "code": "DRAFT_CONFLICT",
  "safe_message": "Another window saved a newer draft. Reload and merge your changes.",
  "request_id": "uuid",
  "details": { "serverRevision": 18 }
}
```

不返回 SQL、堆栈、供应商密钥或其他客户字段。字段错误返回 `INVALID_INPUT` 和字段列表。跨租户对象统一返回 404 `ACCESS_UNAVAILABLE`；无会话为 401 `AUTH_REQUIRED`；错误码还包括 `QUOTA_EXCEEDED`, `VALIDATION_FAILED`, `VERSION_CHANGED`, `ASSET_REVOKED`, `ENTITLEMENT_EXPIRED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`。

幂等键为 `Idempotency-Key` 请求头，限定用户、动作和对象。重复同键同内容复用结果，同键不同内容返回 409。业务唯一约束同时保护交易、成员、发布号及确认人数，不仅依赖 HTTP 请求键。

## 原型补齐接口

- `PATCH /api/settings` 支持 `displayName`、`logoId`、`onboardingComplete` 及问题 / 回执 / 到期 / 营销偏好；旧账户保持原使用流程。Logo 必须来自本人工作区的已处理有效素材。
- `GET /api/workspace/assets` 返回本人工作区可选品牌素材，不公开原图或客户项目。
- `GET /api/account/sessions` 返回设备信息和当前会话标记，不返回 Cookie、会话散列或 CSRF。`DELETE /api/account/sessions/:id` 要求本人会话和近期验证。
- `GET /api/support-grants`、`POST /api/support-grants`、`DELETE /api/support-grants/:id` 管理本人限时授权。创建要求近期验证；`scope` 为 `metadata` / `sample`，`hours` 为 1 / 24。`sample` 最多 2,000 字，仅保存用户显式提供的脱敏文字。
- `POST /api/projects/:id/invites` 保留单个 `email` 契约，或接收 `emails` 数组（1–10 个，不能与 `email` 同时提交）。先验证全部邮箱，在同一事务中去重、检查容量并邀请；任一失败回滚整批；返回 `{invitations:[{id,email,localInviteUrl?}]}`。同一请求键返回原结果。
- `GET /api/billing/orders/:id` 返回本人订单、项目期限和供应商票据可用字段。`POST /api/billing/orders/:id/check` 查询权威适配器，每分钟最多一次，不根据浏览器回跳开通权益。
- `GET /api/projects/:id/jobs` 提供导出版本、格式、纸张和下载截止时间。`POST /api/jobs/:id/retry` 仅重试本人项目的失败导出 / AI 任务，要求原因并重新验证权限、修订和额度；不能重试已成功或安全撤回的内容。
- 运营白名单加近期验证：`GET /api/ops/jobs/:id`、`POST /api/ops/jobs/:id/retry`、`POST /api/ops/orders/:id/check`。修改须填审计原因。`GET /api/ops/grants/:id` 仅能读取尚未到期且未撤销的授权样例，不返回客户手册。

## 支付对账与死信恢复

运行中的服务每分钟分批检查至多 10 笔到期未决订单，首次检查要求订单创建已满 5 分钟且已存在可查询的供应商结账会话。Dodo 仅检查当前环境的会话，通用适配器不检查 Dodo 订单，本地模拟及未提交结账不进入自动对账。核验成功但仍未决的订单在 24 小时后再查；查询失败保留安全错误码，15 分钟后重试，不阻塞后续订单。计划、状态及 15 分钟运行租约写入数据库，服务重启后继续执行；主动核验的一分钟冷却仍有效。对账只查询原会话或交易，不创建结账、不主动收费。

- `GET /api/ops/webhooks/:id`：运营白名单及最近 10 分钟验证；返回事件 ID、交易引用、状态、本轮/累计尝试数、创建时间及 `retry_available_at`。不返回事件正文或供应商密钥，检查行为写入审计。
- `POST /api/ops/webhooks/:id/retry`：同样要求运营权限、近期验证和 CSRF，正文为 `{reason}`，去除首尾空白后 5–500 字符。仅允许 `dead` 事件，核对当前供应商和环境。事务内把事件重新入队，累积历史尝试数并保存前后状态、原因和操作者；返回 202 及更新后的元数据。入队不表示已开权，Worker 重新查询供应商权威交易后才更新权益。
- 同事件人工重试间隔为 15 分钟，冷却持久化；冷却内返回 429 `RATE_LIMITED`。非死信返回 409 `WEBHOOK_NOT_RETRYABLE`；环境不符返回 409 `PAYMENT_ENVIRONMENT`；通用供应商未配置返回 503 `PROVIDER_UNAVAILABLE`。
- `/api/ops` 增加 `reconciliations` 元数据，`alerts` 包括未决订单对账失败及支付死信。运营页支持检查并重试死信；正常自动重试中的事件不能被人工同时重置。

新增表通过 `CREATE TABLE IF NOT EXISTS` 兼容初始化，不修改历史订单、权益、发布快照或确认记录。对账状态随订单、重试计量随事件删除时级联清理。此实现针对现有单实例部署；生产供应商验收和外部告警仍须单独完成。

## 非支付增强接口

- 项目对象增加 `reading`（当前版本有效阅读人数／有效客户数），阅读不作为确认；筛选组合在工作台进行。
- `POST /projects/:id/copy` 接收可选 `assetIds`，仅允许原草稿引用的 ready 图片；独立复制、容量检查与项目创建处于同一事务，失败清理本次文件。
- `GET /projects/:id/assets/:assetId/edit` 返回已安全处理底图 ID 和标注配方，仅 Owner 可读。`POST /projects/:id/assets/:baseId/annotations` 接收最多 100 个框／箭头／编号／标签，返回新资产 ID；验证租户、基图状态、容量与幂等键。安全遮盖不保存在可编辑层中。
- `POST /projects/:id/check-links` 对已保存修订最多 20 个链接进行无凭据 HTTPS HEAD 检查；只固定连接到经过检查的公网 IPv4 地址，每项目间隔一分钟。受限或不确定链接不被猜测为可用。
- `GET /projects/:id/incidents` 返回事故与通知元数据。`PATCH /projects/:id/incidents/:incidentId` 需要近期验证、解决说明和复核勾选；关闭事故不会恢复共享或撤回资产。
- `GET /projects/:id/resources` 返回本人项目 AI 费用、预留、未知费用、预算、任务元数据。`PATCH /projects/:id/ai-budget` 需要近期验证、0.1–1000 USD 预算、原因和明确复核；服务级每日上限仍有效。
- `GET /service-information` 公布运营主体、实际配置的托管地区及应用清理时间，不返回密钥。缺少托管地区时显示待确认。
