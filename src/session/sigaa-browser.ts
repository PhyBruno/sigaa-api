import { connect } from 'puppeteer-real-browser';
import { URL } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { load as $load } from 'cheerio';
import { InstitutionType } from './sigaa-institution-controller';
import { SigaaPageIFSC } from './page/sigaa-page-ifsc';
import { SigaaPageUFPB } from './page/sigaa-page-ufpb';
import { SigaaPageUNB } from './page/sigaa-page-unb';
import { Page } from './sigaa-page';

/**
 * Error thrown when Cloudflare challenge is not resolved in time.
 * @category Public
 */
export class CloudflareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareError';
  }
}

/**
 * Error thrown when the browser is not initialized.
 * @category Public
 */
export class BrowserNotInitializedError extends Error {
  constructor() {
    super('SIGAA: Browser not initialized. Call initialize() first.');
    this.name = 'BrowserNotInitializedError';
  }
}

/**
 * Options for browser initialization.
 * @category Public
 */
export interface SigaaBrowserOptions {
  headless?: boolean;
  debug?: boolean;
  timeout?: number;
}

/**
 * Manages the lifecycle of a real browser instance using puppeteer-real-browser.
 * Provides Cloudflare bypass capability.
 * @category Internal
 */
export class SigaaBrowserImpl {
  private browser: any = null;
  private page: any = null;
  private _isInitialized = false;
  private timeout: number;
  private debug: boolean;

  constructor(private options: SigaaBrowserOptions = {}) {
    this.timeout = options.timeout ?? 30000;
    this.debug = options.debug ?? false;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Initialize the browser instance.
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    const { browser, page } = await connect({
      headless: false,
      args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
      turnstile: true,
      disableXvfb: false,
      connectOption: {
        defaultViewport: null
      }
    });

    this.browser = browser;
    this.page = page;
    this._isInitialized = true;

    if (this.debug) {
      console.log('[SigaaBrowser] Browser initialized.');
    }
  }

  /**
   * Returns the raw puppeteer page instance.
   */
  getPage(): any {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }
    return this.page;
  }

  /**
   * Navigate to a URL and return the page HTML.
   * Waits for Cloudflare challenge to resolve if present.
   */
  async navigate(url: string): Promise<string> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }

    if (this.debug) {
      console.log(`[SigaaBrowser] Navigating to: ${url}`);
    }

    await this.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: this.timeout
    });

    await this.waitForCloudflare();

    return this.page.content();
  }

  /**
   * Submit a form by injecting values into the current page's form and submitting.
   * Used for JSF form-based navigation.
   */
  async submitForm(postValues: Record<string, string>): Promise<string> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }

    if (this.debug) {
      console.log('[SigaaBrowser] Submitting form with values:', Object.keys(postValues));
    }

    const navigated = await this.page.evaluate((data: Record<string, string>) => {
      for (const [name, value] of Object.entries(data)) {
        const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
        if (input) {
          input.value = value;
        } else {
          const hidden = document.createElement('input');
          hidden.type = 'hidden';
          hidden.name = name;
          hidden.value = value;
          const form = document.querySelector('form');
          if (form) form.appendChild(hidden);
        }
      }

      const form = document.querySelector('form');
      if (!form) return false;

      try {
        form.submit();
        return true;
      } catch (e) {
        return false;
      }
    }, postValues);

    if (navigated) {
      try {
        await this.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: this.timeout
        });
      } catch (_) {
      }
    }

    await this.waitForCloudflare();
    return this.page.content();
  }

  /**
   * Get the current URL of the browser page.
   */
  async getCurrentUrl(): Promise<string> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }
    return this.page.url();
  }

  /**
   * Get the HTML content of the current browser page.
   */
  async getCurrentHtml(): Promise<string> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }
    return this.page.content();
  }

  /**
   * Build a SigaaPage from the current browser state.
   */
  async buildPageFromCurrentState(institution: InstitutionType): Promise<Page> {
    const html = await this.getCurrentHtml();
    const rawUrl = await this.getCurrentUrl();
    return this.buildSigaaPage(html, rawUrl, institution);
  }

  /**
   * Build a SigaaPage from an HTML string and URL.
   */
  buildSigaaPage(html: string, rawUrl: string, institution: InstitutionType): Page {
    const url = new URL(rawUrl);
    const fakeHttpOptions = {
      hostname: url.hostname,
      method: 'GET' as const,
      headers: {} as Record<string, string>
    };
    const SigaaPageInstitution = {
      IFSC: SigaaPageIFSC,
      UFPB: SigaaPageUFPB,
      UNB: SigaaPageUNB
    };
    return new SigaaPageInstitution[institution]({
      requestOptions: fakeHttpOptions,
      body: html,
      url,
      headers: {},
      statusCode: 200
    });
  }

  /**
   * Download a file using the browser's response interception.
   * Returns the file path after download.
   */
  async downloadFile(
    fileUrl: string,
    destPath: string,
    callback?: (downloaded: number) => void
  ): Promise<string> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }

    let filepath = destPath;
    const stats = await fs.promises.lstat(destPath);
    if (stats.isDirectory()) {
      filepath = path.join(destPath, 'download');
    }

    const client = await this.page.target().createCDPSession();
    await client.send('Fetch.enable', {
      patterns: [{ requestStage: 'Response' }]
    });

    return new Promise<string>((resolve, reject) => {
      let resolved = false;

      client.on('Fetch.requestPaused', async (event: any) => {
        try {
          const responseBody = await client.send('Fetch.getResponseBody', {
            requestId: event.requestId
          });

          await client.send('Fetch.continueRequest', {
            requestId: event.requestId
          });

          const buffer = Buffer.from(
            responseBody.body,
            responseBody.base64Encoded ? 'base64' : 'utf8'
          );

          const contentDisposition = event.responseHeaders?.find(
            (h: any) => h.name.toLowerCase() === 'content-disposition'
          );

          if (stats.isDirectory() && contentDisposition) {
            const match = contentDisposition.value.match(/filename="([^"]+)"/);
            if (match) {
              filepath = path.join(destPath, match[1]);
            }
          }

          await fs.promises.writeFile(filepath, buffer);
          if (callback) callback(buffer.length);

          if (!resolved) {
            resolved = true;
            resolve(filepath);
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        }
      });

      this.page.goto(fileUrl, { timeout: this.timeout }).catch((err: any) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  /**
   * Check if the current page has an expired session.
   */
  async checkSessionExpired(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    const html = await this.getCurrentHtml();
    const $ = $load(html);

    if (url.includes('verTelaLogin')) return true;
    if ($('input[name="user.login"]').length > 0) return true;
    if ($('.msgErros').text().includes('sessão expirou')) return true;

    return false;
  }

  /**
   * After login, SIGAA may show one or more intermediate informational pages
   * (e.g. "Aviso: Serviço Minha Biblioteca") with a "Continuar >>" button.
   * This method detects and automatically clicks through all such pages.
   * @param maxPages Maximum number of intermediate pages to skip (default: 5).
   */
  async skipIntermediatePages(maxPages = 5): Promise<void> {
    if (!this._isInitialized || !this.page) {
      throw new BrowserNotInitializedError();
    }

    for (let i = 0; i < maxPages; i++) {
      await new Promise((r) => setTimeout(r, 500));

      const continueButton = await this.page.evaluate(() => {
        const inputs = document.querySelectorAll(
          'input[type="submit"], button[type="submit"]'
        );
        for (const el of Array.from(inputs)) {
          const val =
            (el as HTMLInputElement).value ||
            (el as HTMLElement).textContent ||
            '';
          if (val.trim().toLowerCase().includes('continuar')) {
            return true;
          }
        }

        const links = document.querySelectorAll('a');
        for (const a of Array.from(links)) {
          const text = (a.textContent || '').trim().toLowerCase();
          if (text.includes('continuar')) {
            return true;
          }
        }

        return false;
      });

      if (!continueButton) {
        if (this.debug) {
          console.log(
            `[SigaaBrowser] No more "Continuar" buttons found after ${i} page(s).`
          );
        }
        return;
      }

      if (this.debug) {
        console.log(
          `[SigaaBrowser] Found "Continuar" button on intermediate page ${i + 1}, clicking...`
        );
      }

      await this.page.evaluate(() => {
        const inputs = document.querySelectorAll(
          'input[type="submit"], button[type="submit"]'
        );
        for (const el of Array.from(inputs)) {
          const val =
            (el as HTMLInputElement).value ||
            (el as HTMLElement).textContent ||
            '';
          if (val.trim().toLowerCase().includes('continuar')) {
            (el as HTMLElement).click();
            return;
          }
        }

        const links = document.querySelectorAll('a');
        for (const a of Array.from(links)) {
          const text = (a.textContent || '').trim().toLowerCase();
          if (text.includes('continuar')) {
            (a as HTMLElement).click();
            return;
          }
        }
      });

      try {
        await this.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 15000
        });
      } catch (_) {
      }

      await this.waitForCloudflare();
    }
  }

  /**
   * Wait for the Cloudflare Turnstile widget to resolve and enable the submit button.
   * SIGAA login pages have a Turnstile widget that disables the submit button until resolved.
   * This method polls until the button is no longer disabled (up to 60 seconds).
   */
  async waitForTurnstile(page: any, maxWait = 60000): Promise<void> {
    const start = Date.now();

    if (this.debug) {
      console.log('[SigaaBrowser] Waiting for Turnstile to resolve...');
    }

    while (Date.now() - start < maxWait) {
      const isEnabled = await page.evaluate(() => {
        const btn =
          document.querySelector('#btSubmit') ||
          document.querySelector('button[type="submit"]') ||
          document.querySelector('input[type="submit"]');
        if (!btn) return false;
        return !(btn as HTMLButtonElement | HTMLInputElement).disabled;
      });

      if (isEnabled) {
        if (this.debug) {
          console.log(
            `[SigaaBrowser] Turnstile resolved in ${Date.now() - start}ms.`
          );
        }
        return;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    if (this.debug) {
      console.log(
        '[SigaaBrowser] Turnstile timeout — attempting to click anyway.'
      );
    }
  }

  /**
   * Wait for Cloudflare challenge to resolve (up to 15 seconds).
   */
  private async waitForCloudflare(): Promise<void> {
    const maxWait = 15000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const title = await this.page.title();
      if (!title.includes('Just a moment')) return;
      await new Promise((r) => setTimeout(r, 500));
    }

    const title = await this.page.title();
    if (title.includes('Just a moment')) {
      throw new CloudflareError(
        'Cloudflare challenge was not resolved within 15 seconds. ' +
        'Try increasing the timeout or check if rebrowser patches are active.'
      );
    }
  }

  /**
   * Close the browser and release all resources.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this._isInitialized = false;

      if (this.debug) {
        console.log('[SigaaBrowser] Browser closed.');
      }
    }
  }
}
