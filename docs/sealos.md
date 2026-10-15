# GitHub Actions → Sealos

目标仓库：`wincax88/Handlio`。目标命名空间：`ns-fd5llv5c`。默认 HTTPS 地址：`https://handlio-fd5llv5c.cloud.sealos.io`。

## 发布流程

`.github/workflows/sealos.yml` 在 PR 上运行测试，在 `main` push 或手动触发时运行完整发布流程：

1. Node.js 24 安装锁定依赖，构建前端，运行服务端和浏览器回归。
2. 构建 Linux amd64 Docker 镜像，发布到 `ghcr.io/wincax88/handlio:sha-<commit>`。
3. 验证生产镜像的 API、前端和中文 PDF 导出。
4. 以构建返回的 SHA-256 digest 部署到 Sealos，等待 Pod Ready 和公网 HTTPS 健康检查。

第三方 Actions 均固定到已核验的 commit SHA。PR 不会获得部署凭据，也不会发布镜像。部署串行执行，不能取消正在进行的部署。

## GitHub 配置

在仓库 Settings → Secrets and variables → Actions 中配置。部署使用 `sealos` Environment，也支持将同名 Secrets 放在该 Environment 中。

| Secret                       | 用途                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `SEALOS_KUBECONFIG`          | 原始 kubeconfig 文件内容；必须在其 context 中设置目标命名空间         |
| `SESSION_SECRET`             | 至少 32 字符的随机会话签名密钥；重新发布保持不变                      |
| `RESEND_API_KEY`             | Resend 模式必需，建议仅发送权限并限制到 handlio.cloud                 |
| `RESEND_WEBHOOK_SECRET`      | 可选，Resend Webhook 签名密钥；启用后能记录实际投递 / 退信            |
| `SMTP_HOST`                  | 实际 SMTP 主机                                                        |
| `SMTP_USER`、`SMTP_PASSWORD` | 实际 SMTP 认证；无认证邮件网关可不填                                  |
| `MAIL_FROM`                  | 已经认证的发信地址，可带显示名称                                      |
| `MAIL_AUTH_FROM`             | Resend 模式的验证码发件地址，`Handlio <auth@handlio.cloud>`           |
| `GHCR_READ_TOKEN`            | 私有 GHCR 镜像需要具有 `read:packages` 权限的长期凭据；公开镜像不需要 |

| Variable              | 默认配置                                                       |
| --------------------- | -------------------------------------------------------------- |
| `SEALOS_NAMESPACE`    | `ns-fd5llv5c`                                                  |
| `APP_ORIGIN`          | `https://handlio-fd5llv5c.cloud.sealos.io`                     |
| `SEALOS_TLS_SECRET`   | `wildcard-cloud-sealos-io-cert`，来自目标平台公开配置          |
| `SMTP_PORT`           | `587`；465 自动使用隐式 TLS                                    |
| `MAIL_PROVIDER`       | `resend`；SMTP 模式填写 `smtp`                                 |
| `MAIL_REPLY_TO`       | 确认可收信之后设置；暂未验证时留空                             |
| `MAIL_TEST_RECIPIENT` | 操作者控制的测试邮箱；当前为用户指定的 `support@handlio.cloud` |
| `SUPPORT_EMAIL`       | 真实支持邮箱                                                   |
| `OPS_EMAILS`          | 可选，运营账号邮箱逗号分隔白名单                               |

GHCR 首次发布的包默认是私有的。使用公开镜像时，需要将该包的 Package settings → Change visibility 设置为 Public；仅将源码仓库设为公开不会自动改变包的可见性。私有镜像使用 `GHCR_READ_TOKEN`，脚本会创建应用独立的镜像拉取 Secret。不能将 Actions 短期 `GITHUB_TOKEN` 作为集群长期拉取凭据。

支付与 AI 可选参数延续 `.env.example`：URL / 告知放 Variables，Token / Webhook Secret 放 Secrets。无真实适配器时，相应商业服务不可用；公网不会开放开发支付确认接口或显示开发验证码。

Dodo 正式收款使用独立 Secrets：`DODO_LIVE_API_KEY`、`DODO_LIVE_WEBHOOK_KEY`、`DODO_LIVE_PROJECT_PRODUCT_ID`、`DODO_LIVE_RENEWAL_PRODUCT_ID`。现有无 LIVE 前缀的 Dodo Secrets 继续供隔离测试实例使用。正式工作流不会回退读取测试密钥；仅在 `BILLING_PROVIDER=dodo` 和 `DODO_PAYMENTS_ENVIRONMENT=live_mode` 启用。先运行 `dodo-live-check.yml` 的 `preflight`，成功后设置这两个 Variables 并重新发布；部署前会再次检查商品与端点，部署后验证签名回调。完整步骤见 [Dodo 正式启用](providers.md#测试验收及正式启用)。

非支付增强配置：`BACKUP_KEY` 放 Secret，`BACKUP_DIRECTORY` 放 Variable，二者共同启用每日加密备份；目录应挂载独立私有存储，默认清单不会创建异地存储。`AI_MAX_STEP_COST_USD`、`AI_DAILY_BUDGET_USD` 控制美元成本上限。`OPERATOR_NAME` 默认为 Handlio Team，`OPERATOR_REGION` 默认为 Mainland China；`DATA_HOSTING_REGION` 仅填写已确认的数据地区。

缺少生产必需参数时，部署脚本会在修改集群应用前失败并给出参数名称。kubeconfig、运行时 Secret 和镜像拉取 Secret 均不进入 Git 或 Docker 构建上下文。临时文件采用私有权限，任务结束清理。不要把 kubeconfig 或 SMTP 密码放入 Issue、PR、普通 Variable 或日志。

## 资源和更新

`deploy/sealos/resources.yaml` 包含 1 个 Deployment、ClusterIP Service、TLS Ingress 和 5Gi ReadWriteOnce PVC。PVC 使用集群默认 StorageClass。当前 SQLite 与本地图片只支持单实例，使用 Recreate 策略，更新存在短暂中断。每次发布保留数据卷，不自动删除或重建 PVC，也不复制本地开发数据。

Pod 模板的发布标记包含 GitHub Run ID 和 Run Attempt。更新 Secrets 后，即使只重跑同一次发布的部署任务、镜像保持不变，也会重启 Pod 加载新配置；以部署后的支付能力与签名回调验收结果确认配置生效。

容器非 root 运行，不挂载 Kubernetes ServiceAccount Token，移除 Linux capabilities。资源请求为 100m CPU / 256Mi 内存，限制为 1 CPU / 1Gi；PDF 和图片处理共享此限制。需要提高并发时先调整资源和架构，不要直接增加副本。

应用只信任显式设置的私网代理地址（`TRUST_PROXY=uniquelocal`）。外部入口只有 Nginx Ingress，Service 保持 ClusterIP。Ingress Controller 必须正确重写来自公网的 X-Forwarded-For；不要改为信任所有代理。`/api/health` 不消耗业务 API 限流额度。

平台域名和证书来自 `https://applaunchpad.cloud.sealos.io/api/platform/getClientAppConfig`。首次上线必须实际验证域名、证书、PVC 挂载权限、验证码邮件和登录，不以清单模拟校验代替线上验证。切换自定义域名时，同时更新 `APP_ORIGIN`、TLS Secret 和 DNS。

## www.handlio.cloud 自定义域名

DNSPod 中添加 `www` 的 CNAME，目标为 `handlio-fd5llv5c.cloud.sealos.io`，默认线路、TTL 600；现有邮件记录保持原值。此方案使用 www 子域名，不要求根域名的 CNAME 展平。

`deploy/sealos/handlio-www.yaml` 定义独立的 `handlio-www` Ingress / Certificate 和命名空间内的 `handlio-public-issuer`。cert-manager 使用 Let's Encrypt HTTP-01 为 www 域名签发并续期证书；私钥由集群生成和保管。原 `handlio` Ingress 与平台通配符证书保留，用于现有正式支付回调。两个入口指向同一个生产 Service，不创建新数据库或应用副本。

初次切换先在 `ns-fd5llv5c` 应用该清单，等待 `certificate/handlio-www` Ready 并验证 www 的 HTTPS，再配置 GitHub Variables：

| Variable | 值 |
| --- | --- |
| `APP_ORIGIN` | `https://www.handlio.cloud` |
| `SEALOS_INGRESS_ORIGIN` | `https://handlio-fd5llv5c.cloud.sealos.io` |
| `SEALOS_TLS_SECRET` | `wildcard-cloud-sealos-io-cert` |
| `DODO_LIVE_WEBHOOK_ORIGIN` | `https://handlio-fd5llv5c.cloud.sealos.io` |

重新发布后，验证码链接、分享链接和结账回跳使用 `APP_ORIGIN`。正式 Dodo 后台的已验证端点继续使用平台地址；上线检查分别核对网站和回调地址的 production 身份，再向注册端点发送签名空事件。新域名需要重新登录。

生产发布会持续应用 www 域名清单；`SEALOS_INGRESS_ORIGIN` 控制原平台 Ingress 的主机名，`SEALOS_TLS_SECRET` 继续指向平台证书。隔离测试部署不包含此清单，也不读取这两个生产域名的独立配置。不要把 www 的证书替换到测试入口。

## 操作和恢复

```sh
# 重新执行测试、构建和部署
gh workflow run sealos.yml --repo wincax88/Handlio --ref main

# 查看发布与运行状态（本机显式使用自己的 kubeconfig）
gh run list --repo wincax88/Handlio --workflow sealos.yml
kubectl --kubeconfig=/path/to/kubeconfig -n ns-fd5llv5c get deployment,pod,pvc,ingress

# 手动触发容器内的在线备份；默认写入持久卷 backups 目录
kubectl --kubeconfig=/path/to/kubeconfig -n ns-fd5llv5c exec deployment/handlio -- node --import tsx server/backup.ts
```

卷内备份不等于异地备份，继续按 [部署与恢复](deployment.md) 完成独立备份与恢复演练。回退代码优先通过 Git revert + 正常发布；`kubectl rollout undo` 只回退 Pod 配置，不能回退运行时 Secret 和数据库。数据库变更之后不得未经兼容性检查回退镜像。失败部署保留现场和 PVC，流水线不会为了变绿删除数据库或自动回退数据。

官方参考：[Sealos 部署指南](https://sealos.io/blog/from-localhost-to-production-in-15-minutes-a-full-stack-cde-workflow-with-sealos-devbox/)、[GitHub 镜像发布](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)、[GHCR 权限与可见性](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。
