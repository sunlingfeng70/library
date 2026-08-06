import { Injectable } from '@nestjs/common';
import { ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';
import { AiProvider } from './ai-provider.service';
import { SearchIntent, SearchIntentParser } from './search-intent-parser.service';

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

const SYSTEM_PROMPT =
  '你是图书馆检索助手。将用户的中文自然语言查询解析为结构化检索条件。' +
  '只输出一个 JSON 对象，不输出任何其他文字。字段约定：' +
  `readingGrade 取值限定为 ${GRADE_OPTIONS}；` +
  'subjects 为 0-3 个学科/主题标签数组；' +
  'title 为查询中出现的具体书名关键词，无则省略；' +
  'available 为布尔值，表示是否要求有在馆(可借)副本，未提及状态则省略。' +
  '对不确定的条件不要猜测，直接省略该字段。';

interface ParsedIntent {
  title?: unknown;
  readingGrade?: unknown;
  subjects?: unknown;
  available?: unknown;
}

@Injectable()
export class RealSearchIntentParser implements SearchIntentParser {
  constructor(private readonly provider: AiProvider) {}

  async parse(query: string): Promise<SearchIntent> {
    const content = await this.provider.chat({
      system: SYSTEM_PROMPT,
      user: `用户查询：${query}`,
      jsonObject: true,
    });
    if (!content) {
      return {};
    }
    let parsed: ParsedIntent;
    try {
      parsed = JSON.parse(content) as ParsedIntent;
    } catch {
      return {};
    }
    return {
      title:
        typeof parsed.title === 'string' && parsed.title.trim().length > 0
          ? parsed.title.trim()
          : undefined,
      readingGrade: Object.values(ReadingGrade).includes(parsed.readingGrade as ReadingGrade)
        ? (parsed.readingGrade as ReadingGrade)
        : undefined,
      subjects: Array.isArray(parsed.subjects)
        ? parsed.subjects.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 3)
        : undefined,
      available: typeof parsed.available === 'boolean' ? (parsed.available as boolean) : undefined,
    };
  }
}