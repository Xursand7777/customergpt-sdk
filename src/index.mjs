export const DEFAULT_BASE_URL = 'https://api.customergpt.ai';
export const VERSION = '0.3.0';

export class CustomerGPTError extends Error {
  constructor(message, {code = 'REQUEST_FAILED', status, hint, job} = {}) {
    super(message);
    this.name = 'CustomerGPTError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (hint) this.hint = hint;
    if (job) this.job = job;
  }
}

const env = name => (typeof process !== 'undefined' && process.env ? process.env[name] : undefined);

function normalizeBase(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new CustomerGPTError('baseUrl must be an origin without /api, credentials or query parameters', {code: 'INVALID_BASE_URL'});
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new CustomerGPTError('Use HTTPS except for a local development server', {code: 'INVALID_BASE_URL'});
  return url.origin;
}

// Mutations are rejected by the server unless confirm=true; calling an SDK method is the confirmation.
const write = (input, options = {}) => options.dryRun ? {...input, dryRun: true, confirm: false} : {...input, confirm: true};
const drop = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

export class CustomerGPT {
  #baseUrl; #apiKey; #timeoutMs; #fetch;

  constructor(options = {}) {
    this.#baseUrl = normalizeBase(options.baseUrl ?? env('CUSTOMERGPT_API_URL') ?? DEFAULT_BASE_URL);
    this.#apiKey = options.apiKey ?? env('CUSTOMERGPT_API_KEY');
    this.#timeoutMs = options.timeoutMs ?? 180000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') throw new CustomerGPTError('No fetch implementation found; pass options.fetch', {code: 'NO_FETCH'});

    const call = (action, input) => this.call(action, input).then(result => result.data);
    this.actions = Object.freeze({
      list: () => this.#request('GET', '/api/v1/agents/actions').then(result => result.actions),
      call: (action, input = {}) => call(action, input),
    });
    this.chatbots = Object.freeze({
      list: (params = {}) => call('chatbots_list', drop({page: params.page, limit: params.limit})),
      get: chatbotId => call('chatbots_get', {chatbotId}),
      create: (params, options) => call('chatbots_create', write(params, options)),
      update: (chatbotId, params, options) => call('chatbots_update', write({chatbotId, ...params}, options)),
      delete: (chatbotId, options) => call('chatbots_delete', write({chatbotId}, options)),
      installSnippet: chatbotId => call('installation_snippet', {chatbotId}),
    });
    this.knowledge = Object.freeze({
      list: (chatbotId, params = {}) => call('sources_list', drop({chatbotId, page: params.page, limit: params.limit})),
      addWebsite: (chatbotId, url, params = {}, options) => call('sources_add', write(drop({chatbotId, url, name: params.name ?? new URL(url).hostname, maxPages: params.maxPages}), options)),
      addLinks: (chatbotId, urls, params = {}, options) => call('sources_add', write(drop({chatbotId, urls, name: params.name ?? (urls[0] ? new URL(urls[0]).hostname + ' links' : undefined)}), options)),
      addSitemap: (chatbotId, sitemapUrl, params = {}, options) => call('sources_add', write(drop({chatbotId, sitemapUrl, name: params.name ?? new URL(sitemapUrl).hostname + ' sitemap', maxPages: params.maxPages}), options)),
      addText: (chatbotId, params, options) => call('sources_add', write(drop({chatbotId, name: params.name, content: params.content}), options)),
      resync: (chatbotId, sourceId, params = {}, options) => call('sources_sync', write(drop({chatbotId, sourceId, maxPages: params.maxPages}), options)),
      delete: (chatbotId, sourceId, options) => call('sources_delete', write({chatbotId, sourceId}, options)),
    });
    this.messages = Object.freeze({
      send: (chatbotId, message, options) => call('messages_send', write({chatbotId, message}, options)),
    });
    this.conversations = Object.freeze({
      list: (chatbotId, params = {}) => call('conversations_list', drop({chatbotId, page: params.page, limit: params.limit, mode: params.mode, leadsOnly: params.leadsOnly})),
      get: (chatbotId, conversationId, params = {}) => call('conversations_get', drop({chatbotId, conversationId, page: params.page, limit: params.limit})),
      update: (chatbotId, conversationId, params, options) => call('conversations_update', write(drop({chatbotId, conversationId, status: params.status, mode: params.mode}), options)),
    });
    this.leads = Object.freeze({
      list: (chatbotId, params = {}) => this.conversations.list(chatbotId, {...params, leadsOnly: true}),
    });
    this.analytics = Object.freeze({
      get: chatbotId => call('analytics_get', {chatbotId}),
    });
    this.account = Object.freeze({
      usage: () => call('account_usage', {}),
    });
    this.jobs = Object.freeze({
      get: (jobId, params = {}) => call('jobs_get', drop({jobId, token: params.token})),
      wait: (job, params = {}) => this.#wait(job, params),
    });
    this.onboarding = Object.freeze({
      start: (url, params = {}, options) => call('onboarding_start', write(drop({url, name: params.name, maxPages: params.maxPages}), options)),
      preview: (jobId, token, message) => call('onboarding_preview', {jobId, token, message}),
      claim: (jobId, token, options) => call('onboarding_claim', write({jobId, token}, options)),
    });
    Object.freeze(this);
  }

  get baseUrl() { return this.#baseUrl; }

  /** Execute any server action by name and return the raw `{ok, data}` envelope. */
  call(action, input = {}) {
    if (typeof action !== 'string' || !/^[a-z_]+$/.test(action)) return Promise.reject(new CustomerGPTError('Invalid action name', {code: 'INVALID_ACTION'}));
    return this.#request('POST', '/api/v1/agents/actions/' + action, input);
  }

  async #request(method, path, body) {
    let response;
    try {
      response = await this.#fetch(this.#baseUrl + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {'Content-Type': 'application/json', 'User-Agent': 'customergpt-sdk/' + VERSION, ...(this.#apiKey ? {'X-Api-Key': this.#apiKey} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
    } catch (error) {
      throw new CustomerGPTError(error.name === 'TimeoutError' ? 'Request timed out' : 'Network error: ' + error.message, {code: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR'});
    }
    const result = await response.json().catch(() => undefined);
    if (!result) throw new CustomerGPTError('The server did not return JSON', {code: 'HTTP_' + response.status, status: response.status});
    if (!response.ok || result.ok === false) {
      throw new CustomerGPTError(result.error?.message || result.message || 'Request failed', {
        code: result.error?.code || 'HTTP_' + response.status, status: response.status,
        hint: response.status === 401 ? 'Pass apiKey or set CUSTOMERGPT_API_KEY.' : undefined,
      });
    }
    return result;
  }

  async #wait(job, {timeoutMs = 900000, intervalMs = 3000, onProgress} = {}) {
    const deadline = Date.now() + timeoutMs;
    let current = job;
    while (['pending', 'running'].includes(current.status)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new CustomerGPTError('Training still running; resume with jobs.wait and the same job', {code: 'WAIT_TIMEOUT', job: {...job, ...current}});
      await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
      current = await this.jobs.get(job.id, {token: job.token});
      onProgress?.(current);
    }
    if (current.status === 'failed') throw new CustomerGPTError(current.error || 'Training failed', {code: 'TRAINING_FAILED', job: {...job, ...current}});
    return {...job, ...current};
  }
}

export default CustomerGPT;
