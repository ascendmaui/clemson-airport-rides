export type CommunityForm = { hometown: string | null; share_hometown: boolean; greek_org: string | null; share_greek_org: boolean; major: string | null; share_major: boolean; courses: string[] | string; share_courses: boolean; grad_year: number | string | null; share_grad_year: boolean }
export type CommunityMatch = { category: string; label: string }
export const COMMUNITY_FIELDS: { key: string; share: string; label: string; placeholder: string; example: string }[]
export const COMMUNITY_PRIVACY_NOTE: string
export const EMPTY_COMMUNITY: CommunityForm
export function parseCourses(input: unknown): string[]
export function matchLines(rows: unknown): CommunityMatch[]
export function loadCommunityProfile(supabase: unknown, userId: string | null | undefined): Promise<CommunityForm>
export function saveCommunityProfile(supabase: unknown, userId: string, form: CommunityForm): Promise<unknown>
export function removeCommunityProfile(supabase: unknown, userId: string): Promise<void>
export function loadCommunityMatches(supabase: unknown, tripId: string | null | undefined): Promise<CommunityMatch[]>
