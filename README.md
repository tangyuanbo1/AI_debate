<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 本地运行（已改为阿里云 DashScope：Qwen-Plus）

这是一个 **Vite + React** 的辩论竞技场应用：人类（正方）与 AI（反方）按固定回合辩论，结束后由“裁判”给出判词。

本项目已从 Google Gemini 改为 **阿里云 DashScope 通义千问（`qwen-plus`）**，并新增本地 Node 后端做转发（避免浏览器暴露 Key / 解决 CORS）。

## 运行前置

- 安装 Node.js（建议 18+）
- 你需要在阿里云 DashScope/百炼控制台申请 API Key

## 配置环境变量

在项目根目录新建 `.env`（不要提交到仓库）。仓库里提供了模板文件 `env.example` 供参考。

`.env` 内容如下：

```text
DASHSCOPE_API_KEY=你的DashScopeKey
```

可选：

```text
PORT=8787
```

## 本地启动

```bash
npm install
npm run dev
```

启动后：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8787`（仅供前端通过 `/api/*` 访问）
