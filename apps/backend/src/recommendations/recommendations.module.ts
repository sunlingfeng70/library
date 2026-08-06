import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { BibliographicRecord } from '../bibliographic-records/bibliographic-record.entity';
import { Loan } from '../loans/loan.entity';
import { Reader } from '../readers/reader.entity';
import { ReaderType } from '../readers/reader-type.entity';
import { CollaborativeRecommendationSource } from './collaborative-recommendation-source.service';
import { NoopCollaborativeRecommendationSource } from './noop-collaborative-recommendation-source.service';
import { RecommendationsController } from './recommendations.controller';
import { RealRecommender } from './real-recommender.service';
import { Recommender } from './recommender.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reader, ReaderType, Loan, BibliographicRecord]), AiModule, AuthModule],
  controllers: [RecommendationsController],
  providers: [
    { provide: Recommender, useClass: RealRecommender },
    { provide: CollaborativeRecommendationSource, useClass: NoopCollaborativeRecommendationSource },
  ],
  exports: [Recommender],
})
export class RecommendationsModule {}
