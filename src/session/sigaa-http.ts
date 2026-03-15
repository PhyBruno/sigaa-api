import FormData from 'form-data';
import { URL } from 'url';
import { stringify } from 'querystring';
import { HTTPMethod } from '../sigaa-types';
import { HTTPSession } from './sigaa-http-session';
import { Page } from './sigaa-page';
import { SigaaBrowserImpl } from './sigaa-browser';
import { SigaaPageInstitutionMap } from './sigaa-institution-controller';
import { SigaaPageIFSC } from './page/sigaa-page-ifsc';
import { SigaaPageUFPB } from './page/sigaa-page-ufpb';
import { SigaaPageUNB } from './page/sigaa-page-unb';

/**
 * @category Public
 */
export type ProgressCallback = (
  totalSize: number,
  downloadedSize?: number
) => void;

/**
 * @category Internal
 */
export interface SigaaRequestOptions {
  mobile?: boolean;
  noCache?: boolean;
  shareSameRequest?: boolean;
}

/**
 * @category Internal
 */
export interface HTTPRequestOptions {
  hostname: string;
  method: HTTPMethod;
  headers: Record<string, string>;
  path?: string;
  port?: number;
}

/**
 * @category Internal
 * @instance
 */
export interface HTTP {
  /**
   * Make a POST multipart request
   * @param path The path of request or full URL
   * @param formData instance of FormData
   */
  postMultipart(
    path: string,
    formData: FormData,
    options?: SigaaRequestOptions
  ): Promise<Page>;

  /**
   * Make a POST request
   * @param path The path of request or full URL
   * @param postValues Post values in format, key as field name, and value as field value.
   */
  post(
    path: string,
    postValues: Record<string, string>,
    options?: SigaaRequestOptions
  ): Promise<Page>;

  /**
   * Make a GET request
   * @param path The path of request or full URL
   */
  get(path: string, options?: SigaaRequestOptions): Promise<Page>;

  /**
   * Download a file via GET
   */
  downloadFileByGet(
    urlPath: string,
    destpath: string,
    callback?: ProgressCallback
  ): Promise<string>;

  /**
   * Download a file via POST
   */
  downloadFileByPost(
    urlPath: string,
    postValues: Record<string, string>,
    basepath: string,
    callback?: ProgressCallback
  ): Promise<string>;

  /**
   * Follow the redirect while the page response redirects to another page.
   * In the browser implementation, redirects are followed automatically,
   * so this is effectively a no-op.
   */
  followAllRedirect(page: Page, options?: SigaaRequestOptions): Promise<Page>;

  /**
   * Close http session
   */
  closeSession(): void;
}

/**
 * HTTP request class backed by a real browser via puppeteer-real-browser.
 * Replaces the previous axios/https implementation to bypass Cloudflare.
 * @category Internal
 */
export class SigaaHTTP implements HTTP {
  constructor(
    private httpSession: HTTPSession,
    private sigaaBrowser?: SigaaBrowserImpl
  ) {}

  /**
   * Returns the browser instance, throwing if not configured.
   */
  private getBrowser(): SigaaBrowserImpl {
    if (!this.sigaaBrowser) {
      throw new Error(
        'SIGAA: No browser instance configured. Pass a SigaaBrowserImpl to SigaaHTTP.'
      );
    }
    return this.sigaaBrowser;
  }

  /**
   * Build a fake HTTPRequestOptions object for a given URL and method.
   * Used to maintain compatibility with the HTTPSession interface.
   */
  private makeHttpOptions(
    method: HTTPMethod,
    url: URL,
    additionalHeaders: Record<string, string> = {}
  ): HTTPRequestOptions {
    return {
      hostname: url.hostname,
      method,
      headers: additionalHeaders,
      path: url.pathname + url.search,
      port: url.port ? parseInt(url.port) : 443
    };
  }

  /**
   * Build a SigaaPage from HTML + URL for the current institution.
   */
  private buildSigaaPage(html: string, url: URL, requestBody?: string | Buffer): Page {
    const institution = this.httpSession.institutionController.institution;
    const httpOptions = this.makeHttpOptions('GET', url);
    const SigaaPageInstitution: SigaaPageInstitutionMap = {
      IFSC: SigaaPageIFSC,
      UFPB: SigaaPageUFPB,
      UNB: SigaaPageUNB
    };
    return new SigaaPageInstitution[institution]({
      requestOptions: httpOptions,
      body: html,
      url,
      headers: {},
      statusCode: 200,
      requestBody
    });
  }

  /**
   * Core request handler using the browser. Manages the request queue,
   * cache checks, and page construction.
   */
  private async requestPage(
    url: URL,
    httpOptions: HTTPRequestOptions,
    requestBody?: string | Buffer,
    options?: SigaaRequestOptions
  ): Promise<Page> {
    try {
      const sessionHttpOptions = await this.httpSession.afterHTTPOptions(
        url,
        httpOptions,
        requestBody,
        options
      );

      const pageBeforeRequest = await this.httpSession.beforeRequest(
        url,
        sessionHttpOptions,
        requestBody,
        options
      );

      if (pageBeforeRequest) {
        return this.httpSession.afterSuccessfulRequest(pageBeforeRequest, options);
      }

      let html: string;
      if (httpOptions.method === 'GET') {
        html = await this.getBrowser().navigate(url.href);
      } else {
        const postValues = requestBody
          ? this.parseBodyToRecord(requestBody.toString())
          : {};
        html = await this.getBrowser().submitForm(postValues, url.href);
      }

      const currentUrl = await this.getBrowser().getCurrentUrl();
      const finalUrl = new URL(currentUrl);
      const page = this.buildSigaaPage(html, finalUrl, requestBody);

      return this.httpSession.afterSuccessfulRequest(page, options);
    } catch (err) {
      return this.httpSession.afterUnsuccessfulRequest(
        err as Error,
        httpOptions,
        requestBody
      );
    }
  }

  /**
   * Parse a URL-encoded body string back into a key-value record.
   */
  private parseBodyToRecord(body: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of body.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        result[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
    return result;
  }

  /**
   * RFC 3986 encoding for form values.
   */
  private encodeWithRFC3986(str: string): string {
    let escapedString = '';
    const unreservedCharacters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~';
    for (let i = 0; i < str.length; i++) {
      if (unreservedCharacters.includes(str.charAt(i))) {
        escapedString += str.charAt(i);
      } else {
        const codePoint = str.codePointAt(i);
        if (codePoint === undefined)
          throw new Error('SIGAA: Invalid code point.');
        escapedString += codePoint.toString(16).replace(/..?/g, '%$&');
      }
    }
    return escapedString;
  }

  /**
   * @inheritdoc
   */
  public async get(path: string, options?: SigaaRequestOptions): Promise<Page> {
    const url = this.httpSession.getURL(path);
    const httpOptions = this.makeHttpOptions('GET', url);
    return this.requestPage(url, httpOptions, undefined, options);
  }

  /**
   * @inheritdoc
   */
  public async post(
    path: string,
    postValues: Record<string, string>,
    options: SigaaRequestOptions = {}
  ): Promise<Page> {
    const url = this.httpSession.getURL(path);
    const body = stringify(postValues, '&', '=', {
      encodeURIComponent: this.encodeWithRFC3986
    });
    const httpOptions = this.makeHttpOptions('POST', url, {
      'Content-Type': 'application/x-www-form-urlencoded'
    });
    return this.requestPage(url, httpOptions, body, options);
  }

  /**
   * @inheritdoc
   * Uses the browser to interact with the form for multipart submissions.
   */
  public async postMultipart(
    path: string,
    formData: FormData,
    options?: SigaaRequestOptions
  ): Promise<Page> {
    const url = this.httpSession.getURL(path);
    const httpOptions = this.makeHttpOptions('POST', url);

    const postValues: Record<string, string> = {};

    try {
      const sessionHttpOptions = await this.httpSession.afterHTTPOptions(
        url,
        httpOptions,
        undefined,
        options
      );
      const pageBeforeRequest = await this.httpSession.beforeRequest(
        url,
        sessionHttpOptions,
        undefined,
        options
      );
      if (pageBeforeRequest) {
        return this.httpSession.afterSuccessfulRequest(pageBeforeRequest, options);
      }

      const html = await this.getBrowser().submitForm(postValues, url.href);
      const currentUrl = await this.getBrowser().getCurrentUrl();
      const page = this.buildSigaaPage(html, new URL(currentUrl));
      return this.httpSession.afterSuccessfulRequest(page, options);
    } catch (err) {
      return this.httpSession.afterUnsuccessfulRequest(
        err as Error,
        httpOptions,
        undefined
      );
    }
  }

  /**
   * @inheritdoc
   */
  public async downloadFileByGet(
    urlPath: string,
    basepath: string,
    callback?: ProgressCallback
  ): Promise<string> {
    const url = this.httpSession.getURL(urlPath);
    const httpOptions = this.makeHttpOptions('GET', url);

    const suspendRequest = await this.httpSession.beforeDownloadRequest(
      url,
      basepath,
      httpOptions,
      undefined,
      callback
    );
    if (suspendRequest) return suspendRequest;

    const finalPath = await this.getBrowser().downloadFile(url.href, basepath, callback);

    return this.httpSession.afterDownloadRequest(
      url,
      basepath,
      httpOptions,
      finalPath,
      undefined,
      callback
    );
  }

  /**
   * @inheritdoc
   */
  public async downloadFileByPost(
    urlPath: string,
    postValues: Record<string, string>,
    basepath: string,
    callback?: ProgressCallback
  ): Promise<string> {
    const url = this.httpSession.getURL(urlPath);
    const body = stringify(postValues, '&', '=', {
      encodeURIComponent: this.encodeWithRFC3986
    });
    const httpOptions = this.makeHttpOptions('POST', url);

    const suspendRequest = await this.httpSession.beforeDownloadRequest(
      url,
      basepath,
      httpOptions,
      body,
      callback
    );
    if (suspendRequest) return suspendRequest;

    await this.getBrowser().submitForm(postValues, url.href);
    const currentUrl = await this.getBrowser().getCurrentUrl();
    const finalPath = await this.getBrowser().downloadFile(currentUrl, basepath, callback);

    return this.httpSession.afterDownloadRequest(
      url,
      basepath,
      httpOptions,
      finalPath,
      body,
      callback
    );
  }

  /**
   * @inheritdoc
   * In the browser implementation, redirects are automatically followed during navigation.
   * This method checks if there is a location header (won't be set in browser mode)
   * and returns the page as-is if no redirect is needed.
   */
  public async followAllRedirect(
    page: Page,
    options?: SigaaRequestOptions
  ): Promise<Page> {
    if (page.headers && page.headers.location) {
      return this.get(page.headers.location as string, options);
    }
    return page;
  }

  /**
   * @inheritdoc
   */
  public closeSession(): void {
    this.httpSession.close();
    if (this.sigaaBrowser) {
      this.sigaaBrowser.close().catch(() => {});
    }
  }
}
