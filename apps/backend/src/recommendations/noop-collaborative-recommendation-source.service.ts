import { Injectable } from '@nestjs/common';
import { CollaborativeRecommendation, CollaborativeRecommendationSource } from './collaborative-recommendation-source.service';

@Injectable()
export class NoopCollaborativeRecommendationSource extends CollaborativeRecommendationSource {
  async recommend(_readerId: string): Promise<CollaborativeRecommendation[]> {
    return [];
  }
}
