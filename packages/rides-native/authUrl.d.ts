export function parseSupabaseAuthUrl(url: string | null | undefined):
  | { kind: 'session'; accessToken: string; refreshToken: string; type: string | null }
  | { kind: 'code'; code: string; type: string | null }
  | null
