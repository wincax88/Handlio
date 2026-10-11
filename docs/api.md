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
