const { Sigaa } = require('../dist/sigaa-all-types');
const cheerio = require('cheerio');
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

function parseAcademicIndices($) {
  const indices = {};
  $('acronym').each(function () {
    const label = $(this).text().replace(':', '').trim();
    const title = $(this).attr('title') || '';
    const valueEl = $(this).parent().next('td').find('div');
    const value = valueEl.length ? valueEl.text().trim() : $(this).parent().next('td').text().trim();
    if (label && value) {
      indices[label] = { title, value };
    }
  });
  return indices;
}

function parseIntegration($) {
  const integration = {};
  const html = $.html();
  const integrationMatch = html.indexOf('Integraliza');
  if (integrationMatch === -1) return integration;

  const tables = $('table');
  tables.each(function () {
    const rows = $(this).find('tr');
    let isIntegrationTable = false;
    rows.each(function () {
      const cells = $(this).find('td');
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();
        if (label.startsWith('CH.')) {
          isIntegrationTable = true;
          integration[label] = value;
        }
      }
      if (cells.length === 1 || cells.length === 2) {
        const text = $(this).text().trim();
        const percentMatch = text.match(/(\d+)%\s*Integralizado/);
        if (percentMatch) {
          integration['Percentual Integralizado'] = percentMatch[1] + '%';
        }
      }
    });
  });
  return integration;
}

const main = async () => {
  console.log('\n  === SIGAA - Informacoes da Conta ===\n');
  const username = await ask('  Usuario: ');
  const password = await askHidden('  Senha: ');
  console.log('\n  Conectando...\n');

  const sigaa = new Sigaa({
    url: 'https://sigaa.ifsc.edu.br',
    institution: 'IFSC',
    browser: { debug: true, timeout: 60000 }
  });

  try {
    const account = await sigaa.login(username, password);

    console.log('========================================');
    console.log('  INFORMAÇÕES DA CONTA');
    console.log('========================================\n');

    try {
      console.log('Nome: ' + (await account.getName()));
    } catch (e) {
      console.log('Nome: Não disponível');
    }

    try {
      const emails = await account.getEmails();
      if (emails.length > 0) {
        console.log('E-mails: ' + emails.join(', '));
      }
    } catch (e) {}

    try {
      const photoUrl = await account.getProfilePictureURL();
      console.log('Foto de perfil: ' + (photoUrl ? photoUrl : 'Sem foto'));
    } catch (e) {}

    console.log('\n--- Vínculos ---');
    const bonds = await account.getActiveBonds();
    for (const bond of bonds) {
      if (bond.type === 'student') {
        console.log('Matrícula: ' + bond.registration);
        console.log('Curso: ' + bond.program);
      }
    }

    const http = sigaa.httpFactory.createHttp();
    const page = await http.get('/sigaa/portais/discente/discente.jsf');
    const $ = cheerio.load(page.bodyDecoded);

    const indices = parseAcademicIndices($);
    if (Object.keys(indices).length > 0) {
      console.log('\n--- Índices Acadêmicos ---');
      for (const [label, info] of Object.entries(indices)) {
        console.log(`${label} (${info.title}): ${info.value}`);
      }
    }

    const integration = parseIntegration($);
    if (Object.keys(integration).length > 0) {
      console.log('\n--- Integralizações ---');
      for (const [label, value] of Object.entries(integration)) {
        console.log(`${label}: ${value}`);
      }
    }

    console.log('');
    await account.logoff();
  } finally {
    sigaa.close();
    rl.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
