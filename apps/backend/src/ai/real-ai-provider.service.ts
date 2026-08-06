import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChatRequest, AiProvider } from './ai-provider.service';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

interface EmbeddingsResponse {
  data?: { embedding?: unknown }[];
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number');

@Injectable()
export class RealAiProvider implements AiProvider {
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly embedModel: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('AI_BASE_URL') ?? 'http://localhost:11434';
    this.chatModel = config.get<string>('AI_MODEL') ?? 'qwen2.5:3b';
    this.embedModel = config.get<string>('AI_EMBED_MODEL') ?? 'nomic-embed-text';
  }

  async chat(request: AiChatRequest): Promise<string | null> {
    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.user },
    ];
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          temperature: 0,
          ...(request.jsonObject ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as ChatCompletionResponse;
      return body.choices?.[0]?.message?.content ?? null;
    } catch {
      return null;
    }
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embedModel, input: text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as EmbeddingsResponse;
      const embedding = body.data?.[0]?.embedding;
      return isNumberArray(embedding) ? embedding : null;
    } catch {
      return null;
    }
  }
}
