export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
};

export type AuthUserContext = {
  sub: string;
  email: string | null;
  role: string | null;
};
