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

  ensureOpen() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Sessao da biblioteca encerrada. Faca login novamente.');
    }
  }

  async navigateToCirculacoes() {
    this.ensureOpen();
    const page = this.page;
    const mainFrame = await getMainFrame(page);

    const hasCircTable = await mainFrame.evaluate(() => {
      return !!document.querySelector('table.tab_circulacoes');
    }).catch(() => false);

    if (hasCircTable) return mainFrame;

    const hasCircLink = await mainFrame.evaluate(() => {
      return !!document.querySelector('a[href*="LinkCirculacoes"]');
    }).catch(() => false);

    if (!hasCircLink) {
      await mainFrame.evaluate(() => {
        const links = [...document.querySelectorAll('a')];
        const serv = links.find(l => {
          const txt = l.textContent.trim();
          const href = l.getAttribute('href') || '';
          return txt === 'Serviços' || txt === 'Servicos' || href.includes('LinkServicos');
        });
        if (serv) serv.click();
      });
      await new Promise(r => setTimeout(r, 2500));
    }

    const navFrame = await getMainFrame(page).catch(() => mainFrame);
    await navFrame.evaluate(() => {
      const circ = document.querySelector('a[href*="LinkCirculacoes"]');
      if (circ) { circ.click(); return; }
      if (typeof LinkCirculacoes === 'function') {
        const modo = (typeof parent !== 'undefined' && parent.hiddenFrame)
          ? parent.hiddenFrame.modo_busca : 0;
        LinkCirculacoes(modo);
      }
    });

    await new Promise(r => setTimeout(r, 3000));

    const resultFrame = await getMainFrame(page).catch(() => navFrame);
    await waitForFrameContent(resultFrame, SOPHIA_TIMEOUT).catch(() => {});
    return resultFrame;
  }

  async getEmprestimos() {
    const frame = await this.navigateToCirculacoes();

    return await frame.evaluate(() => {
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

  async renovar(codigos) {
    const frame = await this.navigateToCirculacoes();

    const selecionados = await frame.evaluate((codigos) => {
      const table = document.querySelector('table.tab_circulacoes');
      if (!table) return { error: 'Tabela de circulacoes nao encontrada.' };

      const rows = [...table.querySelectorAll('tr')];
      if (rows.length < 2) return { error: 'Nenhuma circulacao encontrada na tabela.' };

      const renovAll = !codigos || codigos.length === 0;

      if (renovAll) {
        const selTudo = table.querySelector('input[name="selTudo"]');
        if (selTudo && !selTudo.checked) {
          selTudo.click();
        } else {
          const cbs = table.querySelectorAll('input[type="checkbox"]:not([name="selTudo"])');
          cbs.forEach(cb => { cb.checked = true; });
        }
        const checked = table.querySelectorAll('input[type="checkbox"]:checked:not([name="selTudo"])');
        return { count: checked.length };
      }

      const headers = [...rows[0].querySelectorAll('th, td')].map(c =>
        c.textContent.replace(/\u00a0/g, ' ').trim()
      );
      const codIdx = headers.findIndex(h => h === 'Cód.' || h === 'Cod.');
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const cells = [...rows[i].querySelectorAll('td')];
        const cb = rows[i].querySelector('input[type="checkbox"]');
        if (!cb || !cells[codIdx]) continue;

        const cellCod = cells[codIdx].textContent.replace(/\u00a0/g, ' ').trim();
        if (codigos.includes(cellCod)) {
          cb.checked = true;
          count++;
        }
      }

      return { count };
    }, codigos);

    if (selecionados.error) throw new Error(selecionados.error);
    if (selecionados.count === 0) throw new Error('Nenhum livro encontrado para renovar.');

    await frame.evaluate(() => {
      if (typeof LinkRenovar === 'function') {
        LinkRenovar();
      } else {
        const link = document.querySelector('a[href*="LinkRenovar"]');
        if (link) link.click();
      }
    });

    // LinkRenovar() navega o mainFrame para a página de resultado.
    // Aguarda o carregamento da nova página.
    await new Promise(r => setTimeout(r, 5000));

    const page = this.page;
    const updatedFrame = await getMainFrame(page).catch(() => frame);
    await waitForFrameContent(updatedFrame, SOPHIA_TIMEOUT).catch(() => {});

    // Após LinkRenovar(), a página de resultado tem duas situações:
    // SUCESSO: #div_recibo contém tabelas com os dados do recibo
    // FALHA:   #div_recibo está vazio; a tab_circulacoes mostra o motivo por item
    const result = await updatedFrame.evaluate(() => {
      function cleanText(el) {
        if (!el) return null;
        return el.textContent.replace(/\u00a0/g, ' ').trim();
      }

      // ── 1. Tenta parsear o recibo de sucesso ──────────────────────────────
      const divRecibo = document.querySelector('#div_recibo');
      const reciboVazio = !divRecibo || divRecibo.querySelectorAll('table').length === 0;

      if (!reciboVazio) {
        const parsed = {};
        for (const table of divRecibo.querySelectorAll('table')) {
          for (const row of table.querySelectorAll('tr')) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) continue;
            const bTag = cells[0].querySelector('b');
            const label = (bTag ? cleanText(bTag) : cleanText(cells[0])).replace(/:$/, '');
            const value = cleanText(cells[1]);
            if (label && value) parsed[label] = value;
          }
        }
        if (Object.keys(parsed).length > 0) {
          return { sucesso: true, parsed };
        }
      }

      // ── 2. Recibo vazio — extrai motivos dos spans vermelhos e dados da tabela ─
      // No SophiA, quando a renovação falha, o motivo aparece em:
      //   <td class="td_tabelas_valor2 esquerda">
      //     <span style="color: #990000">Item não renovado. Motivo...</span>
      //   </td>
      // E os dados do item (título, código, etc.) ficam na tab_circulacoes.

      // 2a. Coleta TODOS os spans vermelhos (motivos de erro)
      const spansMensagem = [...document.querySelectorAll('span[style*="990000"], span[style*="red"], span.erro, span.msg_erro')];
      const motivos = spansMensagem
        .map(s => cleanText(s))
        .filter(t => t && t.length > 5);

      // 2b. Coleta dados da tab_circulacoes (título, código, etc.)
      const tabCirc = document.querySelector('table.tab_circulacoes');
      const itens = [];

      if (tabCirc) {
        const rows = [...tabCirc.querySelectorAll('tr')];
        const headers = rows.length > 0
          ? [...rows[0].querySelectorAll('th, td')].map(c => cleanText(c))
          : [];

        const tituloIdx = headers.findIndex(h => h && (/t[ií]tulo/i.test(h)));
        const codIdx = headers.findIndex(h => h && (/^c[oó]d\.?$/i.test(h)));
        const chamadaIdx = headers.findIndex(h => h && (/chamada/i.test(h)));
        const bibIdx = headers.findIndex(h => h && (/biblioteca/i.test(h)));

        for (let i = 1; i < rows.length; i++) {
          const cells = [...rows[i].querySelectorAll('td')];
          if (cells.length < 2) continue;

          // Pula linhas que são só checkbox ou cabeçalho
          const textoLinha = cleanText(rows[i]);
          if (!textoLinha || textoLinha.length < 3) continue;

          const item = {};
          if (tituloIdx >= 0 && cells[tituloIdx]) item.titulo = cleanText(cells[tituloIdx]);
          if (codIdx >= 0 && cells[codIdx]) item.codigo = cleanText(cells[codIdx]);
          if (chamadaIdx >= 0 && cells[chamadaIdx]) item.chamada = cleanText(cells[chamadaIdx]);
          if (bibIdx >= 0 && cells[bibIdx]) item.biblioteca = cleanText(cells[bibIdx]);

          // Procura o motivo no span vermelho DENTRO desta linha
          const spanErro = rows[i].querySelector('span[style*="990000"], span[style*="red"], span.erro');
          if (spanErro) {
            item.motivo = cleanText(spanErro);
          }

          if (item.titulo || item.codigo || item.motivo) itens.push(item);
        }
      }

      // 2c. Se não encontrou itens com motivo, cria itens a partir dos spans vermelhos
      if (itens.length === 0 && motivos.length > 0) {
        for (const motivo of motivos) {
          itens.push({ titulo: null, codigo: null, motivo });
        }
      } else if (itens.length > 0) {
        // Se itens existem mas não têm motivo, distribui os motivos
        let mIdx = 0;
        for (const item of itens) {
          if (!item.motivo && mIdx < motivos.length) {
            item.motivo = motivos[mIdx++];
          }
        }
      }

      // Mensagem geral: primeiro motivo encontrado ou scan do body
      const mensagemGeral = motivos.length > 0
        ? motivos[0]
        : (() => {
            const body = document.body ? document.body.innerText : '';
            const padroes = [
              /item n[aã]o renovado[^.]*\./i,
              /n[aã]o [eé] permitido renovar[^.]*\./i,
              /n[uú]mero m[aá]ximo de renova[cç][oõ]es[^.]*\./i,
              /reserva para o exemplar/i,
              /em atraso/i,
              /bloqueado/i,
              /suspenso/i
            ];
            for (const p of padroes) {
              const m = body.match(p);
              if (m) return m[0];
            }
            return null;
          })();

      return { sucesso: false, itens, mensagemGeral };
    }).catch(() => ({ sucesso: false, itens: [], mensagemGeral: null }));

    // ── SUCESSO ───────────────────────────────────────────────────────────────
    if (result.sucesso) {
      const p = result.parsed || {};
      return {
        sucesso: true,
        usuario: p['Usuário'] || p['Usuario'] || null,
        matricula: p['Matrícula'] || p['Matricula'] || null,
        recibo: {
          codigoRenovacao: p['Cód. renovação'] || p['Cod. renovacao'] || p['Cód. Renovação'] || null,
          titulo: p['Título'] || p['Titulo'] || null,
          biblioteca: p['Biblioteca'] || null,
          chamada: p['Nº de chamada'] || p['No de chamada'] || p['N° de chamada'] || null,
          exemplar: p['Exemplar'] || null,
          dataSaida: p['Data de saída'] || p['Data de saida'] || p['Data saída'] || null,
          prevDevolucao: p['Prev. Devolução'] || p['Prev. Devolucao'] || p['Prev devolução'] || null
        }
      };
    }

    // ── FALHA ─────────────────────────────────────────────────────────────────
    return {
      sucesso: false,
      mensagem: result.mensagemGeral || 'Item(ns) nao puderam ser renovados.',
      itens: (result.itens || []).map(item => {
        const out = {
          titulo: item.titulo || null,
          codigo: item.codigo || null,
          motivo: item.motivo || 'Motivo nao identificado'
        };
        if (item.chamada) out.chamada = item.chamada;
        if (item.biblioteca) out.biblioteca = item.biblioteca;
        return out;
      })
    };
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
    console.log('\n  === SophiA Biblioteca - Standalone ===\n');
    const matricula = await ask('  Matricula: ');
    const senha = await askHidden('  Senha da biblioteca: ');
    console.log('\n  Conectando...\n');

    let session;
    try {
      session = await loginSophiaStandalone(matricula, senha);
      console.log('  Login realizado com sucesso!\n');
    } catch (err) {
      console.log('  Erro ao fazer login: ' + (err.message || err));
      rl.close();
      process.exit(1);
    }

    let running = true;
    while (running) {
      console.log('\n  ─────────────────────────────────');
      console.log('  1. Ver emprestimos');
      console.log('  2. Renovar emprestimos');
      console.log('  0. Sair');
      console.log('  ─────────────────────────────────');
      const opcao = await ask('  Opcao: ');

      try {
        switch (opcao.trim()) {
          case '1': {
            console.log('\n  Carregando emprestimos...\n');
            const emprestimos = await session.getEmprestimos();
            if (emprestimos.length === 0) {
              console.log('  Nenhum emprestimo encontrado.');
            } else {
              for (const livro of emprestimos) {
                console.log(`  #${livro.numero} - ${livro.titulo}`);
                console.log(`    Codigo: ${livro.codigo} | Chamada: ${livro.chamada}`);
                console.log(`    Biblioteca: ${livro.biblioteca}`);
                console.log(`    Saida: ${livro.dataSaida} | Prevista: ${livro.dataPrevista}`);
                console.log('');
              }
              console.log(`  Total: ${emprestimos.length} livro(s)`);
            }
            break;
          }
          case '2': {
            console.log('\n  Carregando emprestimos...\n');
            const emprestimos = await session.getEmprestimos();
            if (emprestimos.length === 0) {
              console.log('  Nenhum emprestimo encontrado para renovar.');
              break;
            }
            for (const livro of emprestimos) {
              console.log(`  ${livro.numero}. ${livro.titulo} (Cod: ${livro.codigo}, Previsto: ${livro.dataPrevista})`);
            }
            console.log('\n  Digite codigos separados por virgula, ou ENTER para renovar todos.');
            const input = await ask('  Codigos: ');
            const codigos = input.trim() ? input.split(',').map(c => c.trim()).filter(c => c) : [];
            console.log('\n  Renovando...\n');
            const resultado = await session.renovar(codigos);
            console.log('  Sucesso: ' + resultado.sucesso);
            if (resultado.usuario) console.log('  Usuario: ' + resultado.usuario);
            if (resultado.matricula) console.log('  Matricula: ' + resultado.matricula);
            if (resultado.recibo) {
              const r = resultado.recibo;
              console.log('\n  --- Recibo ---');
              if (r.codigoRenovacao) console.log('  Cod. renovacao: ' + r.codigoRenovacao);
              if (r.titulo) console.log('  Titulo: ' + r.titulo);
              if (r.biblioteca) console.log('  Biblioteca: ' + r.biblioteca);
              if (r.chamada) console.log('  N. de chamada: ' + r.chamada);
              if (r.exemplar) console.log('  Exemplar: ' + r.exemplar);
              if (r.dataSaida) console.log('  Data de saida: ' + r.dataSaida);
              if (r.prevDevolucao) console.log('  Prev. Devolucao: ' + r.prevDevolucao);
            } else if (resultado.circulacoes && resultado.circulacoes.length > 0) {
              for (const c of resultado.circulacoes) {
                console.log('');
                if (c.codigoRenovacao) console.log('  Cod: ' + c.codigoRenovacao);
                if (c.titulo) console.log('  Titulo: ' + c.titulo);
                if (c.biblioteca) console.log('  Biblioteca: ' + c.biblioteca);
                if (c.dataSaida) console.log('  Saida: ' + c.dataSaida);
                if (c.prevDevolucao) console.log('  Prev. Devolucao: ' + c.prevDevolucao);
                if (c.observacoes) console.log('  Obs: ' + c.observacoes);
              }
            }
            break;
          }
          case '0':
            running = false;
            break;
          default:
            console.log('  Opcao invalida.');
        }
      } catch (err) {
        console.log('  Erro: ' + (err.message || err));
      }
    }

    console.log('\n  Encerrando sessao...');
    await session.close();
    rl.close();
    process.exit(0);
  })();
}
