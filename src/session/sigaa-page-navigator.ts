/**
 * Helper for navigating SIGAA JSF pages.
 * SIGAA uses PrimeFaces/JSF where links submit hidden forms via JavaScript.
 * @category Internal
 */
export class SigaaPageNavigator {
  /**
   * Click a menu item by its visible text content.
   * Searches all links and buttons on the page.
   */
  async clickMenuItemByText(page: any, text: string): Promise<string> {
    const element = await page.evaluateHandle((searchText: string) => {
      const nodes = document.querySelectorAll('a, input[type=submit], button');
      for (const node of Array.from(nodes)) {
        if ((node.textContent || '').trim() === searchText) return node;
      }
      return null;
    }, text);

    if (!element || (await element.evaluate((el: any) => el === null))) {
      throw new Error(`SIGAA: Menu item not found: "${text}"`);
    }

    await element.evaluate((el: HTMLElement) => el.click());

    try {
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      });
    } catch (_) {
    }

    return page.content();
  }

  /**
   * Submit a JSF form by injecting field values and triggering form.submit().
   */
  async submitJSFForm(
    page: any,
    formData: Record<string, string>
  ): Promise<string> {
    await page.evaluate((data: Record<string, string>) => {
      for (const [name, value] of Object.entries(data)) {
        const input = document.querySelector(
          `input[name="${name}"]`
        ) as HTMLInputElement | null;
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
      if (form) form.submit();
    }, formData);

    try {
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      });
    } catch (_) {
    }

    return page.content();
  }

  /**
   * Check if the given page represents an expired SIGAA session.
   */
  async checkSessionExpired(page: any): Promise<boolean> {
    const url: string = page.url();
    const html: string = await page.content();

    if (url.includes('verTelaLogin')) return true;
    if (html.includes('input[name="user.login"]')) return true;
    if (html.includes('Sua sessão expirou')) return true;

    return false;
  }
}
