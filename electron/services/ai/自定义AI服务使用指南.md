# 自定义 AI 服务使用指南

自定义服务适用于 OpenAI Responses、OpenAI Compatible、Anthropic 或 Google Gemini 协议的第三方接口。请仅接入你信任的服务地址。

## 配置步骤

1. 在“服务商”中选择“自定义”。
2. 填写服务地址。
3. 选择服务商实际支持的协议。
4. 填写 API 密钥和模型名称。
5. 点击“测试连接”，成功后保存配置。

## 服务地址

服务地址应填写 API 根地址，通常包含版本路径，但不要填写具体请求端点。

例如：

- 推荐：`https://api.example.com/v1`
- 不推荐：`https://api.example.com/v1/chat/completions`
- 不推荐：`https://api.example.com/v1/responses`

CipherTalk 会根据所选协议自动补充请求端点。局域网服务可以填写类似 `http://127.0.0.1:8000/v1` 的地址。

## 协议选择

### OpenAI Responses

适用于实现 OpenAI Responses API 的服务，请确认服务端支持 `/responses` 和流式响应。

### OpenAI Compatible

适用于实现 OpenAI Chat Completions 兼容接口的服务，常见请求端点为 `/chat/completions`。大多数第三方中转服务和本地推理服务使用此协议。

### Anthropic

适用于实现 Anthropic Messages API 的服务，常见请求端点为 `/messages`，认证方式通常为 `x-api-key`。

### Google Gemini

适用于实现 Google Generative Language API 的服务。服务地址、模型名称和认证方式必须与服务商文档一致。

协议选错时，通常会出现 400、404、请求字段不支持或流式响应格式错误。

## API 密钥

- 使用服务商控制台生成的密钥。
- 不要使用来源不明的共享密钥。
- API 密钥保存在本地，请勿将配置截图或日志发送给他人。
- 本地服务明确不需要认证时，可以留空。

## 模型名称

填写服务商接口返回的模型 ID，而不是网页中的展示名称。例如：

```text
gpt-5.6-sol
deepseek-flash
qwen-plus
```

如果模型下拉列表为空，可以直接输入模型 ID。

## 常见问题

### 测试连接返回 401 或 403

检查 API 密钥是否正确、是否过期，以及账号是否有该模型的访问权限。

### 测试连接返回 404

检查服务地址是否重复包含了 `/chat/completions`、`/responses` 或其他具体端点，并确认协议选择正确。

### 返回 `Stream must be set to true`

服务端要求流式请求。请确认所选协议与服务端兼容；OpenAI Responses 服务应支持流式 Responses API。

### 模型列表加载失败

部分服务不提供模型列表接口。可以手动输入服务商文档中给出的模型 ID，然后测试连接。

### 请求超时或无法连接

检查服务地址、网络代理、防火墙和本地服务状态。局域网地址还需要确认端口可访问。

## 隐私提醒

使用第三方 AI 服务时，发送给模型的内容会经过该服务商的服务器。请先阅读服务商的隐私政策，不要向不可信服务发送聊天记录、密钥或其他敏感数据。
