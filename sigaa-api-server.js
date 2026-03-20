const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { Sigaa } = require('./dist/sigaa-all-types');
const { loginSophia } = require('./sophia-library');

// Erros não-fatais gerados pelo Puppeteer / chrome-launcher ao fechar o
// navegador. No Windows o chrome-launcher falha ao deletar o temp dir; e o
// rebrowser-puppeteer lança TargetCloseError ao desconectar o CDP. Nenhum
// desses impacta a API — são subprodutos normais do encerramento do Chrome.
function isBrowserCleanupError(err) {
  if (!err) return false;
  // chrome-launcher tentando rmSync no diretório lighthouse
  if (err.code === 'EPERM' && typeof err.path === 'string' && err.path.toLowerCase().includes('lighthouse')) return true;
  // puppeteer TargetCloseError / Protocol error ao fechar browser
  const msg = String(err.message || err.name || '');
  if (/target\s*close/i.test(msg)) return true;
  if (/protocol\s*error/i.test(msg) && /target\s*closed/i.test(msg)) return true;
  if (/session\s*closed/i.test(msg)) return true;
  if (/browser\s*(has\s*)?disconnect/i.test(msg)) return true;
  if (/connection\s*closed/i.test(msg)) return true;
  // puppeteer navigation/context destroyed durante close
  if (/navigation/i.test(msg) && /destroyed|closed|detached/i.test(msg)) return true;
  if (/execution\s*context/i.test(msg) && /destroy/i.test(msg)) return true;
  return false;
}

process.on('uncaughtException', (err) => {
  if (isBrowserCleanupError(err)) {
    console.warn('[Aviso] Erro de limpeza do Chrome ignorado:', (err.message || '').substring(0, 120));
    return;
  }
  console.error('[Erro nao tratado]', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isBrowserCleanupError(reason)) {
    console.warn('[Aviso] Erro de limpeza do Chrome ignorado:', String(reason.message || reason).substring(0, 120));
    return;
  }
  console.error('[Rejeicao nao tratada]', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5', 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MIN || '5', 10) * 60 * 1000;

const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSession(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token nao fornecido. Use o header Authorization: Bearer <token>' });
    return null;
  }
  const token = auth.slice(7);
  const session = sessions.get(token);
  if (!session) {
    res.status(401).json({ error: 'Sessao invalida ou expirada. Faca login novamente.' });
    return null;
  }
  session.lastAccess = Date.now();
  return session;
}

async function getStudentBond(account) {
  const bonds = await account.getActiveBonds();
  for (const bond of bonds) {
    if (bond.type === 'student') return bond;
  }
  return null;
}

function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function parseSchedule(scheduleStr) {
  if (!scheduleStr) return [];
  const dayNames = { '2': 'Segunda', '3': 'Terca', '4': 'Quarta', '5': 'Quinta', '6': 'Sexta', '7': 'Sabado' };
  const turnNames = { 'M': 'Manha', 'T': 'Tarde', 'N': 'Noite' };
  const clean = scheduleStr.replace(/\(.*\)/, '').trim();
  const blocks = clean.split(/\s+/);
  const result = [];
  for (const block of blocks) {
    const match = block.match(/^(\d+)([MTN])(\d+)$/);
    if (!match) continue;
    const days = match[1].split('');
    const turn = match[2];
    const slots = match[3].split('');
    for (const dayCode of days) {
      result.push({
        dia: dayNames[dayCode] || dayCode,
        turno: turnNames[turn] || turn,
        aulas: slots.map(Number),
        codigo: block
      });
    }
  }
  return result;
}

// Encerra uma sessão de forma segura, capturando qualquer erro do Puppeteer/Chrome
async function safeDestroySession(session) {
  try { if (session.sophia) await session.sophia.close(); } catch (e) {}
  try { await session.account.logoff(); } catch (e) {}
  try {
    if (session.sigaa && session.sigaa.sigaaBrowser) {
      await session.sigaa.sigaaBrowser.close();
    }
  } catch (e) {}
  try { session.sigaa.close(); } catch (e) {}
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
      console.log(`[Sessao expirada] ${session.studentName || 'desconhecido'} (${sessions.size - 1} sessao(oes) ativa(s))`);
      sessions.delete(token);
      safeDestroySession(session).catch(() => {});
    }
  }
}, 60000);

async function withRetry(session, fn) {
  try {
    return await fn(session.account);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('session expired') || msg.includes('expirou') || msg.includes('viewexpiredexception')) {
      console.log(`[Reconectando] ${session.studentName || 'desconhecido'}`);
      session.account = await session.sigaa.login(session.username, session.password);
      return await fn(session.account);
    }
    throw err;
  }
}

// ════════════════════════════════════════════
//  POST /login
// ════════════════════════════════════════════
app.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    if (!usuario || !senha) {
      return res.status(400).json({ error: 'Informe "usuario" e "senha" no corpo da requisicao.' });
    }

    if (sessions.size >= MAX_SESSIONS) {
      return res.status(503).json({ error: `Limite de ${MAX_SESSIONS} sessoes simultaneas atingido. Tente novamente mais tarde.` });
    }

    const sigaa = new Sigaa({
      url: 'https://sigaa.ifsc.edu.br',
      institution: 'IFSC',
      browser: { debug: false, timeout: 60000 }
    });

    const account = await sigaa.login(usuario, senha);

    let studentName = '';
    try { studentName = await account.getName(); } catch (e) {}

    const token = generateToken();
    sessions.set(token, {
      sigaa,
      account,
      username: usuario,
      password: senha,
      studentName,
      lastAccess: Date.now()
    });

    console.log(`[Login] ${studentName || usuario} (${sessions.size} sessao(oes) ativa(s))`);

    res.json({
      token,
      nome: studentName || null,
      mensagem: 'Login realizado com sucesso. Use o token no header Authorization: Bearer <token>'
    });
  } catch (err) {
    res.status(401).json({ error: 'Falha no login. Verifique usuario e senha.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  POST /logout
// ════════════════════════════════════════════
app.post('/logout', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  const token = req.headers.authorization.slice(7);
  sessions.delete(token);

  await safeDestroySession(session);

  console.log(`[Logout] ${session.studentName || 'desconhecido'} (${sessions.size} sessao(oes) ativa(s))`);

  res.json({ mensagem: 'Sessao encerrada, navegador fechado e token revogado.' });
});

// ════════════════════════════════════════════
//  GET /conta
// ════════════════════════════════════════════
app.get('/conta', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const result = {};

      try { result.nome = await account.getName(); } catch (e) { result.nome = null; }
      try { result.emails = await account.getEmails(); } catch (e) { result.emails = []; }
      try { result.fotoUrl = String(await account.getProfilePictureURL() || ''); } catch (e) { result.fotoUrl = null; }

      const bond = await getStudentBond(account);
      if (bond) {
        result.matricula = bond.registration;
        result.curso = bond.program;
      }

      try {
        const http = session.sigaa.httpFactory.createHttp();
        const page = await http.get('/sigaa/portais/discente/discente.jsf');
        const $ = cheerio.load(page.bodyDecoded);

        result.indices = {};
        $('acronym').each(function () {
          const label = $(this).text().replace(':', '').trim();
          const title = $(this).attr('title') || '';
          const valueEl = $(this).parent().next('td').find('div');
          const value = valueEl.length ? valueEl.text().trim() : $(this).parent().next('td').text().trim();
          if (label && value) result.indices[label] = { descricao: title, valor: parseFloat(value) || value };
        });

        result.integralizacao = {};
        $('table').each(function () {
          $(this).find('tr').each(function () {
            const cells = $(this).find('td');
            if (cells.length >= 2) {
              const label = $(cells.eq(0)).text().trim();
              const value = $(cells.eq(1)).text().trim();
              if (label.startsWith('CH.')) result.integralizacao[label] = parseInt(value) || value;
            }
            const text = $(this).text().trim();
            const pm = text.match(/(\d+)%\s*Integralizado/);
            if (pm) result.integralizacao.percentual = parseInt(pm[1]);
          });
        });
      } catch (e) {}

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter informacoes da conta.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /disciplinas
// ════════════════════════════════════════════
app.get('/disciplinas', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const item = {
          titulo: course.title,
          semestre: course.period,
          horarios: parseSchedule(course.schedule),
          professores: []
        };

        try {
          const members = await course.getMembers();
          if (members.teachers) {
            item.professores = members.teachers.map(t => ({
              nome: t.name,
              departamento: t.department || null,
              email: t.email || null
            }));
          }
        } catch (e) {}

        result.push(item);
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter disciplinas.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /notas
// ════════════════════════════════════════════
app.get('/notas', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const gradesGroups = await course.getGrades();
        const grupos = [];

        for (const group of gradesGroups) {
          const g = { nome: group.name, tipo: group.type, valor: group.value ?? null, notas: [] };

          if (group.type === 'weighted-average' || group.type === 'sum-of-grades') {
            for (const grade of group.grades) {
              g.notas.push({
                nome: grade.name,
                valor: grade.value ?? null,
                peso: grade.weight ?? null
              });
            }
          }

          grupos.push(g);
        }

        result.push({ disciplina: course.title, semestre: course.period, grupos });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter notas.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /faltas
// ════════════════════════════════════════════
app.get('/faltas', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const absences = await course.getAbsence();
        result.push({
          disciplina: course.title,
          maximoFaltas: absences.maxAbsences,
          totalFaltas: absences.totalAbsences,
          detalhes: absences.list.map(a => ({
            data: formatDate(a.date),
            quantidade: a.numOfAbsences
          }))
        });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter faltas.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /atividades
// ════════════════════════════════════════════
app.get('/atividades', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const activities = await bond.getActivities();
      return activities.map(a => {
        const item = { tipo: a.type, data: formatDate(a.date), concluida: a.done };
        switch (a.type) {
          case 'homework': item.disciplina = a.courseTitle; item.titulo = a.homeworkTitle; break;
          case 'quiz': item.disciplina = a.courseTitle; item.titulo = a.quizTitle; break;
          case 'exam': item.disciplina = a.courseTitle; item.titulo = a.examDescription; break;
        }
        return item;
      });
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter atividades.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /tarefas
// ════════════════════════════════════════════
app.get('/tarefas', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const homeworks = await course.getHomeworks();
        if (homeworks.length === 0) continue;

        const tarefas = [];
        for (const hw of homeworks) {
          const t = {
            titulo: hw.title,
            inicio: formatDate(hw.startDate),
            termino: formatDate(hw.endDate),
            finalizado: hw.endDate instanceof Date && !isNaN(hw.endDate.getTime()) ? hw.endDate < new Date() : null
          };
          try { t.descricao = await hw.getDescription(); } catch (e) { t.descricao = null; }
          try { t.emGrupo = await hw.getFlagIsGroupHomework(); } catch (e) { t.emGrupo = null; }
          try { t.valeNota = await hw.getFlagHaveGrade(); } catch (e) { t.valeNota = null; }
          tarefas.push(t);
        }

        result.push({ disciplina: course.title, tarefas });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter tarefas.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /aulas
// ════════════════════════════════════════════
app.get('/aulas', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const lessons = await course.getLessons();
        if (lessons.length === 0) continue;

        result.push({
          disciplina: course.title,
          aulas: lessons.map(l => ({
            titulo: l.title,
            inicio: formatDate(l.startDate),
            fim: formatDate(l.endDate),
            conteudo: l.contentText || null,
            anexos: (l.attachments || []).map(a => ({ tipo: a.type, titulo: a.title }))
          }))
        });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter aulas.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /noticias
// ════════════════════════════════════════════
app.get('/noticias', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const newsList = await course.getNews();
        if (newsList.length === 0) continue;

        const noticias = [];
        for (const news of newsList) {
          const n = { titulo: news.title };
          try { n.conteudo = await news.getContent(); } catch (e) { n.conteudo = null; }
          try { n.data = formatDate(await news.getDate()); } catch (e) { n.data = null; }
          noticias.push(n);
        }

        result.push({ disciplina: course.title, noticias });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter noticias.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /arquivos
// ════════════════════════════════════════════
app.get('/arquivos', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const data = await withRetry(session, async (account) => {
      const bond = await getStudentBond(account);
      if (!bond) return [];

      const courses = await bond.getCourses();
      const result = [];

      for (const course of courses) {
        const files = await course.getFiles();
        if (files.length === 0) continue;

        result.push({
          disciplina: course.title,
          arquivos: files.map(f => ({
            titulo: f.title,
            descricao: f.description || null
          }))
        });
      }

      return result;
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter arquivos.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  POST /biblioteca/login
// ════════════════════════════════════════════
app.post('/biblioteca/login', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  try {
    const { senhaBiblioteca } = req.body;
    if (!senhaBiblioteca) {
      return res.status(400).json({ error: 'Informe "senhaBiblioteca" no corpo da requisicao.' });
    }

    const bond = await (async () => {
      const bonds = await session.account.getActiveBonds();
      for (const b of bonds) {
        if (b.type === 'student') return b;
      }
      return null;
    })();

    if (!bond) {
      return res.status(400).json({ error: 'Nao foi possivel obter a matricula do aluno.' });
    }

    const matricula = bond.registration;
    const browser = session.sigaa.sigaaBrowser.browser;
    const sophia = await loginSophia(browser, matricula, senhaBiblioteca);

    if (session.sophia) {
      await session.sophia.close();
    }
    session.sophia = sophia;

    console.log(`[Biblioteca] Login: ${session.studentName || session.username} (matricula: ${matricula})`);

    res.json({
      mensagem: 'Login na biblioteca realizado com sucesso.',
      matricula
    });
  } catch (err) {
    res.status(401).json({ error: 'Falha no login da biblioteca.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  GET /biblioteca/emprestimos
// ════════════════════════════════════════════
app.get('/biblioteca/emprestimos', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  if (!session.sophia || !session.sophia.loggedIn) {
    return res.status(400).json({ error: 'Nenhuma sessao da biblioteca ativa. Faca login em POST /biblioteca/login.' });
  }

  try {
    const emprestimos = await session.sophia.getEmprestimos();
    res.json({ emprestimos });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter emprestimos da biblioteca.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  POST /biblioteca/renovar
// ════════════════════════════════════════════
app.post('/biblioteca/renovar', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  if (!session.sophia || !session.sophia.loggedIn) {
    return res.status(400).json({ error: 'Nenhuma sessao da biblioteca ativa. Faca login em POST /biblioteca/login.' });
  }

  try {
    const { codigos } = req.body || {};
    const resultado = await session.sophia.renovar(codigos || []);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao renovar emprestimos.', detalhe: err.message });
  }
});

// ════════════════════════════════════════════
//  POST /biblioteca/logout
// ════════════════════════════════════════════
app.post('/biblioteca/logout', async (req, res) => {
  const session = getSession(req, res);
  if (!session) return;

  if (!session.sophia || !session.sophia.loggedIn) {
    return res.status(400).json({ error: 'Nenhuma sessao da biblioteca ativa.' });
  }

  await session.sophia.close();
  session.sophia = null;

  res.json({ mensagem: 'Sessao da biblioteca encerrada.' });
});

// ════════════════════════════════════════════
//  GET /status
// ════════════════════════════════════════════
app.get('/status', (req, res) => {
  res.json({
    servidor: 'online',
    sessoesAtivas: sessions.size,
    limiteMaximo: MAX_SESSIONS,
    timeoutMinutos: SESSION_TIMEOUT_MS / 60000
  });
});

// ════════════════════════════════════════════
//  GET /
// ════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    nome: 'SIGAA API',
    versao: '1.0.0',
    endpoints: {
      'POST /login': 'Login com usuario e senha. Retorna token.',
      'POST /logout': 'Encerra a sessao.',
      'GET /conta': 'Informacoes da conta, indices academicos e integralizacao.',
      'GET /disciplinas': 'Disciplinas do semestre com horarios e professores.',
      'GET /notas': 'Notas de todas as disciplinas.',
      'GET /faltas': 'Faltas detalhadas por disciplina.',
      'GET /atividades': 'Atividades pendentes.',
      'GET /tarefas': 'Tarefas com descricao e datas.',
      'GET /aulas': 'Aulas e conteudos.',
      'GET /noticias': 'Noticias das disciplinas.',
      'GET /arquivos': 'Lista de arquivos disponiveis.',
      'POST /biblioteca/login': 'Login na biblioteca SophiA (envie senhaBiblioteca).',
      'GET /biblioteca/emprestimos': 'Lista livros emprestados (Circ./Renovacao).',
      'POST /biblioteca/renovar': 'Renova emprestimos. Envie { codigos: ["78545"] } ou vazio para renovar todos.',
      'POST /biblioteca/logout': 'Encerra sessao da biblioteca.',
      'GET /status': 'Status do servidor.'
    },
    autenticacao: 'Envie o token no header: Authorization: Bearer <token>'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SIGAA API rodando na porta ${PORT}`);
  console.log(`  Sessoes simultaneas: max ${MAX_SESSIONS}`);
  console.log(`  Timeout de inatividade: ${SESSION_TIMEOUT_MS / 60000} minutos\n`);
});
