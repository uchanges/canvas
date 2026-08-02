# 文档索引（AI 开发入口）

- `content/docs/development/deeix-backend-integration.mdx`：前后端边界、实际接口和部署约束。
- `content/docs/overview/features.mdx`：当前平台版可见功能。
- `content/docs/canvas/canvas-node-manual.mdx`：画布节点交互与生成约定。
- `content/docs/progress/todo.mdx`：尚未开发的事项。
- `content/docs/progress/pending-test.mdx`：已实现、等待人工验收的变更。

平台版以 DEEIX 服务端为项目、文件、模型和任务的事实源。前端不得保存上游 API Key，不得浏览器直连模型服务商；所有业务请求都应置于 `web/src/services/api/` 并请求 DEEIX API。
