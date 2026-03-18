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

  async getEmprestimos() {
    const page = this.page;
    const mainFrame = await getMainFrame(page);

    const onServicesPage = await mainFrame.evaluate(() => {
      return !!document.querySelector('a[href*="LinkCirculacoes"]');
    }).catch(() => false);

    if (!onServicesPage) {
      await mainFrame.evaluate(() => {
        const links = [...document.querySelectorAll('a')];
        const serv = links.find(l =>
          l.textContent.trim() === 'Serviços' ||
          (l.href && l.href.includes('LinkServicos'))
        );
        if (serv) serv.click();
      });
      await new Promise(r => setTimeout(r, 2500));
    }

    const freshFrame = await getMainFrame(page).catch(() => mainFrame);
    await freshFrame.evaluate(() => {
      const circ = document.querySelector('a[href*="LinkCirculacoes"]');
      if (circ) { circ.click(); return; }
      if (typeof LinkCirculacoes === 'function') {
        LinkCirculacoes(typeof parent !== 'undefined' && parent.hiddenFrame ? parent.hiddenFrame.modo_busca : 0);
      }
    });

    await new Promise(r => setTimeout(r, 3000));

    const resultFrame = await getMainFrame(page).catch(() => mainFrame);
    await waitForFrameContent(resultFrame, SOPHIA_TIMEOUT).catch(() => {});

    return await resultFrame.evaluate(() => {
      const table = document.querySelector('table.tab_circulacoes');
      if (!table) return [];
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length < 2) return [];
      const headers = [...rows[0].querySelectorAll('th, td')].map(c =>
        c.textContent.replace(/\u00a0/g, ' ').trim()
      );
      const result = [];
      for (let i = 1; i < rows.length; i++) {
        const cells = [...rows[i].querySelectorAll('td')];
        if (cells.length === 0) continue;
        const raw = {};
        cells.forEach((cell, idx) => {
          if (headers[idx]) raw[headers[idx]] = cell.textContent.replace(/\u00a0/g, ' ').trim();
        });
        result.push({
          numero: raw['#'] || null,
          titulo: raw['Título'] || raw['Titulo'] || null,
          chamada: raw['Nº de chamada'] || raw['N\u00ba de chamada'] || null,
          codigo: raw['Cód.'] || raw['Cod.'] || null,
          biblioteca: raw['Biblioteca'] || null,
          dataSaida: raw['Data saída'] || raw['Data saida'] || null,
          dataPrevista: raw['Data prevista'] || null
        });
      }
      return result;
    });
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

  for (const frame of page.frames()) {
    const closed = await frame.evaluate(() => {
      const closeLink = document.querySelector('a.link_topo[title="fechar"]');
      if (closeLink) { closeLink.click(); return true; }
      if (typeof fechaPopup === 'function') { fechaPopup(); return true; }
      return false;
    }).catch(() => false);
    if (closed) break;
  }

  await new Promise(r => setTimeout(r, 500));

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

async function loginSophiaStandalone(matricula, senhaBiblioteca) {
  const { connect } = require('puppeteer-real-browser');
  const { browser } = await connect({
    headless: false,
    args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
    turnstile: true,
    disableXvfb: false,
    connectOption: { defaultViewport: null }
  });
  return loginSophia(browser, matricula, senhaBiblioteca);
}

module.exports = { loginSophia, loginSophiaStandalone, SophiaSession };

if (require.main === module) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));
  const askHidden = (q) => new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = '';
    const onData = (c) => {
      const ch = c.toString();
      if (ch === '\n' || ch === '\r') { stdin.removeListener('data', onData); if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw); process.stdout.write('\n'); resolve(input); }
      else if (ch === '\u0003') process.exit();
      else if (ch === '\u007F' || ch === '\b') { if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); } }
      else { input += ch; process.stdout.write('*'); }
    };
    stdin.on('data', onData);
  });

  (async () => {
    console.log('\n  === SophiA Biblioteca - Login Standalone ===\n');
    const matricula = await ask('  Matricula: ');
    const senha = await askHidden('  Senha da biblioteca: ');
    console.log('\n  Conectando...\n');
    try {
      const session = await loginSophiaStandalone(matricula, senha);
      console.log('  Login realizado com sucesso!\n');
      await ask('  Pressione ENTER para encerrar...');
      await session.close();
    } catch (err) {
      console.log('  Erro: ' + (err.message || err));
    }
    rl.close();
    process.exit(0);
  })();
}
