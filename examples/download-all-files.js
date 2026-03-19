const { Sigaa } = require('../dist/sigaa-all-types');
const fs = require('fs');
const path = require('path');
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

const BaseDestiny = path.resolve('.', 'downloads');

fs.mkdirSync(BaseDestiny, { recursive: true });

const main = async () => {
  console.log('\n  === SIGAA - Download de Arquivos ===\n');
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

    const bonds = await account.getActiveBonds();

    for (const bond of bonds) {
      if (bond.type !== 'student') continue;

      console.log('Matrícula do vínculo: ' + bond.registration);
      console.log('Curso do vínculo: ' + bond.program);

      const courses = await bond.getCourses();

      for (const course of courses) {
        console.log(course.title);
        const files = await course.getFiles();
        if (files.length !== 0) {
          const pathCourse = path.join(BaseDestiny, course.period, course.title);
          await fs.promises.mkdir(pathCourse, { recursive: true });

          for (const file of files) {
            console.log('Nome do arquivo:' + file.title);

            const filepath = await file
              .download(pathCourse, (bytesDownloaded) => {
                const progress = Math.trunc(bytesDownloaded / 10) / 100 + 'kB';
                process.stdout.write('Progresso: ' + progress + '\r');
              })
              .catch((err) => {
                console.error(err);
              });
            console.log('Salvado em: ' + filepath);
            console.log('');
          }
          console.log('');
        }
      }
      if (bonds.length === 0) {
        console.log('O usuário não tem nenhum vínculo.');
      }
    }

    await account.logoff();
  } finally {
    sigaa.close();
    rl.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
