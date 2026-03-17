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

async function findFrameWithLoginForm(page) {
  for (const frame of page.frames()) {
    const hasForm = await frame.evaluate(() => {
      return !!document.querySelector('input[name="codigo"]') || !!document.querySelector('form.formLogin');
    }).catch(() => false);
    if (hasForm) return frame;
  }
  return null;
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

  await new Promise(r => setTimeout(r, 3000));

  let loginFrame = await findFrameWithLoginForm(page);

  if (!loginFrame) {
    const hasFormInMain = await mainFrame.evaluate(() => {
      return !!document.querySelector('input[name="codigo"]') || !!document.querySelector('input[type="password"]');
    }).catch(() => false);

    if (hasFormInMain) {
      loginFrame = mainFrame;
    } else {
      await page.close().catch(() => {});
      throw new Error('Formulario de login nao encontrado em nenhum frame.');
    }
  }

  await loginFrame.evaluate((mat, senha) => {
    const matInput = document.querySelector('input[name="codigo"]');
    const senhaInput = document.querySelector('input[name="senha"]');

    if (matInput) {
      matInput.focus();
      matInput.value = '';
      matInput.value = mat;
      matInput.dispatchEvent(new Event('input', { bubbles: true }));
      matInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (senhaInput) {
      senhaInput.focus();
      senhaInput.value = '';
      senhaInput.value = senha;
      senhaInput.dispatchEvent(new Event('input', { bubbles: true }));
      senhaInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, matricula, senhaBiblioteca);

  await new Promise(r => setTimeout(r, 500));

  await loginFrame.evaluate(() => {
    if (typeof ValidaLogin === 'function') {
      ValidaLogin(0);
      return;
    }
    const btn = document.querySelector('#button1') || document.querySelector('input.submit[value="Entrar"]');
    if (btn) {
      btn.click();
      return;
    }
    const form = document.querySelector('form.formLogin') || document.querySelector('form[name="login"]');
    if (form) form.submit();
  });

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

module.exports = { loginSophia, SophiaSession };
