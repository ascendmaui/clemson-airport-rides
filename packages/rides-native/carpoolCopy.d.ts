export interface LobbyStatusDetails {
  label: string;
  hint: string;
  tone: string;
}

export interface ParticipantStatusDetails {
  label: string;
  hint: string;
}

export interface SplitModeDetails {
  id: string;
  label: string;
  description: string;
}

export interface CapacityBadgeDetails {
  label: string;
  available: number;
  full: boolean;
  tone: 'warning' | 'accent' | 'info';
}

export declare const LOBBY_ACTIONS: {
  readonly CREATE_LOBBY: string;
  readonly JOIN_LOBBY: string;
  readonly INVITE_FRIENDS: string;
  readonly COPY_INVITE: string;
  readonly LINK_COPIED: string;
  readonly UPDATE_STOPS: string;
  readonly ADD_STOPS: string;
  readonly SAVE_STOPS: string;
  readonly OPTIMIZE_ROUTE: string;
  readonly CALCULATING_FARES: string;
  readonly LOCK_SEATS: string;
  readonly CONFIRM_CHARGES: string;
  readonly SETTLE_FARES: string;
  readonly LEAVE_LOBBY: string;
  readonly CANCEL_LOBBY: string;
};

export declare const LOBBY_STATUSES: Record<string, LobbyStatusDetails>;

export declare const PARTICIPANT_ROLES: {
  readonly ORGANIZER: string;
  readonly RIDER: string;
};

export declare const PARTICIPANT_STATUSES: Record<string, ParticipantStatusDetails>;

export declare const SPLIT_MODES: {
  readonly even: SplitModeDetails;
  readonly by_distance: SplitModeDetails;
};

export declare const LOBBY_BANNER_COPY: {
  readonly BEFORE_CONFIRM: string;
  readonly SPLIT_PREVIEW_TITLE: string;
  readonly SHARE_SAVINGS_EXPLAINER: string;
  readonly FIRST_RIDE_FREE_BADGE: string;
  readonly CLEMSON_STUDENT_BADGE: string;
  readonly FIRST_RIDE_ELIGIBLE_NOTE: string;
  readonly EMPTY_LOBBY_NOTE: string;
};

export declare function formatLobbyStatus(status?: string | null): LobbyStatusDetails;

export declare function formatParticipantRole(role?: string | null, isOrganizer?: boolean): string;

export declare function formatParticipantStatus(status?: string | null): ParticipantStatusDetails;

export declare function formatSplitMode(mode?: string | null): string;

export declare function isLobbyFull(current: number, max: number): boolean;

export declare function formatCapacityBadge(current: number, max: number): CapacityBadgeDetails;

export declare function formatSeatCount(current: number, max: number): string;

export declare function formatWaypointLabel(type: 'pickup' | 'dropoff', index?: number): string;

export declare function formatHopSummary(pickupLabel?: string | null, dropoffLabel?: string | null): string;
