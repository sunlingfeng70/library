export interface CollaborativeRecommendation {
  recordId: string;
  reason: string;
}

export abstract class CollaborativeRecommendationSource {
  abstract recommend(readerId: string): Promise<CollaborativeRecommendation[]>;
}
