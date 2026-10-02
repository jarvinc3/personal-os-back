import {
  parseGmailMessage,
  stripHtmlToText,
  type GmailMessage,
} from './gmail-api.util';

describe('stripHtmlToText', () => {
  it('drops tags, styles, and keeps visible copy', () => {
    expect(
      stripHtmlToText(
        '<html><style>body{color:red}</style><body><p>Nómina en cuenta terminada en <b>3447</b></p></body></html>',
      ),
    ).toBe('Nómina en cuenta terminada en 3447');
  });
});

describe('parseGmailMessage', () => {
  it('strips HTML when the root payload is text/html', () => {
    const html =
      '<table><tr><td>ha sido acreditado el pago de su nómina en su cuenta terminada en 3447</td></tr></table>';
    const message: GmailMessage = {
      id: 'msg-1',
      internalDate: '1757894400000',
      payload: {
        mimeType: 'text/html',
        headers: [
          { name: 'From', value: 'notificaciones@popularenlinea.com' },
          { name: 'Subject', value: 'Notificación Depósito de Nómina' },
        ],
        body: {
          data: Buffer.from(html, 'utf8').toString('base64url'),
        },
      },
    };

    const parsed = parseGmailMessage(message);
    expect(parsed.from).toBe('notificaciones@popularenlinea.com');
    expect(parsed.subject).toBe('Notificación Depósito de Nómina');
    expect(parsed.body).toContain('cuenta terminada en 3447');
    expect(parsed.body).not.toContain('<table>');
    expect(parsed.internalDate?.toISOString()).toBe(
      new Date(1757894400000).toISOString(),
    );
  });
});
