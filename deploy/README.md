# 部署说明

## 情感语音 TTS 配置

要让情感语音播报生效，需完成以下两步。

### 1. Nginx 反向代理

将 `api` 请求转发到后端（端口 8787）。参考 `nginx-api.conf`，在网站 Nginx 配置的 `server { }` 块内加入对应 `location` 块。

**宝塔操作**：网站 → debate.phosphorusforum.com → 设置 → 配置文件 → 在 `location /` 之前粘贴 `nginx-api.conf` 内容 → 保存 → 重载配置。

### 2. 后端密钥

在服务器项目目录下，确保 `server/secrets.json` 存在且包含：

```json
{
  "DASHSCOPE_API_KEY": "你的阿里云 DashScope API Key"
}
```

（可复制 `server/secrets.example.json` 为 `secrets.json` 后填入真实 Key）

### 3. 启动后端

宝塔 Node 项目管理中，启动选项选 `server` 或 `start`，确保后端在 8787 端口运行。
