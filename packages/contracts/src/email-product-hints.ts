// Puerto y token de los productos propios que un correo puede nombrar.
// Sin Nest, Prisma ni dominio: solo la forma que cruza la frontera.
export const EMAIL_PRODUCT_HINTS = Symbol.for(
  'personal-os.contracts.email-product-hints',
);

/** Últimos 4 dígitos de las tarjetas y cuentas activas del usuario. */
export interface EmailProductHints {
  readonly cardLast4: readonly string[];
  readonly accountLast4: readonly string[];
}

/** Lo implementa el dueño de los productos financieros; lo consume Intelligence. */
export interface EmailProductHintsPort {
  readEmailProductHints(userId: string): Promise<EmailProductHints>;
}
