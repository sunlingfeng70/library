import { Module } from '@nestjs/common';
import { ReadingTagSuggester } from './reading-tag-suggester.service';
import { RealReadingTagSuggester } from './real-reading-tag-suggester.service';

@Module({
  providers: [{ provide: ReadingTagSuggester, useClass: RealReadingTagSuggester }],
  exports: [ReadingTagSuggester],
})
export class AiModule {}