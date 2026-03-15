const { Sigaa } = require('./dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

const username = 'bruno.e10';
const password = '@Bruno29011980';

const main = async () => {
  try {
    console.log('========================================');
    console.log('  TESTE COMPLETO - SIGAA API');
    console.log('========================================\n');

    console.log('[1/7] Fazendo login...');
    const account = await sigaa.login(username, password);
    console.log('Login OK!\n');

    console.log('[2/7] Buscando informacoes da conta...');
    try {
      const name = await account.getName();
      console.log('  Nome: ' + name);
    } catch (e) {
      console.log('  ERRO ao buscar nome: ' + e.message);
    }
    try {
      const photoUrl = await account.getProfilePictureURL();
      console.log('  Foto: ' + photoUrl);
    } catch (e) {
      console.log('  ERRO ao buscar foto: ' + e.message);
    }
    console.log('');

    console.log('[3/7] Buscando vinculos ativos...');
    const bonds = await account.getActiveBonds();
    console.log('  Vinculos encontrados: ' + bonds.length);
    for (const bond of bonds) {
      console.log('  Tipo: ' + bond.type + ', Matricula: ' + bond.registration + ', Curso: ' + bond.program);
    }
    console.log('');

    for (const bond of bonds) {
      if (bond.type !== 'student') continue;

      console.log('[4/7] Buscando disciplinas do vinculo ' + bond.registration + '...');
      try {
        const courses = await bond.getCourses();
        console.log('  Disciplinas encontradas: ' + courses.length);
        for (const course of courses) {
          console.log('  > ' + course.title);
          console.log('    Periodo: ' + course.period);
          console.log('    Horario: ' + course.schedule);
        }
      } catch (e) {
        console.log('  ERRO ao buscar disciplinas: ' + e.message);
      }
      console.log('');

      console.log('[5/7] Buscando notas...');
      try {
        const courses = await bond.getCourses();
        for (const course of courses) {
          console.log('  > ' + course.title);
          try {
            const gradesGroups = await course.getGrades();
            for (const group of gradesGroups) {
              console.log('    Grupo: ' + group.name + ' (tipo: ' + group.type + ')');
              if (group.type === 'weighted-average' || group.type === 'sum-of-grades') {
                for (const grade of group.grades) {
                  console.log('      ' + grade.name + ': ' + grade.value);
                }
              }
              console.log('      Media/Total: ' + group.value);
            }
          } catch (e) {
            console.log('    ERRO ao buscar notas: ' + e.message);
          }
        }
      } catch (e) {
        console.log('  ERRO geral notas: ' + e.message);
      }
      console.log('');

      console.log('[6/7] Buscando atividades...');
      try {
        const activities = await bond.getActivities();
        console.log('  Atividades encontradas: ' + activities.length);
        for (const activity of activities.slice(0, 5)) {
          const date = activity.date;
          const dateStr = date.getDate() + '/' + (date.getMonth() + 1) + '/' + date.getFullYear();
          switch (activity.type) {
            case 'homework':
              console.log('  [Tarefa] ' + activity.courseTitle + ' -> ' + activity.homeworkTitle + ' (' + dateStr + ')');
              break;
            case 'quiz':
              console.log('  [Quiz] ' + activity.courseTitle + ' -> ' + activity.quizTitle + ' (' + dateStr + ')');
              break;
            case 'exam':
              console.log('  [Prova] ' + activity.courseTitle + ' -> ' + activity.examDescription + ' (' + dateStr + ')');
              break;
          }
        }
        if (activities.length > 5) {
          console.log('  ... e mais ' + (activities.length - 5) + ' atividade(s)');
        }
      } catch (e) {
        console.log('  ERRO ao buscar atividades: ' + e.message);
      }
      console.log('');
    }

    console.log('[7/7] Fazendo logoff...');
    await account.logoff();
    console.log('Logoff OK!');

  } catch (e) {
    console.error('\nERRO FATAL: ' + e.message);
    console.error(e.stack);
  } finally {
    sigaa.close();
    console.log('\n========================================');
    console.log('  TESTE FINALIZADO');
    console.log('========================================');
  }
};

main();
