const SOPHIA_URL = 'https://biblioteca.ifsc.edu.br/';
const SOPHIA_LOGIN_TIMEOUT = 15000;

class SophiaSession {
  constructor(browser, page, matricula) {
    this.browser = browser;
    this.page = page;
    this.matricula = matricula;
    this.loggedIn = false;
  }

  async close() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch (e) {}
    this.page = null;
    this.loggedIn = false;
  }
}

async function loginSophia(browser, matricula, senhaBiblioteca) {
  const page = await browser.newPage();

  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await page.goto(SOPHIA_URL, { waitUntil: 'domcontentloaded', timeout: SOPHIA_LOGIN_TIMEOUT });

  await page.evaluate(() => {
    const links = document.querySelectorAll('a.link_menu1');
    for (const link of links) {
      if (link.textContent.includes('Entrar')) {
        link.click();
        return;
      }
    }
    if (typeof LinkLogin === 'function') LinkLogin();
  });

  await page.waitForFunction(() => {
    const inputs = document.querySelectorAll('input[type="text"], input[type="password"]');
    return inputs.length >= 2;
  }, { timeout: SOPHIA_LOGIN_TIMEOUT });

  await new Promise(r => setTimeout(r, 500));

  await page.evaluate((mat, senha) => {
    const inputs = document.querySelectorAll('input[type="text"]');
    const passInputs = document.querySelectorAll('input[type="password"]');

    let matInput = null;
    let senhaInput = null;

    for (const input of inputs) {
      const prev = input.previousElementSibling || input.parentElement;
      const text = (prev ? prev.textContent : '').toLowerCase();
      if (text.includes('matr') || text.includes('login') || text.includes('usu')) {
        matInput = input;
        break;
      }
    }
    if (!matInput && inputs.length > 0) matInput = inputs[0];

    if (passInputs.length > 0) senhaInput = passInputs[0];

    if (matInput) {
      matInput.value = '';
      matInput.focus();
      matInput.value = mat;
      matInput.dispatchEvent(new Event('input', { bubbles: true }));
      matInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (senhaInput) {
      senhaInput.value = '';
      senhaInput.focus();
      senhaInput.value = senha;
      senhaInput.dispatchEvent(new Event('input', { bubbles: true }));
      senhaInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, matricula, senhaBiblioteca);

  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => {
    const buttons = document.querySelectorAll('input[type="button"], button, input[type="submit"]');
    for (const btn of buttons) {
      const text = (btn.value || btn.textContent || '').toLowerCase();
      if (text.includes('entrar') || text.includes('login') || text.includes('ok')) {
        btn.click();
        return;
      }
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  const loginResult = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    if (body.includes('incorret') || body.includes('inválid') || body.includes('invalid') || body.includes('Senha incorreta') || body.includes('não encontrad')) {
      return { success: false, error: body.substring(0, 300) };
    }
    const logoutLink = document.querySelector('a[href*="Logout"], a[href*="logout"], a[href*="Sair"]');
    const userName = document.querySelector('.nome_usuario, .user-name, .usuario');
    if (logoutLink || userName) {
      return { success: true };
    }
    return { success: true };
  });

  if (!loginResult.success) {
    await page.close().catch(() => {});
    throw new Error('Falha no login da biblioteca: ' + (loginResult.error || 'Credenciais invalidas'));
  }

  const session = new SophiaSession(browser, page, matricula);
  session.loggedIn = true;
  return session;
}

module.exports = { loginSophia, SophiaSession };
