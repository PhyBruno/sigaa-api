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
    const name = frame.name();
    if (name === 'mainFrame') return frame;
  }

  const url = frame => frame.url();
  for (const frame of frames) {
    if (frame.url().includes('spacer.asp') || frame.url().includes('index') || frame !== page.mainFrame()) {
      return frame;
    }
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
      if (link.textContent.includes('Entrar') || link.href.includes('LinkLogin')) {
        link.click();
        return;
      }
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  const loginFormReady = await mainFrame.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"], input[type="password"]');
    return inputs.length >= 2;
  }).catch(() => false);

  if (!loginFormReady) {
    const allFrames = page.frames();
    let found = false;
    for (const f of allFrames) {
      const hasForm = await f.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="password"]');
        return inputs.length >= 2;
      }).catch(() => false);
      if (hasForm) {
        await fillAndSubmitLogin(f, matricula, senhaBiblioteca);
        found = true;
        break;
      }
    }
    if (!found) {
      await page.close().catch(() => {});
      throw new Error('Formulario de login nao encontrado.');
    }
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
    const textInputs = document.querySelectorAll('input[type="text"]');
    const passInputs = document.querySelectorAll('input[type="password"]');

    let matInput = null;
    for (const input of textInputs) {
      const container = input.closest('td, div, label, span, tr') || input.parentElement;
      const text = container ? container.textContent.toLowerCase() : '';
      if (text.includes('matr') || text.includes('login') || text.includes('usu') || text.includes('código')) {
        matInput = input;
        break;
      }
    }
    if (!matInput && textInputs.length > 0) matInput = textInputs[0];

    let senhaInput = passInputs.length > 0 ? passInputs[0] : null;

    if (matInput) {
      matInput.focus();
      matInput.value = mat;
      matInput.dispatchEvent(new Event('input', { bubbles: true }));
      matInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (senhaInput) {
      senhaInput.focus();
      senhaInput.value = senha;
      senhaInput.dispatchEvent(new Event('input', { bubbles: true }));
      senhaInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, matricula, senhaBiblioteca);

  await new Promise(r => setTimeout(r, 500));

  await frame.evaluate(() => {
    const allButtons = document.querySelectorAll('input[type="button"], input[type="submit"], button, a.btn, a.botao');
    for (const btn of allButtons) {
      const text = (btn.value || btn.textContent || '').toLowerCase().trim();
      if (text.includes('entrar') || text.includes('login') || text.includes('ok') || text.includes('acessar')) {
        btn.click();
        return;
      }
    }
    if (typeof Logar === 'function') { Logar(); return; }
    if (typeof LoginUsuario === 'function') { LoginUsuario(); return; }
    const form = document.querySelector('form');
    if (form) form.submit();
  });
}

module.exports = { loginSophia, SophiaSession };
