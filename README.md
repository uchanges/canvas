# Infinite Canvas

面向 DEEIX 平台的无限画布前端。用户在画布中组织文本、图片、视频、音频和插件节点；登录、模型权限、项目、文件与生成任务均由 DEEIX 服务端提供。

## 核心功能

- DEEIX 登录态、云端画布项目与文件访问。
- 图片、文本、视频、音频节点的服务端模型目录与流式生成。
- 画布编排、连线、撤销重做、导入导出和远程节点插件。

## 快速开始

```bash
cd web
npm install
npm run dev
```

默认访问 `http://localhost:3000`。开发环境默认请求同源 `/api/v1`，请通过反向代理连接 DEEIX，或设置 `VITE_DEEIX_API_BASE_URL` 和 `VITE_DEEIX_LOGIN_URL`。

详细说明见 [功能介绍](docs/content/docs/overview/features.mdx)、[DEEIX 集成](docs/content/docs/development/deeix-backend-integration.mdx) 与 [部署文档](docs/content/docs/overview/docker.mdx)。
