import { LoginStatus } from '../../sigaa-types';
import { HTTP } from '../sigaa-http';
import { Session } from '../sigaa-session';
import { Login } from './sigaa-login';
import { UNBPage } from '@session/page/sigaa-page-unb';
import { SigaaBrowserImpl } from '../sigaa-browser';
import { Page } from '@session/sigaa-page';

export class SigaaLoginUNB implements Login {
  constructor(
    protected http: HTTP,
    protected session: Session,
    protected browser: SigaaBrowserImpl
  ) {}

  readonly errorInvalidCredentials = 'SIGAA: Invalid credentials.';

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
      await this.http.get('/sigaa/verTelaLogin.do', { noCache: true });

      await puppeteerPage.waitForSelector('input[name="user.login"]', {
        timeout: 15000
      });

      await puppeteerPage.evaluate(
        (user: string, pass: string) => {
          const loginEl = document.querySelector(
            'input[name="user.login"]'
          ) as HTMLInputElement;
          const passEl = document.querySelector(
            'input[name="user.senha"]'
          ) as HTMLInputElement;

          if (loginEl) {
            loginEl.focus();
            loginEl.value = user;
            loginEl.dispatchEvent(new Event('input', { bubbles: true }));
            loginEl.dispatchEvent(new Event('change', { bubbles: true }));
          }

          if (passEl) {
            passEl.focus();
            passEl.value = pass;
            passEl.dispatchEvent(new Event('input', { bubbles: true }));
            passEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        username,
        password
      );

      await this.browser.waitForTurnstile(puppeteerPage);

      const navigationPromise = puppeteerPage
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
        .catch(() => {});

      await puppeteerPage.evaluate(() => {
        const btn =
          document.querySelector('#btSubmit') ||
          document.querySelector('button[type="submit"]') ||
          document.querySelector('input[type="submit"]');
        if (btn) (btn as HTMLElement).click();
      });

      await navigationPromise;

      const html: string = await puppeteerPage.content();

      if (html.includes('Usuário e/ou senha inválidos')) {
        throw new Error(this.errorInvalidCredentials);
      }

      if (html.includes('Entrar no Sistema')) {
        throw new Error('SIGAA: Invalid response after login attempt.');
      }

      this.session.loginStatus = LoginStatus.Authenticated;

      await this.browser.skipIntermediatePages();

      return (await this.browser.buildPageFromCurrentState('UNB')) as UNBPage;
    } catch (error: any) {
      if (!retry || error.message === this.errorInvalidCredentials) {
        throw error;
      }
      return this.login(username, password, false);
    }
  }
}
