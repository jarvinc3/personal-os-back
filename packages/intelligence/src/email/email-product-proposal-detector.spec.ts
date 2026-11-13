import { detectBhdEmailProductProposal } from './email-product-proposal-detector';

describe('detectBhdEmailProductProposal', () => {
  it('detects a BHD card from its explicit transaction alert', () => {
    const [proposal] = detectBhdEmailProductProposal({
      fromDomain: 'bhd.com.do',
      subject: 'BHD Notificación de Transacciones',
      body: 'BHD Notificación de Transacciones Visa Premia # 0000 Detalle de Transacciones',
      movementClass: 'PURCHASE',
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
    });

    expect(proposal?.lastFour).toBe('0016');
    expect(proposal?.evidence.side).toBe('DESTINATION');
  });

  it('does not infer which transfer side belongs to the user', () => {
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'bhd.com.do',
        subject: 'Transacciones entre mis productos',
        body: 'Producto origen: XXXXXXX0016 Producto destino: XXXXXXX0024',
        movementClass: null,
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
      }),
    ).toEqual([]);
    expect(
      detectBhdEmailProductProposal({
        fromDomain: 'bhd.com.do',
        subject: 'Estado de cuenta',
        body: 'Tarjeta Visa Premia # 0000 Detalle de Transacciones',
        movementClass: 'PURCHASE',
      }),
    ).toEqual([]);
  });
});
