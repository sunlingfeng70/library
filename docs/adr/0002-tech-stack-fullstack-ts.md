# 技术栈：全栈 TypeScript + PostgreSQL/pgvector + Ollama Provider

采用全栈 TypeScript：NestJS 业务后端 + React 管理端 + Taro 微信小程序，数据存 PostgreSQL（结构化）+ pgvector（向量检索）。AI 推理不做独立 Python 服务，而是通过可插拔的 HTTP Provider 抽象调用（默认本地 Ollama/Qwen，可选云端 API）。

v1 的 AI 能力（意图提取、检索改写、推荐生成、报表解读）全部是"调用现成模型"级别的推理，不需要训练或微调，Python 生态优势用不上。单语言单部署让私有化交付的运维面最小（客户端只需一个 Node 服务 + Postgres + Ollama）。备选方案（Python AI 微服务、独立向量库 Milvus/Qdrant）在中小馆规模下是不必要的复杂度。