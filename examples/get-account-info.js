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

    console.log('========================================');
    console.log('  INFORMAÇÕES DA CONTA');
    console.log('========================================\n');

    // Nome do usuário
    try {
      console.log('Nome: ' + (await account.getName()));
    } catch (e) {
      console.log('Nome: Não disponível (' + e.message + ')');
    }

    // E-mails
    try {
      const emails = await account.getEmails();
      if (emails.length > 0) {
        console.log('E-mails: ' + emails.join(', '));
      } else {
        console.log('E-mails: Nenhum cadastrado');
      }
    } catch (e) {
      console.log('E-mails: Não disponível (' + e.message + ')');
    }

    // Foto de perfil
    try {
      const photoUrl = await account.getProfilePictureURL();
      console.log('Foto de perfil: ' + (photoUrl ? photoUrl : 'Sem foto'));
    } catch (e) {
      console.log('Foto de perfil: Não disponível');
    }

    // Vínculos (matrícula e curso)
    console.log('\n--- Vínculos ---');
    const bonds = await account.getActiveBonds();
    if (bonds.length === 0) {
      console.log('Nenhum vínculo ativo encontrado.');
    } else {
      for (const bond of bonds) {
        console.log('  Tipo: ' + bond.type);
        if (bond.type === 'student') {
          console.log('  Matrícula: ' + bond.registration);
          console.log('  Curso: ' + bond.program);
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
