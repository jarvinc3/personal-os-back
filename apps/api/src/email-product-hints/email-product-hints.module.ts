import { Global, Module } from '@nestjs/common';
import { EMAIL_PRODUCT_HINTS } from '@personal-os/contracts';
import { FinanceEmailProductHints, FinanceModule } from '@personal-os/finance';

/**
 * Intelligence clasifica correos BHD y necesita los últimos 4 de los productos
 * propios para decidir la clase del movimiento. El dueño de esos datos es
 * Finance, así que este módulo compone el puerto y lo deja disponible.
 */
@Global()
@Module({
  imports: [FinanceModule],
  providers: [
    { provide: EMAIL_PRODUCT_HINTS, useExisting: FinanceEmailProductHints },
  ],
  exports: [EMAIL_PRODUCT_HINTS],
})
export class EmailProductHintsModule {}
