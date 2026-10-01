export interface SystemAlertMeta {
  title: string;
  defaultBody: string;
  category: 'ride' | 'billing' | 'friends' | 'promotions' | 'system';
  level: 'info' | 'success' | 'warning' | 'error';
  tone: 'orange' | 'purple' | 'danger';
  critical: boolean;
}

export interface FormattedSystemAlert {
  kind: string;
  title: string;
  body: string;
  category: string;
  level: string;
  tone: string;
  critical: boolean;
  ariaRole: 'alert' | 'status';
  liveRegion: 'assertive' | 'polite';
}

export declare const ALERT_LEVELS: {
  readonly INFO: 'info';
  readonly SUCCESS: 'success';
  readonly WARNING: 'warning';
  readonly ERROR: 'error';
};

export declare const DND_COPY: {
  readonly TITLE: string;
  readonly DESCRIPTION: string;
};

export declare const QUIET_HOURS_COPY: {
  readonly TITLE: string;
  readonly DESCRIPTION: string;
};

export declare const SYNC_STATUS_COPY: {
  readonly SAVED_TO_ACCOUNT: string;
  readonly SAVED_ON_PHONE: string;
  readonly SAVED_ON_DEVICE: string;
};

export declare function formatSyncFeedback(
  persisted: boolean,
  softFail?: string | null,
  isMobile?: boolean
): string;

export declare const SYSTEM_ALERT_KINDS: Record<string, SystemAlertMeta>;

export declare function categoryForAlertKind(
  kind?: string | null
): 'ride' | 'billing' | 'friends' | 'promotions' | 'system';

export declare function isCriticalAlert(kind?: string | null): boolean;

export declare function toneForAlertKind(kind?: string | null): 'orange' | 'purple' | 'danger';

export declare function formatSystemAlert(
  kind: string,
  options?: { title?: string; body?: string; level?: string; force?: boolean }
): FormattedSystemAlert;
