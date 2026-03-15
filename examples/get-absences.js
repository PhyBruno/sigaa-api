const { Sigaa } = require('../dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

// coloque seu usuário
const username = '';
const password = '';

function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'Data não informada';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const main = async () => {
  try {
    const account = await sigaa.login(username, password); // login

    /**
     * O usuário pode ter mais de um vínculo
     * @see https://github.com/GeovaneSchmitz/sigaa-api/issues/4
     **/
    const bonds = await account.getActiveBonds();

    //Para cada vínculo
    for (const bond of bonds) {
      if (bond.type !== 'student') continue; // O tipo pode ser student ou teacher

      //Se o tipo do vínculo for student, então tem matrícula e curso
      console.log('Matrícula do vínculo: ' + bond.registration);
      console.log('Curso do vínculo: ' + bond.program);

      // Se for usado bond.getCourses(true); todas as turmas são retornadas, incluindo turmas de outros semestres
      const courses = await bond.getCourses();

      // Para cada turma
      for (const course of courses) {
        console.log(' > ' + course.title);
        // Pega as faltas
        const absencesCourse = await course.getAbsence();
        console.log('Número máximo de faltas: ' + absencesCourse.maxAbsences);
        console.log('Número total de faltas: ' + absencesCourse.totalAbsences);
        if (absencesCourse.list.length > 0) {
          console.log('Detalhamento:');
          for (const absence of absencesCourse.list) {
            console.log('  ' + formatDate(absence.date) + ' - ' + absence.numOfAbsences + ' falta(s)');
          }
        } else {
          console.log('Nenhuma falta registrada.');
        }
        console.log('');
      }
    }

    // Encerra a sessão
    await account.logoff();
  } finally {
    sigaa.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
