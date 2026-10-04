export declare const DEFAULT_BASE_URL: 'https://api.customergpt.ai';
export declare const VERSION: string;

export interface CustomerGPTOptions {
  /** Workspace API key (`cgpt_...`) or OAuth access token. Defaults to CUSTOMERGPT_API_KEY. Anonymous onboarding works without one. */
  apiKey?: string;
  /** Backend origin without /api. Defaults to CUSTOMERGPT_API_URL or https://api.customergpt.ai. */
  baseUrl?: string;
  /** Per-request deadline in milliseconds. Default 180000. */
  timeoutMs?: number;
  /** Custom fetch implementation, e.g. for tests or older runtimes. */
  fetch?: typeof globalThis.fetch;
}

/** Validate a mutation without applying it. */
export interface WriteOptions { dryRun?: boolean }
export interface Pagination { page?: number; limit?: number }
export interface PollingOptions {
  /** Total wait in milliseconds. Default 900000. */
  timeoutMs?: number;
  /** Delay between status checks. Default 3000. */
  intervalMs?: number;
  onProgress?(job: Job): void;
}

export type JobStatus = 'pending' | 'running' | 'ready' | 'failed' | 'claimed';
export interface Job {
  id: string;
  status: JobStatus;
  /** Secret draft token for anonymous onboarding jobs. Never publish it. */
  token?: string;
  previewUrl?: string;
  claimUrl?: string;
  error?: string;
  [key: string]: unknown;
}

export interface Chatbot {
  id: string;
  name: string;
  websiteUrl?: string;
  welcomeMessage?: string;
  primaryColor?: string;
  quickPrompts?: string[];
  [key: string]: unknown;
}
export interface ChatbotDeletion {
  chatbotId: string;
  name: string;
  /** Knowledge sources removed (or that would be, in a dry run). */
  sources: number;
  /** Conversations removed, including leads. */
  conversations: number;
  deleted?: true;
  dryRun?: true;
}
export interface KnowledgeSource { id: string; name: string; [key: string]: unknown }
export interface Conversation { id: string; status?: 'open' | 'closed'; mode?: 'ai' | 'human'; [key: string]: unknown }

export interface ActionDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean; title: string };
  authentication: 'optional' | 'api_key';
}

export declare class CustomerGPTError extends Error {
  readonly name: 'CustomerGPTError';
  /** Server error code such as CONFIRMATION_REQUIRED, or HTTP_<status>, TIMEOUT, NETWORK_ERROR, WAIT_TIMEOUT, TRAINING_FAILED. */
  readonly code: string;
  readonly status?: number;
  readonly hint?: string;
  /** Last known job state for WAIT_TIMEOUT and TRAINING_FAILED. */
  readonly job?: Job;
  /** Server request ID (envelope `meta.requestId`, else the X-Request-Id header). Quote it to support; it is not a secret. */
  readonly requestId?: string;
}

export declare class CustomerGPT {
  constructor(options?: CustomerGPTOptions);
  readonly baseUrl: string;

  /** Execute any server action by name and return the raw envelope. */
  call<T = unknown>(action: string, input?: Record<string, unknown>): Promise<{ ok: true; data: T }>;

  readonly actions: {
    list(): Promise<ActionDefinition[]>;
    call<T = unknown>(action: string, input?: Record<string, unknown>): Promise<T>;
  };
  readonly chatbots: {
    list(params?: Pagination): Promise<unknown>;
    get(chatbotId: string): Promise<Chatbot>;
    create(params: { name: string; websiteUrl: string }, options?: WriteOptions): Promise<Chatbot>;
    update(chatbotId: string, params: { name?: string; websiteUrl?: string; welcomeMessage?: string; primaryColor?: string; quickPrompts?: string[] }, options?: WriteOptions): Promise<Chatbot>;
    /** Permanently delete a chatbot with its knowledge, conversations and leads. Refused while it is training. With `dryRun` it returns what would be removed. */
    delete(chatbotId: string, options?: WriteOptions): Promise<ChatbotDeletion>;
    installSnippet(chatbotId: string): Promise<unknown>;
  };
  readonly knowledge: {
    list(chatbotId: string, params?: Pagination): Promise<unknown>;
    /** Crawl a public website. Returns a training job; pass it to jobs.wait. */
    addWebsite(chatbotId: string, url: string, params?: { name?: string; maxPages?: number }, options?: WriteOptions): Promise<Job>;
    /** Train on exactly these pages (1–20) without following their links. Returns a training job. */
    addLinks(chatbotId: string, urls: string[], params?: { name?: string }, options?: WriteOptions): Promise<Job>;
    /** Train on pages listed in a sitemap.xml on the same site, following a sitemap index. maxPages caps it (default 5, max 20). */
    addSitemap(chatbotId: string, sitemapUrl: string, params?: { name?: string; maxPages?: number }, options?: WriteOptions): Promise<Job>;
    /**
     * Train on a .pdf, .docx, .md, .txt or .csv document up to 10 MB. The server extracts the text.
     * `data` is the file content: bytes (Uint8Array, Buffer, ArrayBuffer), a Blob/File, or a base64 string.
     */
    addFile(chatbotId: string, file: { name: string; data: Uint8Array | ArrayBuffer | Blob | string }, params?: { name?: string }, options?: WriteOptions): Promise<Job>;
    addText(chatbotId: string, params: { name: string; content: string }, options?: WriteOptions): Promise<Job>;
    resync(chatbotId: string, sourceId: string, params?: { maxPages?: number }, options?: WriteOptions): Promise<Job>;
    delete(chatbotId: string, sourceId: string, options?: WriteOptions): Promise<unknown>;
  };
  readonly messages: {
    /** Preview answer from a bot. Uses message quota. */
    send(chatbotId: string, message: string, options?: WriteOptions): Promise<unknown>;
  };
  readonly conversations: {
    list(chatbotId: string, params?: Pagination & { mode?: 'ai' | 'human'; leadsOnly?: boolean }): Promise<unknown>;
    get(chatbotId: string, conversationId: string, params?: Pagination): Promise<unknown>;
    update(chatbotId: string, conversationId: string, params: { status?: 'open' | 'closed'; mode?: 'ai' | 'human' }, options?: WriteOptions): Promise<Conversation>;
  };
  readonly leads: {
    /** Conversations that captured a lead. */
    list(chatbotId: string, params?: Pagination & { mode?: 'ai' | 'human' }): Promise<unknown>;
  };
  readonly analytics: { get(chatbotId: string): Promise<unknown> };
  readonly account: { usage(): Promise<unknown> };
  readonly jobs: {
    get(jobId: string, params?: { token?: string }): Promise<Job>;
    /** Poll until the job leaves pending/running. Throws CustomerGPTError on failure or timeout. */
    wait(job: Job, options?: PollingOptions): Promise<Job>;
  };
  readonly onboarding: {
    /** Anonymous: build a demo bot from a URL without an account. */
    start(url: string, params?: { name?: string; maxPages?: number }, options?: WriteOptions): Promise<Job>;
    preview(jobId: string, token: string, message: string): Promise<unknown>;
    /** Requires apiKey: attach a ready draft to your account. */
    claim(jobId: string, token: string, options?: WriteOptions): Promise<unknown>;
  };
}

export default CustomerGPT;
