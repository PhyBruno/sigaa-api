import { LoginStatus } from '../../sigaa-types';
import { HTTP } from '@session/sigaa-http';
import { Session } from '@session/sigaa-session';
import { Login } from './sigaa-login';
import { UFPBPage } from '@session/page/sigaa-page-ufpb';
import { SigaaBrowserImpl } from '../sigaa-browser';
import { Page } from '@session/sigaa-page';

export class SigaaLoginUFPB implements Login {
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
      await this.http.get('/sigaa/logon.jsf', { noCache: true });

      await puppeteerPage.waitForSelector('input[name="form:login"]', {
        timeout: 15000
      });

      await puppeteerPage.evaluate(() => {
        const loginEl = document.querySelector(
          'input[name="form:login"]'
        ) as HTMLInputElement;
        const passEl = document.querySelector(
          'input[name="form:senha"]'
        ) as HTMLInputElement;
        if (loginEl) {
          loginEl.value = '';
          loginEl.focus();
        }
        if (passEl) {
          passEl.value = '';
        }
      });

      await new Promise((r) => setTimeout(r, 300));

      const loginField = await puppeteerPage.$('input[name="form:login"]');
      if (loginField) {
        await loginField.click({ clickCount: 3 });
        await puppeteerPage.keyboard.press('Backspace');
        for (const char of username) {
          await puppeteerPage.keyboard.type(char, { delay: 30 });
        }
      }

      await new Promise((r) => setTimeout(r, 200));

      const passwordField = await puppeteerPage.$('input[name="form:senha"]');
      if (passwordField) {
        await passwordField.click({ clickCount: 3 });
        await puppeteerPage.keyboard.press('Backspace');
        for (const char of password) {
          await puppeteerPage.keyboard.type(char, { delay: 30 });
        }
      }

      await new Promise((r) => setTimeout(r, 300));

      const navigationPromise = puppeteerPage
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        .catch(() => {});

      await puppeteerPage.evaluate(() => {
        const btn = document.querySelector(
          'input[type="submit"]'
        ) as HTMLElement;
        if (btn) btn.click();
      });

      await navigationPromise;

      const html: string = await puppeteerPage.content();

      if (html.includes('Usuário e/ou senha inválidos')) {
        throw new Error(this.errorInvalidCredentials);
      }

      if (html.includes('action="/sigaa/logon.jsf"')) {
        throw new Error('SIGAA: Invalid response after login attempt.');
      }

      this.session.loginStatus = LoginStatus.Authenticated;

      await this.browser.skipIntermediatePages();

      return (await this.browser.buildPageFromCurrentState('UFPB')) as UFPBPage;
    } catch (error: any) {
      if (!retry || error.message === this.errorInvalidCredentials) {
        throw error;
      }
      return this.login(username, password, false);
    }
  }
}
