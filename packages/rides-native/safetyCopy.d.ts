export declare const EMERGENCY_SOS_HEADING: string;

export declare const SOS_DISCLAIMERS: {
  readonly CONFIRM: (party?: string) => string;
  readonly ACTIVE: (party?: string) => string;
  readonly LOG_ERROR: (err?: string) => string;
};

export declare const SOS_ACTION_LABELS: {
  readonly SLIDE_TO_ACTIVATE: string;
  readonly HOLD_TO_ACTIVATE: string;
  readonly HOLDING: string;
  readonly ACTIVATING: string;
  readonly CANCEL: string;
  readonly CLOSE: string;
  readonly LOCATING: string;
  readonly GPS_UNAVAILABLE: string;
  readonly OPENING: string;
};

export declare const SAFETY_PAGE_COPY: {
  readonly TITLE: string;
  readonly SUBTITLE: string;
  readonly EMERGENCY_CONTACTS_TITLE: string;
  readonly EMERGENCY_CONTACTS_SUBTITLE: string;
  readonly SHARE_LOCATION_TITLE: string;
  readonly SHARE_LOCATION_HINT: string;
  readonly CUPD_INFO_TITLE: string;
  readonly CUPD_INFO_HINT: string;
};

export declare function resolveCounterpartParty(viewerRole?: string | null): 'rider' | 'driver';

export declare function formatSosConfirmCopy(viewerRole?: string | null): string;

export declare function formatSosActiveCopy(viewerRole?: string | null): string;

export declare function formatSosBannerTitle(
  counterpartRole?: string | null,
  channelPhrase?: string | null
): string;

export declare function formatLocationLine(lat?: number | null, lng?: number | null): string;
