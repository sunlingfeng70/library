export interface AiChatRequest {
  system?: string;
  user: string;
  /** 对应 OpenAI 的 response_format，要求以 JSON 对象返回 */
  jsonObject?: boolean;
}

/**
 * 可插拔 AI Provider 抽象（ADR-0002）。
 *
 * 具体实现负责与大模型服务通信（本地 Ollama / 云端 API），
 * 只做「一次补全 / 一次嵌入」的传输，不包含任何业务语义。
 */
export abstract class AiProvider {
  /** 执行一次对话补全，返回原始文本；失败或不可用时返回 null（调用方自行降级） */
  abstract chat(request: AiChatRequest): Promise<string | null>;

  /** 计算文本的嵌入向量；失败或不可用时返回 null（调用方自行降级） */
  abstract embed(text: string): Promise<number[] | null>;
}
