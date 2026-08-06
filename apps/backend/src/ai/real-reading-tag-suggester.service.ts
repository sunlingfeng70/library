import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';
import {
  ReadingTagContext,
  ReadingTagSuggestion,
  ReadingTagSuggester,
} from './reading-tag-suggester.service';

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

const GRADE_LABEL: Record<ReadingGrade, string> = {
  [ReadingGrade.PrimaryLow]: '小学低年级',
  [ReadingGrade.PrimaryHigh]: '小学高年级',
  [ReadingGrade.Middle]: '初中',
  [ReadingGrade.Senior]: '高中',
  [ReadingGrade.Adult]: '成人',
};

const GRADE_OPTIONS = Object.values(ReadingGrade)
  .map((value) => `${value}(${GRADE_LABEL[value]})`)
  .join(', ');

function buildPrompt(context: ReadingTagContext): string {
  return [
    '你是图书馆编目助手，请为图书建议结构化阅读标签。仅输出一个 JSON 对象，不要任何额外文字。',
    '字段说明：',
    `- readingGrade: 适读年级，必须在以下值中取值：${GRADE_OPTIONS}`,
    '- subjects: 1-3 个学科/主题标签（中文），如 ["数学", "科普"]',
    '',
    '图书信息：',
    `题名：${context.title}`,
    `作者：${context.author ?? '未知'}`,
    `分类：${context.category ?? '未知'}`,
  ].join('\n');
}

@Injectable()
export class RealReadingTagSuggester implements ReadingTagSuggester {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('AI_BASE_URL') ?? 'http://localhost:11434';
    this.model = config.get<string>('AI_MODEL') ?? 'qwen2.5:3b';
  }

  async suggest(context: ReadingTagContext): Promise<ReadingTagSuggestion | null> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: buildPrompt(context) }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as ChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as { readingGrade?: string; subjects?: unknown };
      const grade = this.parseGrade(parsed.readingGrade);
      const subjects = Array.isArray(parsed.subjects)
        ? parsed.subjects.filter((s): s is string => typeof s === 'string')
        : [];
      if (!grade || subjects.length === 0) {
        return null;
      }
      return { readingGrade: grade, subjects: subjects.slice(0, 3) };
    } catch {
      return null;
    }
  }

  private parseGrade(value: unknown): ReadingGrade | null {
    return Object.values(ReadingGrade).includes(value as ReadingGrade)
      ? (value as ReadingGrade)
      : null;
  }
}