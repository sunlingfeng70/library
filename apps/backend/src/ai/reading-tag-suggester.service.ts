import { ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';

export interface ReadingTagSuggestion {
  readingGrade: ReadingGrade;
  subjects: string[];
}

export interface ReadingTagContext {
  title: string;
  author?: string | null;
  category?: string | null;
}

export abstract class ReadingTagSuggester {
  abstract suggest(context: ReadingTagContext): Promise<ReadingTagSuggestion | null>;
}