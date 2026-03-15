const { Sigaa } = require('../dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

// coloque seu usuário
const username = '';
const password = '';

// NOTA: Com a nova arquitetura baseada em browser, cada instância Sigaa
// abre um browser real (headless=false com Xvfb). Buscar notas
// simultaneamente com múltiplas instâncias é muito pesado em recursos.
// Este exemplo agora busca as notas sequencialmente com uma única sessão.

const main = async () => {
  try {
    const account = await sigaa.login(username, password); // login

    /**
     * O usuário pode ter mais de um vínculo
     * @see https://github.com/GeovaneSchmitz/sigaa-api/issues/4
     **/
    const bonds = await account.getActiveBonds(); // pega os vinculos ativos

    //Para cada vínculo
    for (const bond of bonds) {
      if (bond.type !== 'student') continue; // O tipo pode ser student ou teacher

      //Se o tipo do vínculo for student, então tem matrícula e curso
      console.log('Matrícula do vínculo: ' + bond.registration);
      console.log('Curso do vínculo: ' + bond.program);

      // Se for usado bond.getCourses(true); todas as turmas são retornadas, incluindo turmas de outros semestres
      const courses = await bond.getCourses(); // pega as turmas do vínculo

      for (const course of courses) {
        console.log(' > ' + course.title);
        const gradesGroups = await course.getGrades();
        for (const gradesGroup of gradesGroups) {
          console.log('-> ' + gradesGroup.name);
          switch (
            gradesGroup.type //Existem 3 tipos de grupos de notas
          ) {
            case 'only-average':
              console.log(gradesGroup.value !== undefined ? gradesGroup.value : 'Não contabilizado');
              break;

            case 'weighted-average':
              for (const grade of gradesGroup.grades) {
                console.log('-' + grade.name);
                console.log('peso: ' + grade.weight);
                console.log(grade.value !== undefined ? grade.value : 'Não contabilizado');
              }
              console.log('média: ' + (gradesGroup.value !== undefined ? gradesGroup.value : 'Não contabilizado'));
              break;

            case 'sum-of-grades':
              for (const grade of gradesGroup.grades) {
                console.log('-' + grade.name);
                console.log('Valor máximo: ' + grade.maxValue);
                console.log(grade.value !== undefined ? grade.value : 'Não contabilizado');
              }
              console.log('soma: ' + (gradesGroup.value !== undefined ? gradesGroup.value : 'Não contabilizado'));
              break;
          }
        }
        console.log(''); // Para espaçar as linhas
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
