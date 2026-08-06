import { BibliographicRecord, ReadingGrade, READING_GRADE_LABELS } from '../bibliographic-records/bibliographic-record.entity';

export interface ReaderProfile {
  readingGrades: ReadingGrade[];
  subjects: string[];
  categories: string[];
  borrowedRecordIds: string[];
}

function dedupe<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}

function overlapCount(left: string[], right: string[] | null): number {
  if (!right || right.length === 0) {
    return 0;
  }
  const values = new Set(right);
  return left.reduce((count, item) => count + (values.has(item) ? 1 : 0), 0);
}

export function buildProfile(records: BibliographicRecord[]): ReaderProfile {
  return {
    readingGrades: dedupe(records.map((record) => record.readingGrade)).filter(
      (grade): grade is ReadingGrade => grade !== null && grade !== undefined,
    ),
    subjects: dedupe(records.flatMap((record) => record.subjects ?? [])),
    categories: dedupe(records.map((record) => record.category)),
    borrowedRecordIds: dedupe(records.map((record) => record.id)),
  };
}

export function scoreRecord(profile: ReaderProfile, record: BibliographicRecord, availableRecordIds: Set<string>): number {
  const availableBonus = availableRecordIds.has(record.id) ? 3 : 0;
  const hasHistory =
    profile.readingGrades.length > 0 || profile.subjects.length > 0 || profile.categories.length > 0 || profile.borrowedRecordIds.length > 0;
  if (!hasHistory) {
    return availableBonus;
  }

  const gradeBonus = record.readingGrade && profile.readingGrades.includes(record.readingGrade) ? 20 : 0;
  const subjectBonus = overlapCount(profile.subjects, record.subjects) * 30;
  const categoryBonus = record.category && profile.categories.includes(record.category) ? 10 : 0;
  return availableBonus + gradeBonus + subjectBonus + categoryBonus;
}

export function ruleReason(
  profile: ReaderProfile,
  record: BibliographicRecord,
  readerTypeName?: string,
): string {
  if (
    profile.readingGrades.length === 0 &&
    profile.subjects.length === 0 &&
    profile.categories.length === 0 &&
    profile.borrowedRecordIds.length === 0
  ) {
    return readerTypeName ? `为「${readerTypeName}」读者精选在馆图书` : '为你精选在馆图书';
  }

  if (profile.subjects.length > 0 && overlapCount(profile.subjects, record.subjects) > 0) {
    const matchedSubject = (record.subjects ?? []).find((subject) => profile.subjects.includes(subject));
    if (matchedSubject) {
      return `你读过${profile.borrowedRecordIds.length}本${matchedSubject}相关图书，推荐同主题书目`;
    }
  }

  if (record.readingGrade && profile.readingGrades.includes(record.readingGrade)) {
    return `你常读${READING_GRADE_LABELS[record.readingGrade]}图书，推荐同年级书目`;
  }

  if (record.category && profile.categories.includes(record.category)) {
    return `你常读${record.category}类书目，推荐同类图书`;
  }

  return '基于你的借阅记录为你推荐相近书目';
}
