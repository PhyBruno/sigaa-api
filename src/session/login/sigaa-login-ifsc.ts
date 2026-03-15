import { LoginStatus } from '../../sigaa-types';
import { HTTP } from '../sigaa-http';
import { Session } from '../sigaa-session';
import { Login } from './sigaa-login';
import { IFSCPage } from '@session/page/sigaa-page-ifsc';
import { SigaaBrowserImpl } from '../sigaa-browser';
import { Page } from '@session/sigaa-page';

export class SigaaLoginIFSC implements Login {
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
            loginEl.value = '';
            loginEl.focus();
          }
          if (passEl) {
            passEl.value = '';
          }
        },
        username,
        password
      );

      await new Promise((r) => setTimeout(r, 300));

      const loginField = await puppeteerPage.$('input[name="user.login"]');
      if (loginField) {
        await loginField.click({ clickCount: 3 });
        await puppeteerPage.keyboard.press('Backspace');
        for (const char of username) {
          await puppeteerPage.keyboard.type(char, { delay: 30 });
        }
      }

      await new Promise((r) => setTimeout(r, 200));

      const passwordField = await puppeteerPage.$('input[name="user.senha"]');
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

      if (
        html.includes('Entrar no Sistema') &&
        !puppeteerPage.url().includes('portais') &&
        !puppeteerPage.url().includes('index')
      ) {
        throw new Error('SIGAA: Invalid response after login attempt.');
      }

      this.session.loginStatus = LoginStatus.Authenticated;

      await this.browser.skipIntermediatePages();

      return (await this.browser.buildPageFromCurrentState('IFSC')) as IFSCPage;
    } catch (error: any) {
      if (!retry || error.message === this.errorInvalidCredentials) {
        throw error;
      }
      return this.login(username, password, false);
    }
  }
}
