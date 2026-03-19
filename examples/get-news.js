const { Sigaa } = require('../dist/sigaa-all-types');
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

const main = async () => {
  console.log('\n  === SIGAA - Noticias ===\n');
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
        const newsList = await course.getNews();
        for (const news of newsList) {
          console.log(news.title);
          console.log('id:' + news.id);

          console.log(await news.getContent());
          console.log((await news.getDate()).toString());
          console.log('');
        }
        console.log('');
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
