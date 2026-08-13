import { AiService } from '../../../ai-agent';
import { FinanceModule } from '../../index';
import { AiEmailTransactionExtractor } from './ai-email-transaction.extractor';

describe('AiEmailTransactionExtractor circular barrels', () => {
  it('keeps AiService defined after FinanceModule loads ai-agent', () => {
    expect(FinanceModule).toBeDefined();
    expect(AiEmailTransactionExtractor).toBeDefined();
    expect(AiService).toBeDefined();
    expect(typeof AiService).toBe('function');
  });
});
