export type ApiErrorKind = 'unavailable' | 'auth' | 'card' | 'server' | 'network' | 'generic'

export interface ApiErrorResult {
  kind: ApiErrorKind
  message: string
}

export declare const UNAVAILABLE_COPY: string
export declare const AUTH_REQUIRED_COPY: string
export declare const GENERIC_ERROR_COPY: string
export declare const NETWORK_ERROR_COPY: string
export declare const UNAVAILABLE_PATTERN: RegExp
export declare const ENV_VAR_PATTERN: RegExp

export declare function isUserFacing(msg: unknown): boolean

export declare function friendlyApiError(
  status?: number | string | null,
  body?: unknown
): ApiErrorResult
