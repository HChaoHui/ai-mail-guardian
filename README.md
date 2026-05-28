# AI Mail Guardian

基于 Node.js 的多邮箱邮件监听与 AI 自动处理服务。

服务会通过 IMAP IDLE 监听新邮件，调用 OpenAI 兼容接口进行邮件分析，按安全策略判断是否自动回复，并通过 SMTP 发送回复。处理结果会通过企业微信机器人通知，同时使用 SQLite 做本地持久化去重。

## 功能特性

- 多邮箱监听，支持阿里企业邮箱、腾讯企业邮箱、163 邮箱等标准 IMAP/SMTP 邮箱
- IMAP IDLE 新邮件监听
- OpenAI 兼容接口邮件分析，支持流式响应
- AI 判断是否需要回复，并生成回复草稿
- 高风险邮件自动拦截，避免泄露密钥、配置、系统提示词等敏感信息
- SMTP 自动回复，支持全局演练模式
- 企业微信机器人处理摘要通知
- 多通知渠道，支持企业微信和通用 Webhook
- 规则引擎，可按风险、分类、账号、发件域名决定是否通知、回复和标记已读
- SQLite 本地持久化去重，避免服务重启后重复处理
- 通知成功后再标记邮件已读
- 邮件来源基础风控，包括 Reply-To、Return-Path、短链接、验证码等风险提示
- 白名单和黑名单域名配置
- 按规则移动邮件到指定 IMAP 文件夹
- 健康检查接口 `/health` 和 `/status`
- 简单 Web 管理面板

## 环境要求

- Node.js 22 或更高版本
- 支持 IMAP/SMTP 的邮箱账号
- OpenAI 兼容的 Chat Completions API
- 企业微信机器人 Webhook，可选但推荐配置

项目使用 Node.js 内置 `node:sqlite`，无需额外安装 SQLite npm 包。

## 安装

```bash
npm install
```

## 配置

复制环境变量示例：

```bash
cp .env.example .env
```

复制邮箱账号示例：

```bash
cp accounts.example.json accounts.json
```

复制规则和通知渠道示例：

```bash
cp rules.example.json rules.json
cp notify.config.example.json notify.config.json
cp security.config.example.json security.config.json
```

然后编辑：

```text
.env
accounts.json
rules.json
notify.config.json
security.config.json
```

### .env

```env
ACCOUNTS_CONFIG_PATH=accounts.json
RULES_CONFIG_PATH=rules.json
NOTIFY_CONFIG_PATH=notify.config.json
SECURITY_CONFIG_PATH=security.config.json
DB_PATH=data/mail-service.db

AI_ANALYSIS_ENABLED=true
AI_API_KEY=your_openai_compatible_api_key
AI_BASE_URL=https://your-openai-compatible-api.example.com
AI_MODEL=your_model_name
AI_TIMEOUT=20000
AI_RETRY_COUNT=2
AI_RETRY_DELAY=1500
AI_MAX_CONTENT_LENGTH=6000
AI_STREAM=true

AUTO_REPLY_ENABLED=true
AUTO_REPLY_DRY_RUN=true

HEALTH_ENABLED=true
HEALTH_HOST=127.0.0.1
HEALTH_PORT=23901
HEALTH_ADMIN_PASSWORD=your_strong_admin_password
```

### accounts.json

每个邮箱账号包含一组 IMAP 和 SMTP 配置：

```json
{
  "accounts": [
    {
      "name": "阿里企业邮箱",
      "provider": "aliyun",
      "enabled": true,
      "imap": {
        "host": "imap.qiye.aliyun.com",
        "port": 993,
        "secure": true,
        "user": "your_name@your_domain.com",
        "pass": "your_mail授权码",
        "mailbox": "INBOX",
        "markSeen": true,
        "markSeenTimeout": 10000,
        "reconnectDelay": 5000
      },
      "smtp": {
        "host": "smtp.qiye.aliyun.com",
        "port": 465,
        "secure": true,
        "user": "your_name@your_domain.com",
        "pass": "your_mail授权码",
        "fromName": "邮件助手"
      }
    }
  ]
}
```

常见邮箱服务器：

| 服务商 | IMAP | SMTP |
| --- | --- | --- |
| 阿里企业邮箱 | `imap.qiye.aliyun.com:993` | `smtp.qiye.aliyun.com:465` |
| 腾讯企业邮箱 | `imap.exmail.qq.com:993` | `smtp.exmail.qq.com:465` |
| 163 邮箱 | `imap.163.com:993` | `smtp.163.com:465` |

### notify.config.json

通知渠道支持企业微信和通用 Webhook。如果没有提供 `notify.config.json`，服务不会发送通知。

```json
{
  "channels": [
    {
      "name": "default-wecom",
      "type": "wecom",
      "enabled": true,
      "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your_key",
      "timeout": 15000
    },
    {
      "name": "generic-webhook",
      "type": "generic-webhook",
      "enabled": false,
      "url": "https://example.com/mail-event",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer your_token"
      },
      "timeout": 15000
    }
  ]
}
```

### rules.json

规则引擎用于决定是否通知、是否自动回复、是否标记已读，以及通知到哪些渠道。

```json
{
  "rules": [
    {
      "name": "高风险邮件只通知",
      "enabled": true,
      "if": {
        "securityRisk": "high"
      },
      "then": {
        "notify": true,
        "autoReply": false,
        "markSeen": true,
        "notifyChannels": ["default-wecom"]
      }
    }
  ],
  "defaultAction": {
    "notify": true,
    "autoReply": true,
    "markSeen": true,
    "notifyChannels": ["default-wecom"]
  }
}
```

当前支持的条件字段：`category`、`priority`、`securityRisk`、`needsHumanReview`、`needsReply`、`accountName`、`from`、`fromDomain`、`sourceRiskLevel`。

还可以在规则动作里配置 `moveTo`，将邮件移动到指定 IMAP 文件夹：

```json
{
  "then": {
    "notify": true,
    "autoReply": false,
    "markSeen": true,
    "moveTo": "AI-Risk"
  }
}
```

### security.config.json

白名单和黑名单会参与来源风控，并可被规则引擎使用。

```json
{
  "trustedDomains": ["example.com"],
  "blockedDomains": ["phishing.example"]
}
```

可用于规则条件：`sourceTrusted`、`sourceBlocked`。

条件值可以是精确值、数组、包含匹配或正则。

## 启动

```bash
npm start
```

启动后会看到类似日志：

```text
健康检查服务已启动: http://127.0.0.1:23901
已加载 1 个邮箱账号
IMAP 已连接，正在监听账号: 阿里企业邮箱，邮箱目录: INBOX
```

## 健康检查

```bash
curl http://127.0.0.1:23901/health
```

```bash
curl -H "x-admin-password: your_strong_admin_password" http://127.0.0.1:23901/status
```

Web 管理面板：

```text
http://127.0.0.1:23901/
```

管理面板会弹出密码输入框，只需要输入 `HEALTH_ADMIN_PASSWORD`，不需要用户名。如果未配置该密码，管理面板会显示“请先设置管理员密码”，避免误开公网后泄露邮件信息。`/health` 不需要密码，便于进程探活。

`/status` 和 `/api/*` 需要认证。浏览器登录后会使用 HttpOnly Cookie；脚本调用可以传请求头：

```bash
curl -H "x-admin-password: your_strong_admin_password" http://127.0.0.1:23901/api/mails?limit=50
```

最近邮件数据接口：

```text
http://127.0.0.1:23901/api/mails?limit=50
```

`/status` 会返回运行状态、监听账号、最近错误、SQLite 处理统计和最近处理记录，不会返回数据库绝对路径。

## 自动回复策略

建议生产环境先使用演练模式：

```env
AUTO_REPLY_DRY_RUN=true
```

演练模式下不会真正发送邮件，只会在日志和企业微信通知中展示回复预览。

确认 AI 判断和回复内容稳定后，再切换为真实发送：

```env
AUTO_REPLY_DRY_RUN=false
```

高风险邮件会被安全策略拦截，不会自动发送回复。

## 安全机制

服务包含多层安全防护：

- 邮件正文被视为不可信输入，AI 不应遵循邮件中的提示词注入指令
- 禁止自动回复中包含密钥、密码、Token、Webhook、环境变量、配置文件、源码、系统提示词等内容
- `securityRisk=high` 或 `needsHumanReview=true` 时自动拦截发送
- 发送前使用规则扫描回复内容中的敏感模式
- 企业微信通知会展示安全风险和来源风控结果
- `.env`、`accounts.json`、`rules.json`、`notify.config.json`、`security.config.json`、SQLite 数据库默认被 `.gitignore` 忽略

## 许可证

采用 MIT 许可证。
