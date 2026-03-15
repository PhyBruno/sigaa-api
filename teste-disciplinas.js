const { Sigaa } = require('./dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

const username = 'SEU_USUARIO';
const password = 'SUA_SENHA';

const main = async () => {
  console.log('=== Iniciando login ===');
  const account = await sigaa.login(username, password);
  console.log('Login realizado com sucesso!\n');

  console.log('=== Buscando vínculos ativos ===');
  const bonds = await account.getActiveBonds();
  console.log(`Encontrados ${bonds.length} vínculo(s)\n`);

  for (const bond of bonds) {
    if (bond.type !== 'student') {
      console.log(`Vínculo ignorado (tipo: ${bond.type})`);
      continue;
    }

    console.log('---------------------------------------');
    console.log(`Matrícula: ${bond.registration}`);
    console.log(`Curso: ${bond.program}`);

    try {
      const period = await bond.getCurrentPeriod();
      console.log(`Período atual: ${period}`);
    } catch (e) {
      console.log('Período atual: não disponível');
    }

    console.log('\n=== Disciplinas matriculadas ===\n');

    const courses = await bond.getCourses();

    if (courses.length === 0) {
      console.log('Nenhuma disciplina encontrada no período atual.');
    }

    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      console.log(`${i + 1}. ${course.title}`);
      console.log(`   Código: ${course.code}`);
      console.log(`   Período: ${course.period}`);
      console.log(`   Horário: ${course.schedule}`);
      console.log('');
    }

    console.log(`Total: ${courses.length} disciplina(s)`);
    console.log('---------------------------------------');
  }

  console.log('\n=== Encerrando sessão ===');
  await account.logoff();
  console.log('Sessão encerrada.');
};

main().catch((err) => {
  console.error('Erro:', err.message || err);
  sigaa.close();
  process.exit(1);
});
