export interface LostFoundStatusDetails {
  label: string;
  hint: string;
  tone: 'orange' | 'purple' | 'success' | 'muted';
}

export declare const LOST_FOUND_HEADINGS: {
  readonly TITLE: string;
  readonly REPORT_ITEM: string;
  readonly DESCRIBE_TITLE: string;
  readonly MATCH_RIDE_TITLE: string;
  readonly SUBTITLE: string;
  readonly COMPOSE_SUBTITLE: string;
  readonly PRIVACY_NOTICE: string;
};

export declare const LOST_FOUND_EMPTY_STATE: {
  readonly TITLE: string;
  readonly BODY: string;
};

export declare const LOST_FOUND_ACTIONS: {
  readonly REPORT_ITEM: string;
  readonly PICK_FROM_HISTORY: string;
  readonly NEXT_PICK_RIDE: string;
  readonly SEND_REPORT: string;
  readonly CONFIRM_FOUND: string;
  readonly CONFIRM_NOT_FOUND: string;
  readonly MARK_RETURNED: string;
  readonly CLOSE_REPORT: string;
  readonly SEND_MESSAGE: string;
  readonly BACK_TO_LOG: string;
};

export declare const LOST_FOUND_ERRORS: {
  readonly MISSING_DESCRIPTION: string;
  readonly SELECT_COMPLETED_RIDE: string;
  readonly IMMUTABLE_REPORT: string;
  readonly NOT_PARTY: string;
  readonly ONLY_COUNTERPART_CAN_CONFIRM: string;
};

export declare const LOST_FOUND_STATUS_DETAILS: Record<string, LostFoundStatusDetails>;

export declare function formatLostFoundStatus(status?: string | null): LostFoundStatusDetails;

export declare function formatLostFoundResolution(resolution?: string | null): string;

export declare function formatItemSummary(desc?: string | null, maxLength?: number): string;
