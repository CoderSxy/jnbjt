export type ProbeSeed = {
  title: string;
  kind: 'home' | 'category' | 'city' | 'building' | 'statue' | 'other';
};

export type ProbeConfig = {
  /** Fixed allowlisted origin, e.g. https://wiki.biligame.com */
  origin: string;
  /** Fixed MediaWiki path prefix, e.g. /jiangnan */
  wikiPath: string;
  seeds: ProbeSeed[];
  limit: number;
  userAgent: string;
  minIntervalMs: number;
  jitterMs: number;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type FieldCoverage = {
  field: string;
  present: boolean;
  notes?: string;
};

export type SamplePageReport = {
  url: string;
  title: string;
  kind: ProbeSeed['kind'];
  allowed: boolean;
  rejectReason?: string;
  pageId?: number;
  revision?: number;
  contentLength?: number;
  hasTables?: boolean;
  fieldCoverage: FieldCoverage[];
  missingFields: string[];
  applicableCities: string[];
};

export type ProbeReport = {
  generatedAt: string;
  origin: string;
  wikiPath: string;
  robotsChecked: boolean;
  robotsSummary: string;
  licenseNotes: string[];
  apiCapabilities: {
    siteinfo: boolean;
    parse: boolean;
    mediaWikiVersion?: string;
    errors: string[];
  };
  samples: SamplePageReport[];
  rejected: Array<{ url: string; reason: string }>;
  gaps: string[];
  requestCount: number;
};

export type SourceUrlCheck = {
  allowed: boolean;
  reason: string;
};
