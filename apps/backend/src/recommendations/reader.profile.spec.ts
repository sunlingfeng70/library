import { BibliographicRecord, ReadingGrade } from '../bibliographic-records/bibliographic-record.entity';
import { buildProfile, ruleReason, scoreRecord } from './reader.profile';

function record(values: Partial<BibliographicRecord>): BibliographicRecord {
  return {
    id: 'record-id',
    title: '示例书目',
    author: null,
    publisher: null,
    isbn: null,
    category: null,
    readingGrade: null,
    subjects: null,
    createdAt: new Date(0),
    ...values,
  };
}

describe('reader profile rules', () => {
  it('deduplicates grades, subjects, categories, and borrowed ids', () => {
    const profile = buildProfile([
      record({ id: 'one', readingGrade: ReadingGrade.Middle, subjects: ['数学', '数学'], category: '科普' }),
      record({ id: 'one', readingGrade: ReadingGrade.Middle, subjects: ['数学', '物理'], category: '科普' }),
    ]);

    expect(profile).toEqual({
      readingGrades: [ReadingGrade.Middle],
      subjects: ['数学', '物理'],
      categories: ['科普'],
      borrowedRecordIds: ['one'],
    });
  });

  it('gives the highest deterministic score to records sharing subjects', () => {
    const profile = buildProfile([
      record({ id: 'borrowed', readingGrade: ReadingGrade.Middle, subjects: ['数学'], category: '教材' }),
    ]);
    const available = new Set(['subject-match', 'grade-match', 'available-only']);

    expect(
      scoreRecord(profile, record({ id: 'subject-match', readingGrade: ReadingGrade.Middle, subjects: ['数学'] }), available),
    ).toBeGreaterThan(scoreRecord(profile, record({ id: 'grade-match', readingGrade: ReadingGrade.Middle }), available));
    expect(scoreRecord(profile, record({ id: 'available-only' }), available)).toBeGreaterThan(0);
  });

  it('explains cold-start and history-based recommendations in Chinese', () => {
    const candidate = record({ readingGrade: ReadingGrade.PrimaryLow, subjects: ['数学'] });
    expect(ruleReason(buildProfile([]), candidate)).toBe('为你精选在馆图书');
    expect(ruleReason(buildProfile([]), candidate, '学生')).toBe('为「学生」读者精选在馆图书');

    const profile = buildProfile([record({ id: 'borrowed', readingGrade: ReadingGrade.PrimaryLow, subjects: ['数学'] })]);
    expect(ruleReason(profile, candidate)).toContain('读过1本');
    expect(ruleReason(profile, candidate)).toContain('数学');
  });
});
