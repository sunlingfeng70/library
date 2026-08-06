import { ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';

export interface SearchIntent {
  title?: string;
  readingGrade?: ReadingGrade;
  subjects?: string[];
  /** 是否要求有在馆副本（借阅状态：true=可借/在馆） */
  available?: boolean;
}

export abstract class SearchIntentParser {
  abstract parse(query: string): Promise<SearchIntent>;
}