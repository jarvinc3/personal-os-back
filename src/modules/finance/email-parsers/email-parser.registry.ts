import { Injectable } from '@nestjs/common';
import { BhdEmailParser } from './bhd.parser';
import type { ParsedTransaction } from './email-parser.interface';
import { PopularEmailParser } from './popular.parser';

@Injectable()
export class EmailParserRegistry {
  private readonly parsers = [new BhdEmailParser(), new PopularEmailParser()];

  parse(from: string, subject: string, body: string): ParsedTransaction | null {
    for (const parser of this.parsers) {
      if (parser.canParse(from)) {
        const result = parser.parse(subject, body);
        if (result) return result;
      }
    }
    return null;
  }
}
