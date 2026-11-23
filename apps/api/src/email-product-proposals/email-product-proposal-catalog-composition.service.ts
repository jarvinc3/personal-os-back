import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FinanceEmailProductProposalCatalog } from '@personal-os/finance';
import { EmailProductProposalCatalogRegistry } from '@personal-os/intelligence';

@Injectable()
export class EmailProductProposalCatalogCompositionService implements OnModuleInit {
  constructor(
    private readonly registry: EmailProductProposalCatalogRegistry,
    private readonly catalog: FinanceEmailProductProposalCatalog,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.catalog);
  }
}
