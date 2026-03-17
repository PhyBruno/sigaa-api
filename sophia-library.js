const SOPHIA_URL = 'https://biblioteca.ifsc.edu.br/';
const SOPHIA_TIMEOUT = 20000;

class SophiaSession {
  constructor(browser, page, mainFrame, matricula) {
    this.browser = browser;
    this.page = page;
    this.mainFrame = mainFrame;
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
    this.mainFrame = null;
    this.loggedIn = false;
  }
}

async function getMainFrame(page) {
  await page.waitForFunction(() => {
    const frame = document.querySelector('frame#mainFrame, iframe#mainFrame');
    return !!frame;
  }, { timeout: SOPHIA_TIMEOUT });

  const frames = page.frames();
  for (const frame of frames) {
    if (frame.name() === 'mainFrame') return frame;
  }

  for (const frame of frames) {
    if (frame !== page.mainFrame()) return frame;
  }

  throw new Error('Nao foi possivel encontrar o frame principal do SophiA.');
}

async function waitForFrameContent(frame, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hasContent = await frame.evaluate(() => {
      return document.body && document.body.innerHTML.trim().length > 50;
    }).catch(() => false);
    if (hasContent) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Timeout aguardando conteudo do frame principal.');
}

async function loginSophia(browser, matricula, senhaBiblioteca) {
  const page = await browser.newPage();

  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  await page.goto(SOPHIA_URL, { waitUntil: 'domcontentloaded', timeout: SOPHIA_TIMEOUT });
  await new Promise(r => setTimeout(r, 2000));

  const mainFrame = await getMainFrame(page);
  await waitForFrameContent(mainFrame, SOPHIA_TIMEOUT);
  await new Promise(r => setTimeout(r, 1000));

  await mainFrame.evaluate(() => {
    if (typeof LinkLogin === 'function') {
      LinkLogin();
      return;
    }
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent.includes('Entrar') || (link.href && link.href.includes('LinkLogin'))) {
        link.click();
        return;
      }
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  const dialogReady = await mainFrame.evaluate(() => {
    const dialog = document.querySelector('.ui-dialog, .ui-dialog-content, [role="dialog"], #dialog_login, #dialogLogin, .dialog, .modal');
    if (dialog) {
      const passInput = dialog.querySelector('input[type="password"]');
      return !!passInput;
    }
    const passInputs = document.querySelectorAll('input[type="password"]');
    return passInputs.length > 0;
  }).catch(() => false);

  if (!dialogReady) {
    let foundFrame = null;
    for (const f of page.frames()) {
      const has = await f.evaluate(() => {
        return document.querySelectorAll('input[type="password"]').length > 0;
      }).catch(() => false);
      if (has) { foundFrame = f; break; }
    }
    if (!foundFrame) {
      await page.close().catch(() => {});
      throw new Error('Formulario de login nao encontrado.');
    }
    await fillAndSubmitLogin(foundFrame, matricula, senhaBiblioteca);
  } else {
    await fillAndSubmitLogin(mainFrame, matricula, senhaBiblioteca);
  }

  await new Promise(r => setTimeout(r, 3000));

  const updatedFrame = await getMainFrame(page).catch(() => mainFrame);
  await waitForFrameContent(updatedFrame, SOPHIA_TIMEOUT).catch(() => {});

  const loginResult = await updatedFrame.evaluate(() => {
    const body = document.body ? document.body.innerText : '';
    if (body.includes('incorret') || body.includes('nválid') || body.includes('não encontrad') || body.includes('Senha incorreta')) {
      return { success: false, error: body.substring(0, 500) };
    }
    return { success: true, body: body.substring(0, 500) };
  }).catch(() => ({ success: true }));

  if (!loginResult.success) {
    await page.close().catch(() => {});
    throw new Error('Falha no login da biblioteca: ' + (loginResult.error || 'Credenciais invalidas'));
  }

  const session = new SophiaSession(browser, page, updatedFrame, matricula);
  session.loggedIn = true;
  return session;
}

async function fillAndSubmitLogin(frame, matricula, senhaBiblioteca) {
  await frame.evaluate((mat, senha) => {
    let container = document.querySelector('.ui-dialog, .ui-dialog-content, [role="dialog"], #dialog_login, #dialogLogin, .dialog, .modal');

    if (!container) {
      const passField = document.querySelector('input[type="password"]');
      if (passField) {
        container = passField.closest('.ui-dialog, .ui-dialog-content, [role="dialog"], div[style*="display"], div[class*="dialog"], div[class*="modal"], form, div');
      }
    }

    if (!container) container = document;

    const passInput = container.querySelector('input[type="password"]');

    let matInput = null;
    const allInputs = container.querySelectorAll('input[type="text"]');
    if (passInput) {
      for (const inp of allInputs) {
        const rect1 = inp.getBoundingClientRect();
        const rect2 = passInput.getBoundingClientRect();
        if (Math.abs(rect1.x - rect2.x) < 100 && rect1.y < rect2.y) {
          matInput = inp;
          break;
        }
      }
    }
    if (!matInput && allInputs.length > 0) {
      for (const inp of allInputs) {
        const parent = inp.closest('td, div, tr, label');
        const text = parent ? parent.textContent.toLowerCase() : '';
        if (text.includes('matr') || text.includes('login') || text.includes('usu') || text.includes('digo')) {
          matInput = inp;
          break;
        }
      }
    }
    if (!matInput) {
      const allTextInputs = container.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])');
      for (const inp of allTextInputs) {
        if (inp.offsetParent !== null) {
          matInput = inp;
          break;
        }
      }
    }

    if (matInput) {
      matInput.focus();
      matInput.value = '';
      matInput.value = mat;
      matInput.dispatchEvent(new Event('input', { bubbles: true }));
      matInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (passInput) {
      passInput.focus();
      passInput.value = '';
      passInput.value = senha;
      passInput.dispatchEvent(new Event('input', { bubbles: true }));
      passInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, matricula, senhaBiblioteca);

  await new Promise(r => setTimeout(r, 500));

  await frame.evaluate(() => {
    let container = document.querySelector('.ui-dialog, .ui-dialog-content, [role="dialog"], #dialog_login, #dialogLogin, .dialog, .modal');
    if (!container) {
      const passField = document.querySelector('input[type="password"]');
      if (passField) {
        container = passField.closest('.ui-dialog, .ui-dialog-content, [role="dialog"], div[style*="display"], div[class*="dialog"], div[class*="modal"], form, div');
      }
    }
    if (!container) container = document;

    const buttons = container.querySelectorAll('input[type="button"], input[type="submit"], button, a.btn, a.botao, .ui-button');
    for (const btn of buttons) {
      const text = (btn.value || btn.textContent || '').toLowerCase().trim();
      if (text.includes('entrar') || text.includes('login') || text.includes('acessar')) {
        btn.click();
        return;
      }
    }

    if (typeof Logar === 'function') { Logar(); return; }
    if (typeof LoginUsuario === 'function') { LoginUsuario(); return; }

    const form = container.querySelector('form') || container.closest('form');
    if (form) { form.submit(); return; }

    const allBtns = document.querySelectorAll('input[type="button"], input[type="submit"], button');
    for (const btn of allBtns) {
      const text = (btn.value || btn.textContent || '').toLowerCase().trim();
      if (text.includes('entrar')) {
        btn.click();
        return;
      }
    }
  });
}

module.exports = { loginSophia, SophiaSession };
