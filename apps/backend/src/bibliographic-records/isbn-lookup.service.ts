export interface IsbnLookupResult {
  title?: string;
  author?: string;
  publisher?: string;
  category?: string;
}

export abstract class IsbnLookupService {
  abstract lookup(isbn: string): Promise<IsbnLookupResult | null>;
}
