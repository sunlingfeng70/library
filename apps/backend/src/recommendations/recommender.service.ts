import { ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';

export interface Recommendation {
  recordId: string;
  title: string;
  author: string | null;
  category: string | null;
  readingGrade: ReadingGrade | null;
  subjects: string[] | null;
  reason: string;
  score: number;
  source: 'rule' | 'ai' | 'collaborative';
}

export abstract class Recommender {
  abstract recommend(readerId: string): Promise<Recommendation[]>;
}
