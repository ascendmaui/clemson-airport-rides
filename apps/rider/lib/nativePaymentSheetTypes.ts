export type NativeSetupSheetInput = {
  methodId: string
  clientSecret: string
  publishableKey: string
  merchantIdentifier?: string | null
  returnURL?: string | null
}

export type NativeSetupResult =
  | { ok: true }
  | { ok: false; canceled: true }
  | { ok: false; canceled?: false; unavailable?: boolean; error: string }
