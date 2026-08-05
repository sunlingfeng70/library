# Library Management — AI 原生图书管理系统

面向**学校图书馆**与**中小型公共图书馆**的 AI 原生图书管理系统，以通用产品形态交付，通过配置区分两类机构的差异。

AI 深度嵌入核心业务流（自然语言检索、个性化推荐、馆藏运营分析），同时传统图书馆功能（借还流通、书目/馆藏管理、读者管理、逾期罚款）完整可靠。

## 产品定位

- **读者**：微信小程序（主）+ 响应式 Web（辅）——自然语言找书、AI 荐书、在线借阅记录与续借、到期/催还通知订阅
- **馆员**：统一后台 Web——编目（ISBN 补全 + LLM 阅读标签建议）、流通操作、罚款处理、馆藏分析决策
- **管理员**：后台配置——机构参数、借阅规则、AI 模型与数据配置、账号与细粒度权限

## 技术栈

- **后端**：NestJS（TypeScript），PostgreSQL + pgvector（结构化 + 向量检索）
- **前端**：React 管理端、Taro 微信小程序
- **AI**：可插拔 Provider（默认本地 Ollama/Qwen，可选云端 API）；混合检索（LLM 意图提取 → 结构化过滤 + 向量语义兜底）

详见 `docs/adr/0002-tech-stack-fullstack-ts.md`。

## 仓库结构

```
├── AGENTS.md                              Agent 协作配置
├── CONTEXT.md                             领域术语表（ubiquitous language）
├── docs/
│   ├── agents/                            Agent 工程技能配置（issue tracker / triage / domain）
│   └── adr/                               Architecture Decision Records
```

## 文档

- **产品规格**：[Spec: AI 原生图书管理系统 v1](https://github.com/sunlingfeng70/library/issues/1)
- **领域术语表**：`CONTEXT.md`
- **架构决策**：`docs/adr/`（书目/馆藏分离、技术栈）

## 状态

绿地项目，处于规格与架构阶段。v1 范围已在产品规格中定义，尚未开始编码。

## 代理开发约定

参见 `AGENTS.md`：需求/缺陷以 GitHub issues 跟踪（`gh` CLI），triage 标签词汇为 `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。