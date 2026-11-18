import { detectBhdEmailProductProposal } from './email-product-proposal-detector';

const maskedIbanBody = [
  'Producto origen: DO26BCBH000000000XXXXXXX0016',
  'Producto destino: DO04BCBH000000000XXXXXXX0024',
  'Beneficiario: CTA DE AHORRO MÓVIL',
].join(' ');

describe('detectBhdEmailProductProposal', () => {
  it('detects a BHD card from its explicit transaction alert', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      body: 'BHD Notificación de Transacciones Visa Premia # 0000 Detalle de Transacciones',
      movementClass: 'PURCHASE',
      accountNumberLast4: null,
    });

    expect(proposal).toMatchObject({
      productType: 'CARD',
      name: 'Visa Premia',
      lastFour: '0000',
      network: 'VISA',
      cardType: null,
      evidence: { side: 'CARD', lastFour: '0000' },
    });
  });

  it('uses only the own source account for an outgoing transfer', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: 'Producto origen: XXXXXXX0016 Producto destino: XXXXXXX0024 Beneficiario: CTA DE AHORRO MÓVIL',
      movementClass: 'TRANSFER_OUT',
      accountNumberLast4: '0016',
    });

    expect(proposal).toMatchObject({
      productType: 'ACCOUNT',
      lastFour: '0016',
      evidence: { side: 'SOURCE', lastFour: '0016' },
    });
  });

  it('uses only the own destination account for an incoming transfer', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transferencia recibida',
      body: 'Producto origen: XXXXXXX0024 Producto destino: XXXXXXX0016',
      movementClass: 'TRANSFER_IN',
      accountNumberLast4: '0016',
    });

    expect(proposal?.lastFour).toBe('0016');
    expect(proposal?.evidence.side).toBe('DESTINATION');
  });

  it('reads the received-transfer label and ignores the sender bank', () => {
    const proposals = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Notificaciones',
      body: [
        'Has recibido una transferencia de Pago al Instante.',
        'Producto : DO26BCBHXXXXXXXXXXXXXXXX0016',
        'Banco Origen: BANCO POPULAR DOMINICANO, C. POR A.',
        'Ordenante: TITULAR DE PRUEBA',
        'Monto: RD$500.00',
      ].join(' '),
      movementClass: 'TRANSFER_IN',
      accountNumberLast4: '0016',
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      productType: 'ACCOUNT',
      lastFour: '0016',
      evidence: { label: 'Producto', side: 'DESTINATION', lastFour: '0016' },
    });
  });

  it('proposes the source account of a card payment and not the card', () => {
    const proposals = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: 'Producto origen: XXXXXXX0016 Producto destino: XXXXXXX6506 Beneficiario: VISA PREMIA',
      movementClass: 'CARD_PAYMENT',
      accountNumberLast4: '0016',
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        productType: 'ACCOUNT',
        lastFour: '0016',
        evidence: {
          label: 'Producto origen',
          side: 'SOURCE',
          lastFour: '0016',
        },
      }),
    ]);
  });

  it('does not infer which transfer side belongs to the user', () => {
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'bhd.com.do',
        subject: 'Transacciones entre mis productos',
        body: 'Producto origen: XXXXXXX0016 Producto destino: XXXXXXX0024',
        movementClass: null,
        accountNumberLast4: null,
      }),
    ).toEqual([]);
  });

  it('ignores other domains and transaction tables without the BHD alert header', () => {
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'example.com',
        subject: 'BHD Notificación de Transacciones',
        body: 'Tarjeta Visa Premia # 0000 Detalle de Transacciones',
        movementClass: 'PURCHASE',
        accountNumberLast4: null,
      }),
    ).toEqual([]);
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'bhd.com.do',
        subject: 'Estado de cuenta',
        body: 'Tarjeta Visa Premia # 0000 Detalle de Transacciones',
        movementClass: 'PURCHASE',
        accountNumberLast4: null,
      }),
    ).toEqual([]);
  });

  it('takes the trailing four digits of a masked IBAN source product', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: maskedIbanBody,
      movementClass: 'TRANSFER_OUT',
      accountNumberLast4: '0016',
    });

    expect(proposal).toMatchObject({
      productType: 'ACCOUNT',
      name: 'Cuenta BHD ****0016',
      lastFour: '0016',
      evidence: { label: 'Producto origen', side: 'SOURCE', lastFour: '0016' },
    });
  });

  it('takes the trailing four digits of a masked IBAN destination product', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: maskedIbanBody,
      movementClass: 'TRANSFER_IN',
      accountNumberLast4: '0024',
    });

    expect(proposal).toMatchObject({
      productType: 'ACCOUNT',
      name: 'Cuenta BHD ****0024',
      lastFour: '0024',
      evidence: { label: 'Producto destino', side: 'DESTINATION' },
    });
  });

  it('does not propose a token that does not match the signal account', () => {
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'bhd.com.do',
        subject: 'Transacciones entre mis productos',
        body: maskedIbanBody,
        movementClass: 'TRANSFER_OUT',
        accountNumberLast4: '0099',
      }),
    ).toEqual([]);
  });

  it('keeps the classified side when the signal has no account number', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'Transacciones entre mis productos',
      body: maskedIbanBody,
      movementClass: 'TRANSFER_OUT',
      accountNumberLast4: null,
    });

    expect(proposal).toMatchObject({ lastFour: '0016' });
  });
});
