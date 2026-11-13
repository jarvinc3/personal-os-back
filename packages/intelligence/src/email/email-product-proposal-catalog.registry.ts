import { Injectable } from '@nestjs/common';
import type { EmailProductProposalCatalogPort } from '@personal-os/contracts';

@Injectable()
export class EmailProductProposalCatalogRegistry {
  private catalog: EmailProductProposalCatalogPort | null = null;

  register(catalog: EmailProductProposalCatalogPort): void {
    if (this.catalog && this.catalog !== catalog) {
      throw new Error('Email product proposal catalog already registered');
    }
    this.catalog = catalog;
  }

  get(): EmailProductProposalCatalogPort {
    if (!this.catalog) {
      throw new Error('Email product proposal catalog is unavailable');
    }
    return this.catalog;
  }
}
