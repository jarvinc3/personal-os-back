type GmailHeader = { name: string; value: string };

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
};

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function extractBodyFromPart(part: GmailMessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts?.length) {
    for (const child of part.parts) {
      const text = extractBodyFromPart(child);
      if (text) return text;
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, ' ');
  }
  return '';
}

export function parseGmailMessage(message: GmailMessage): {
  from: string;
  subject: string;
  body: string;
} {
  const headers = message.payload?.headers ?? [];
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';

  let body = '';
  if (message.payload?.body?.data) {
    body = decodeBase64Url(message.payload.body.data);
  } else if (message.payload?.parts?.length) {
    for (const part of message.payload.parts) {
      body = extractBodyFromPart(part);
      if (body) break;
    }
  }

  return { from, subject, body };
}

export async function listGmailMessages(
  accessToken: string,
  query: string,
  pageToken?: string,
): Promise<{ messages: { id: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: '50' });
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail list failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    messages?: { id: string }[];
    nextPageToken?: string;
  };
  return { messages: data.messages ?? [], nextPageToken: data.nextPageToken };
}

export async function getGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail get message failed (${response.status}): ${text}`);
  }

  return (await response.json()) as GmailMessage;
}

export async function exchangeGoogleAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${text}`);
  }

  return (await response.json()) as { access_token: string; expires_in: number };
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google userinfo failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { email?: string };
  if (!data.email) {
    throw new Error('Google userinfo did not return an email address');
  }
  return data.email;
}
