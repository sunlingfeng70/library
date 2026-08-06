import { Module } from '@nestjs/common';
import { AiProvider } from './ai-provider.service';
import { EmbeddingService } from './embedding.service';
import { ReadingTagSuggester } from './reading-tag-suggester.service';
import { RealAiProvider } from './real-ai-provider.service';
import { RealReadingTagSuggester } from './real-reading-tag-suggester.service';
import { RealSearchIntentParser } from './real-search-intent-parser.service';
import { SearchIntentParser } from './search-intent-parser.service';

@Module({
  providers: [
    { provide: AiProvider, useClass: RealAiProvider },
    { provide: SearchIntentParser, useClass: RealSearchIntentParser },
    { provide: ReadingTagSuggester, useClass: RealReadingTagSuggester },
    EmbeddingService,
  ],
  exports: [AiProvider, SearchIntentParser, ReadingTagSuggester, EmbeddingService],
})
export class AiModule {}
