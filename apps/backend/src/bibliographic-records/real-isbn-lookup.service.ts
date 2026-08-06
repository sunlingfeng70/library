import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsbnLookupResult, IsbnLookupService } from './isbn-lookup.service';

interface OpenLibraryBook {
  title?: string;
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  subjects?: { name?: string }[];
}

@Injectable()
export class RealIsbnLookupService implements IsbnLookupService {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('ISBN_LOOKUP_URL') ?? 'https://openlibrary.org/api/books';
  }

  async lookup(isbn: string): Promise<IsbnLookupResult | null> {
    const url = `${this.baseUrl}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Record<string, OpenLibraryBook>;
    const book = body[`ISBN:${isbn}`];
    if (!book) {
      return null;
    }
    return {
      ...(book.title ? { title: book.title } : {}),
      ...(book.authors?.[0]?.name ? { author: book.authors[0].name } : {}),
      ...(book.publishers?.[0]?.name ? { publisher: book.publishers[0].name } : {}),
      ...(book.subjects?.[0]?.name ? { category: book.subjects[0].name } : {}),
    };
  }
}