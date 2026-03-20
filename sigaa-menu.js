const { Sigaa } = require('./dist/sigaa-all-types');
const cheerio = require('cheerio');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { loginSophia } = require('./sophia-library');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = '';
    const onData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw);
        process.stdout.write('\n');
        resolve(input);
      } else if (c === '\u0003') {
        process.exit();
      } else if (c === '\u007F' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function cls() {
  process.stdout.write('\x1B[2J\x1B[0f');
}

function line() {
  console.log('════════════════════════════════════════════════════════');
}

function header(title) {
  cls();
  line();
  console.log('  ' + title);
  line();
  console.log('');
}

function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'Data nao informada';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const dayNames = { '2': 'Segunda', '3': 'Terca', '4': 'Quarta', '5': 'Quinta', '6': 'Sexta', '7': 'Sabado' };
const turnNames = { 'M': 'pela manha', 'T': 'a tarde', 'N': 'a noite' };

function parseScheduleBlock(block) {
  const match = block.match(/^(\d+)([MTN])(\d+)$/);
  if (!match) return null;
  return { days: match[1].split(''), turn: match[2], slots: match[3].split('') };
}

function formatSlots(slots) {
  if (slots.length === 1) return slots[0] + 'a aula';
  return slots.slice(0, -1).join('a, ') + 'a e ' + slots[slots.length - 1] + 'a aula';
}

function formatSchedule(scheduleStr) {
  if (!scheduleStr) return [];
  const clean = scheduleStr.replace(/\(.*\)/, '').trim();
  const blocks = clean.split(/\s+/);
  const result = [];
  for (const block of blocks) {
    const parsed = parseScheduleBlock(block);
    if (!parsed) continue;
    for (const dayCode of parsed.days) {
      const dayName = dayNames[dayCode] || ('Dia ' + dayCode);
      const turnName = turnNames[parsed.turn] || parsed.turn;
      result.push(`${dayName} ${turnName}, ${formatSlots(parsed.slots)}`);
    }
  }
  return result;
}

function parseAcademicIndices($) {
  const indices = {};
  $('acronym').each(function () {
    const label = $(this).text().replace(':', '').trim();
    const title = $(this).attr('title') || '';
    const valueEl = $(this).parent().next('td').find('div');
    const value = valueEl.length ? valueEl.text().trim() : $(this).parent().next('td').text().trim();
    if (label && value) indices[label] = { title, value };
  });
  return indices;
}

function parseIntegration($) {
  const integration = {};
  $('table').each(function () {
    $(this).find('tr').each(function () {
      const cells = $(this).find('td');
      if (cells.length >= 2) {
        const label = $(cells.eq(0)).text().trim();
        const value = $(cells.eq(1)).text().trim();
        if (label.startsWith('CH.')) integration[label] = value;
      }
      const text = $(this).text().trim();
      const percentMatch = text.match(/(\d+)%\s*Integralizado/);
      if (percentMatch) integration['Percentual Integralizado'] = percentMatch[1] + '%';
    });
  });
  return integration;
}

async function pause() {
  await ask('\nPressione ENTER para voltar ao menu...');
}

async function getStudentBond(account) {
  const bonds = await account.getActiveBonds();
  for (const bond of bonds) {
    if (bond.type === 'student') return bond;
  }
  return null;
}

// ═══════════════════════════════════════════════════════
//  OPCAO 1: Informacoes da Conta
// ═══════════════════════════════════════════════════════
async function showAccountInfo(sigaa, account) {
  header('INFORMACOES DA CONTA');
  console.log('  Carregando...\n');

  try { console.log('  Nome: ' + (await account.getName())); } catch (e) { console.log('  Nome: Nao disponivel'); }
  try {
    const emails = await account.getEmails();
    if (emails.length > 0) console.log('  E-mails: ' + emails.join(', '));
  } catch (e) {}

  const bond = await getStudentBond(account);
  if (bond) {
    console.log('  Matricula: ' + bond.registration);
    console.log('  Curso: ' + bond.program);
  }

  try {
    const http = sigaa.httpFactory.createHttp();
    const page = await http.get('/sigaa/portais/discente/discente.jsf');
    const $ = cheerio.load(page.bodyDecoded);

    const indices = parseAcademicIndices($);
    if (Object.keys(indices).length > 0) {
      console.log('\n  --- Indices Academicos ---');
      for (const [label, info] of Object.entries(indices)) {
        console.log(`  ${label} (${info.title}): ${info.value}`);
      }
    }

    const integration = parseIntegration($);
    if (Object.keys(integration).length > 0) {
      console.log('\n  --- Integralizacoes ---');
      for (const [label, value] of Object.entries(integration)) {
        console.log(`  ${label}: ${value}`);
      }
    }
  } catch (e) {
    console.log('  Nao foi possivel carregar indices academicos.');
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 2: Disciplinas e Professores
// ═══════════════════════════════════════════════════════
async function showCourses(account) {
  header('DISCIPLINAS E PROFESSORES');
  console.log('  Carregando disciplinas...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();
  if (courses.length === 0) { console.log('  Nenhuma disciplina encontrada.'); await pause(); return; }

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    console.log(`  ${i + 1}. ${course.title}`);
    console.log(`     Semestre: ${course.period}`);

    const scheduleLines = formatSchedule(course.schedule);
    if (scheduleLines.length > 0) {
      console.log('     Horarios:');
      for (const s of scheduleLines) console.log('       - ' + s);
    }

    try {
      const members = await course.getMembers();
      if (members.teachers && members.teachers.length > 0) {
        for (const t of members.teachers) {
          let info = '     Professor: ' + t.name;
          if (t.department) info += ' (' + t.department + ')';
          console.log(info);
        }
      }
    } catch (e) {}

    console.log('');
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 3: Notas
// ═══════════════════════════════════════════════════════
async function showGrades(account) {
  header('NOTAS');
  console.log('  Carregando notas...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();

  for (const course of courses) {
    console.log(`  ${course.title}`);
    const gradesGroups = await course.getGrades();

    if (gradesGroups.length === 0) {
      console.log('    Sem notas registradas.\n');
      continue;
    }

    for (const group of gradesGroups) {
      console.log(`    ${group.name}:`);
      switch (group.type) {
        case 'only-average':
          console.log('      Nota: ' + (group.value !== undefined ? group.value : 'Nao contabilizado'));
          break;
        case 'weighted-average':
          for (const grade of group.grades) {
            const val = grade.value !== undefined ? grade.value : 'Nao contabilizado';
            console.log(`      ${grade.name}: ${val} (peso: ${grade.weight})`);
          }
          console.log('      Media: ' + (group.value !== undefined ? group.value : 'Nao contabilizado'));
          break;
        case 'sum-of-grades':
          for (const grade of group.grades) {
            const val = grade.value !== undefined ? grade.value : 'Nao contabilizado';
            console.log(`      ${grade.name}: ${val} (max: ${grade.maxValue})`);
          }
          console.log('      Soma: ' + (group.value !== undefined ? group.value : 'Nao contabilizado'));
          break;
      }
    }
    console.log('');
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 4: Faltas
// ═══════════════════════════════════════════════════════
async function showAbsences(account) {
  header('FALTAS');
  console.log('  Carregando faltas...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();

  for (const course of courses) {
    console.log(`  ${course.title}`);
    const absences = await course.getAbsence();
    console.log(`    Maximo de faltas permitidas: ${absences.maxAbsences}`);
    console.log(`    Total de faltas: ${absences.totalAbsences}`);

    if (absences.list.length > 0) {
      for (const a of absences.list) {
        console.log(`    ${formatDate(a.date)} - ${a.numOfAbsences} falta(s)`);
      }
    } else {
      console.log('    Nenhuma falta registrada.');
    }
    console.log('');
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 5: Atividades Pendentes
// ═══════════════════════════════════════════════════════
async function showActivities(account) {
  header('ATIVIDADES PENDENTES');
  console.log('  Carregando atividades...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const activities = await bond.getActivities();

  if (activities.length === 0) {
    console.log('  Nenhuma atividade pendente.');
    await pause();
    return;
  }

  for (const activity of activities) {
    let title = '';
    switch (activity.type) {
      case 'homework': title = `${activity.courseTitle} - ${activity.homeworkTitle}`; break;
      case 'quiz': title = `${activity.courseTitle} - ${activity.quizTitle}`; break;
      case 'exam': title = `${activity.courseTitle} - ${activity.examDescription}`; break;
    }
    console.log(`  ${title}`);
    console.log(`    Data: ${formatDate(activity.date)}`);
    console.log(`    Situacao: ${activity.done ? 'Concluida' : 'Pendente'}`);
    console.log('');
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 6: Tarefas (Homework)
// ═══════════════════════════════════════════════════════
async function showHomework(account) {
  header('TAREFAS');
  console.log('  Carregando tarefas...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();
  let found = false;

  for (const course of courses) {
    const homeworks = await course.getHomeworks();
    if (homeworks.length === 0) continue;
    found = true;

    console.log(`  ${course.title}`);
    for (const hw of homeworks) {
      console.log(`    ${hw.title}`);
      try { console.log(`      Descricao: ${await hw.getDescription()}`); } catch (e) {}
      try {
        const isGroup = await hw.getFlagIsGroupHomework();
        console.log(`      Tipo: ${isGroup ? 'Em grupo' : 'Individual'}`);
      } catch (e) {}
      try {
        const hasGrade = await hw.getFlagHaveGrade();
        console.log(`      Vale nota: ${hasGrade ? 'Sim' : 'Nao'}`);
      } catch (e) {}
      console.log(`      Inicio: ${formatDate(hw.startDate)}`);
      console.log(`      Termino: ${formatDate(hw.endDate)}`);
      console.log('');
    }
  }

  if (!found) console.log('  Nenhuma tarefa encontrada.');
  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 7: Aulas
// ═══════════════════════════════════════════════════════
async function showLessons(account) {
  header('AULAS');
  console.log('  Carregando aulas...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();

  for (const course of courses) {
    const lessons = await course.getLessons();
    if (lessons.length === 0) continue;

    console.log(`  ${course.title}`);
    for (const lesson of lessons) {
      console.log(`    ${lesson.title}`);
      console.log(`      Periodo: ${formatDate(lesson.startDate)} a ${formatDate(lesson.endDate)}`);
      if (lesson.contentText) {
        const content = lesson.contentText.substring(0, 200);
        console.log(`      Conteudo: ${content}${lesson.contentText.length > 200 ? '...' : ''}`);
      }
      if (lesson.attachments && lesson.attachments.length > 0) {
        console.log(`      Anexos: ${lesson.attachments.map(a => a.title).join(', ')}`);
      }
      console.log('');
    }
  }

  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 8: Noticias
// ═══════════════════════════════════════════════════════
async function showNews(account) {
  header('NOTICIAS DAS DISCIPLINAS');
  console.log('  Carregando noticias...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();
  let found = false;

  for (const course of courses) {
    const newsList = await course.getNews();
    if (newsList.length === 0) continue;
    found = true;

    console.log(`  ${course.title}`);
    for (const news of newsList) {
      console.log(`    ${news.title}`);
      try {
        const content = await news.getContent();
        if (content) {
          console.log(`      ${content}`);
        }
      } catch (e) {}
      try {
        const date = await news.getDate();
        console.log(`      Data: ${formatDate(date)}`);
      } catch (e) {}
      console.log('');
    }
  }

  if (!found) console.log('  Nenhuma noticia encontrada.');
  await pause();
}

// ═══════════════════════════════════════════════════════
//  OPCAO 9: Baixar Arquivos
// ═══════════════════════════════════════════════════════
async function downloadFiles(account) {
  header('BAIXAR ARQUIVOS DAS DISCIPLINAS');

  const downloadDir = path.resolve('.', 'downloads');
  console.log(`  Os arquivos serao salvos em: ${downloadDir}\n`);
  console.log('  Carregando...\n');

  const bond = await getStudentBond(account);
  if (!bond) { console.log('  Nenhum vinculo de aluno encontrado.'); await pause(); return; }

  const courses = await bond.getCourses();
  let totalFiles = 0;
  let totalErrors = 0;

  for (const course of courses) {
    const files = await course.getFiles();
    if (files.length === 0) continue;

    const courseDir = path.join(downloadDir, course.period, course.title);
    fs.mkdirSync(courseDir, { recursive: true });

    console.log(`  ${course.title} (${files.length} arquivo(s))`);

    for (const file of files) {
      process.stdout.write(`    Baixando: ${file.title}...`);
      try {
        const filepath = await file.download(courseDir);
        console.log(' OK');
        console.log(`      Salvo em: ${filepath}`);
        totalFiles++;
      } catch (err) {
        console.log(' ERRO');
        totalErrors++;
      }
    }
    console.log('');
  }

  console.log(`  Concluido! ${totalFiles} arquivo(s) baixado(s), ${totalErrors} erro(s).`);
  await pause();
}

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  OPCAO 10: Biblioteca (SophiA)
// ═══════════════════════════════════════════════════════
let sophiaSession = null;

async function showSophiaEmprestimos() {
  header('BIBLIOTECA - EMPRESTIMOS');
  console.log('  Carregando circulacoes abertas...\n');

  try {
    const emprestimos = await sophiaSession.getEmprestimos();
    if (emprestimos.length === 0) {
      console.log('  Nenhum emprestimo encontrado.');
    } else {
      console.log('  #   Titulo                                  Codigo   Data prevista');
      console.log('  ' + '-'.repeat(72));
      for (const livro of emprestimos) {
        const num = (livro.numero || '').padEnd(3);
        const titulo = (livro.titulo || '').substring(0, 38).padEnd(38);
        const cod = (livro.codigo || '').padEnd(8);
        const data = livro.dataPrevista || '';
        console.log(`  ${num} ${titulo} ${cod} ${data}`);
      }
      console.log('');
      console.log(`  Total: ${emprestimos.length} livro(s)`);
    }
  } catch (err) {
    console.log('  Erro ao obter emprestimos: ' + (err.message || err));
  }

  await pause();
}

async function showSophiaRenovar() {
  header('BIBLIOTECA - RENOVAR');
  console.log('  Carregando circulacoes abertas...\n');

  try {
    const emprestimos = await sophiaSession.getEmprestimos();
    if (emprestimos.length === 0) {
      console.log('  Nenhum emprestimo encontrado para renovar.');
      await pause();
      return;
    }

    for (const livro of emprestimos) {
      console.log(`  ${livro.numero}. ${livro.titulo} (Cod: ${livro.codigo}, Previsto: ${livro.dataPrevista})`);
    }

    console.log('');
    console.log('  Digite os codigos separados por virgula para renovar,');
    console.log('  ou deixe vazio para renovar todos.');
    console.log('');
    const input = await ask('  Codigos (ou ENTER para todos): ');

    const codigos = input.trim()
      ? input.split(',').map(c => c.trim()).filter(c => c)
      : [];

    const label = codigos.length > 0
      ? `${codigos.length} livro(s) selecionado(s)`
      : 'todos os livros';
    console.log(`\n  Renovando ${label}, aguarde...\n`);

    const resultado = await sophiaSession.renovar(codigos);

    if (resultado.sucesso) {
      console.log('  Renovacao realizada com sucesso!');
    } else {
      console.log('  A renovacao pode nao ter sido concluida.');
    }

    if (resultado.usuario) console.log(`\n  Usuario: ${resultado.usuario}`);
    if (resultado.matricula) console.log(`  Matricula: ${resultado.matricula}`);

    const r = resultado.recibo || {};
    const temDados = r.codigoRenovacao || r.titulo || r.dataSaida || r.prevDevolucao;

    if (temDados) {
      console.log('\n  --- Recibo de Renovacao ---');
      if (r.codigoRenovacao) console.log(`  Cod. renovacao: ${r.codigoRenovacao}`);
      if (r.titulo) console.log(`  Titulo: ${r.titulo}`);
      if (r.biblioteca) console.log(`  Biblioteca: ${r.biblioteca}`);
      if (r.chamada) console.log(`  N. de chamada: ${r.chamada}`);
      if (r.exemplar) console.log(`  Exemplar: ${r.exemplar}`);
      if (r.dataSaida) console.log(`  Data de saida: ${r.dataSaida}`);
      if (r.prevDevolucao) console.log(`  Prev. Devolucao: ${r.prevDevolucao}`);
    } else {
      console.log('\n  Recibo nao disponivel ou pagina ainda carregando.');
      if (resultado._raw) console.log(`  Trecho da pagina: ${resultado._raw.substring(0, 200)}`);
    }
  } catch (err) {
    console.log('  Erro ao renovar: ' + (err.message || err));
  }

  await pause();
}

async function showSophiaMenu(sigaa, account) {
  if (!sophiaSession || !sophiaSession.loggedIn) {
    header('BIBLIOTECA (SophiA) - LOGIN');

    const bond = await getStudentBond(account);
    if (!bond) {
      console.log('  Nao foi possivel obter a matricula do aluno.');
      await pause();
      return;
    }

    const matricula = bond.registration;
    console.log('  Matricula detectada: ' + matricula);
    console.log('');
    console.log('  A senha da biblioteca NAO e a mesma do SIGAA.');
    const senhaBiblioteca = await askHidden('  Senha da biblioteca: ');

    console.log('\n  Conectando a biblioteca SophiA, aguarde...\n');

    try {
      const browser = sigaa.sigaaBrowser.browser;
      sophiaSession = await loginSophia(browser, matricula, senhaBiblioteca);
      console.log('  Login realizado com sucesso!\n');
    } catch (err) {
      console.log('  Erro ao fazer login na biblioteca: ' + (err.message || err));
      await pause();
      return;
    }
  }

  let inLibrary = true;
  while (inLibrary) {
    cls();
    line();
    console.log('  BIBLIOTECA (SophiA)');
    line();
    console.log('');
    console.log('  1. Ver emprestimos (livros comigo)');
    console.log('  2. Renovar emprestimos');
    console.log('  3. Encerrar sessao da biblioteca');
    console.log('  0. Voltar ao menu principal');
    console.log('');
    line();

    const choice = await ask('  Escolha uma opcao: ');

    try {
      switch (choice.trim()) {
        case '1':
          await showSophiaEmprestimos();
          break;
        case '2':
          await showSophiaRenovar();
          break;
        case '3':
          await sophiaSession.close();
          sophiaSession = null;
          console.log('\n  Sessao da biblioteca encerrada.');
          await new Promise(r => setTimeout(r, 1500));
          inLibrary = false;
          break;
        case '0':
          inLibrary = false;
          break;
        default:
          console.log('\n  Opcao invalida.');
          await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.log('\n  Erro: ' + (err.message || err));
      await pause();
    }
  }
}

//  MENU PRINCIPAL
// ═══════════════════════════════════════════════════════
async function showMenu() {
  cls();
  line();
  console.log('  SIGAA - Menu do Aluno');
  line();
  console.log('');
  console.log('  1. Informacoes da conta e indices academicos');
  console.log('  2. Disciplinas e professores');
  console.log('  3. Notas');
  console.log('  4. Faltas');
  console.log('  5. Atividades pendentes');
  console.log('  6. Tarefas');
  console.log('  7. Aulas');
  console.log('  8. Noticias');
  console.log('  9. Baixar arquivos das disciplinas');
  console.log('  10. Biblioteca (SophiA)');
  console.log('  0. Sair');
  console.log('');
  line();
}

async function main() {
  cls();
  line();
  console.log('  SIGAA - Sistema Academico');
  line();
  console.log('');

  const username = await ask('  Usuario: ');
  const password = await askHidden('  Senha: ');

  console.log('\n  Conectando ao SIGAA, aguarde...\n');

  const sigaa = new Sigaa({
    url: 'https://sigaa.ifsc.edu.br',
    institution: 'IFSC',
    browser: { debug: false, timeout: 60000 }
  });

  async function doLogin() {
    return await sigaa.login(username, password);
  }

  let account;
  try {
    account = await doLogin();
  } catch (err) {
    console.log('\n  Erro ao fazer login. Verifique seu usuario e senha.');
    console.log('  Detalhes: ' + (err.message || err));
    rl.close();
    sigaa.close();
    return;
  }

  let studentName = '';
  try { studentName = await account.getName(); } catch (e) {}

  function isSessionExpired(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('session expired') ||
           msg.includes('expirou') ||
           msg.includes('viewexpiredexception') ||
           msg.includes('err_aborted');
  }

  async function runWithRetry(fn) {
    try {
      await fn(account);
    } catch (err) {
      if (isSessionExpired(err)) {
        console.log('\n  Sessao expirada. Reconectando automaticamente...\n');
        try {
          account = await doLogin();
          try { studentName = await account.getName(); } catch (e) {}
          console.log('  Reconectado! Executando novamente...\n');
          await fn(account);
        } catch (retryErr) {
          console.log('\n  Nao foi possivel reconectar.');
          console.log('  ' + (retryErr.message || retryErr));
          await pause();
        }
      } else {
        throw err;
      }
    }
  }

  let running = true;
  while (running) {
    showMenu();
    if (studentName) console.log(`  Logado como: ${studentName}\n`);
    const choice = await ask('  Escolha uma opcao: ');

    try {
      switch (choice.trim()) {
        case '1': await runWithRetry((acc) => showAccountInfo(sigaa, acc)); break;
        case '2': await runWithRetry(showCourses); break;
        case '3': await runWithRetry(showGrades); break;
        case '4': await runWithRetry(showAbsences); break;
        case '5': await runWithRetry(showActivities); break;
        case '6': await runWithRetry(showHomework); break;
        case '7': await runWithRetry(showLessons); break;
        case '8': await runWithRetry(showNews); break;
        case '9': await runWithRetry(downloadFiles); break;
        case '10': await runWithRetry((acc) => showSophiaMenu(sigaa, acc)); break;
        case '0':
          running = false;
          break;
        default:
          console.log('\n  Opcao invalida. Tente novamente.');
          await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.log('\n  Ocorreu um erro ao executar essa opcao.');
      console.log('  ' + (err.message || err));
      await pause();
    }
  }

  console.log('\n  Encerrando sessao...');
  if (sophiaSession) {
    try { await sophiaSession.close(); } catch (e) {}
    sophiaSession = null;
  }
  try { await account.logoff(); } catch (e) {}
  sigaa.close();
  rl.close();
  console.log('  Ate logo!\n');
}

main().catch((err) => {
  console.error('Erro inesperado: ' + (err.message || err));
  process.exit(1);
});
