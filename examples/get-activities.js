const { Sigaa } = require('../dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

// coloque seu usuário
const username = '';
const password = '';

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

      console.log('Matrícula do vínculo: ' + bond.registration);
      console.log('Curso do vínculo: ' + bond.program);
      const activities = await bond.getActivities();

      for (const activity of activities) {
        const date = activity.date;

        switch (activity.type) {
          case 'homework':
            console.log(`${activity.courseTitle} -> ${activity.homeworkTitle}`);
            break;
          case 'quiz':
            console.log(`${activity.courseTitle} -> ${activity.quizTitle}`);
            break;
          case 'exam':
            console.log(`${activity.courseTitle} -> ${activity.examDescription}`);
            break;
        }

        //Data da atividade
        console.log(
          `Data: ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`
        );

        // Retorna verdadeiro se a atividade já foi entregue ou se o prazo da atividade já terminou
        console.log(`Entregue: ${activity.done}`);

        console.log(' '); // Para melhorar a leitura
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
