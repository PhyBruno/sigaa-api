import { LoginStatus } from '../../sigaa-types';
import { HTTP } from '@session/sigaa-http';
import { Session } from '@session/sigaa-session';
import { Login } from './sigaa-login';
import { UFPBPage } from '@session/page/sigaa-page-ufpb';
import { SigaaBrowserImpl } from '../sigaa-browser';
import { Page } from '@session/sigaa-page';

/**
 * Responsible for logging in UFPB using a real browser to bypass Cloudflare.
 * @category Internal
 */
export class SigaaLoginUFPB implements Login {
  constructor(
    protected http: HTTP,
    protected session: Session,
    protected browser: SigaaBrowserImpl
  ) {}

  readonly errorInvalidCredentials = 'SIGAA: Invalid credentials.';

  /**
   * Login using the real browser: navigate via http.get(), type credentials,
   * click submit with realClick(), wait for navigation, then return a page
   * built from the browser's current state.
   */
  async login(
    username: string,
    password: string,
    retry = true
  ): Promise<Page> {
    if (this.session.loginStatus === LoginStatus.Authenticated) {
      throw new Error('SIGAA: This session already has a user logged in.');
    }

    if (!this.browser.isInitialized) {
      await this.browser.initialize();
    }

    const puppeteerPage = this.browser.getPage();

    try {
      await this.http.get('/sigaa/logon.jsf', { noCache: true });

      await puppeteerPage.waitForSelector('input[name="form:login"]', {
        timeout: 15000
      });

      const loginField = await puppeteerPage.$('input[name="form:login"]');
      if (loginField) {
        await loginField.click({ clickCount: 3 });
        await loginField.type(username, { delay: 50 });
      }

      const passwordField = await puppeteerPage.$('input[name="form:senha"]');
      if (passwordField) {
        await passwordField.click({ clickCount: 3 });
        await passwordField.type(password, { delay: 50 });
      }

      await puppeteerPage.realClick('input[type="submit"]');

      try {
        await puppeteerPage.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 30000
        });
      } catch (_) {
      }

      const html: string = await puppeteerPage.content();

      if (html.includes('Usuário e/ou senha inválidos')) {
        throw new Error(this.errorInvalidCredentials);
      }

      if (html.includes('action="/sigaa/logon.jsf"')) {
        throw new Error('SIGAA: Invalid response after login attempt.');
      }

      this.session.loginStatus = LoginStatus.Authenticated;
      return (await this.browser.buildPageFromCurrentState('UFPB')) as UFPBPage;
    } catch (error: any) {
      if (!retry || error.message === this.errorInvalidCredentials) {
        throw error;
      }
      return this.login(username, password, false);
    }
  }
}
