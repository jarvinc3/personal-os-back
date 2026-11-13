// Puerto y token de los productos propios que un correo puede nombrar.
// Sin Nest, Prisma ni dominio: solo la forma que cruza la frontera.
export const EMAIL_PRODUCT_HINTS = Symbol.for(
  'personal-os.contracts.email-product-hints',
);

/** Últimos 4 dígitos de los productos activos que un correo puede nombrar. */
export interface EmailProductHints {
  /** Tarjetas de crédito: solo un pago a una de ellas es `CARD_PAYMENT`. */
  readonly creditCardLast4: readonly string[];
  /** Cuentas y tarjetas de débito: el destino es un producto propio, no un pago. */
  readonly ownProductLast4: readonly string[];
}

/** Lo implementa el dueño de los productos financieros; lo consume Intelligence. */
export interface EmailProductHintsPort {
  readEmailProductHints(userId: string): Promise<EmailProductHints>;
}
