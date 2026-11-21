import { requestLogPath } from './request-log';

describe('requestLogPath', () => {
  it('usa la plantilla de ruta en vez del token del enlace público', () => {
    expect(
      requestLogPath({
        baseUrl: '/api/public/receivable-shares',
        route: { path: '/:token' },
        url: '/api/public/receivable-shares/token-secreto',
      }),
    ).toBe('/api/public/receivable-shares/:token');
  });

  it('quita la query del callback OAuth', () => {
    expect(
      requestLogPath({
        url: '/api/intelligence/email/oauth/callback?code=secreto&state=secreto',
      }),
    ).toBe('/api/intelligence/email/oauth/callback');
  });

  it('enmascara el valor del parámetro cuando pino ya perdió la ruta', () => {
    expect(
      requestLogPath({
        url: '/api/public/receivable-shares/token-secreto',
        params: { token: 'token-secreto' },
      }),
    ).toBe('/api/public/receivable-shares/:token');
  });

  it('usa originalUrl sin query cuando no hay ruta emparejada', () => {
    expect(
      requestLogPath({
        originalUrl: '/api/desconocido?token=secreto',
        url: '/api/desconocido',
      }),
    ).toBe('/api/desconocido');
  });
});
