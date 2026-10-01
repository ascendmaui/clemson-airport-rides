export declare const STAR_DESCRIPTORS: Record<number, string>
export declare function getStarDescriptor(stars: unknown): string

export type FeedbackTag = {
  id: string
  label: string
  icon?: string
}

export declare const RIDER_COMPLIMENTS: readonly FeedbackTag[]
export declare const DRIVER_COMPLIMENTS: readonly FeedbackTag[]
export declare const RIDER_IMPROVEMENT_TAGS: readonly FeedbackTag[]
export declare const DRIVER_IMPROVEMENT_TAGS: readonly FeedbackTag[]

export declare function getFeedbackTagsForRating(
  role?: 'rider' | 'driver',
  stars?: number
): readonly FeedbackTag[]

export declare function formatRatingDisplay(
  avg: unknown,
  count: unknown,
  options?: {
    style?: 'compact' | 'full' | 'card' | 'accessible'
    role?: 'rider' | 'driver'
  }
): string

export type StandingInfo = {
  label: string
  badgeText: string
  tone: 'neutral' | 'warn' | 'danger'
  hint: string
}

export declare const STANDING_COPY: Record<string, StandingInfo>
export declare function formatStandingBadge(standing: unknown): StandingInfo

export declare const RATING_SUBMISSION_TITLE: string
export declare const RATING_SUBMISSION_NOTE: string
export declare const RATING_ALREADY_SUBMITTED_TITLE: string
export declare const RATING_ALREADY_SUBMITTED_NOTE: string
