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

    console.log('> Nome: ' + (await account.getName()));
    console.log('> Url foto: ' + (await account.getProfilePictureURL()));

    // Encerra a sessão
    await account.logoff();
  } finally {
    sigaa.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
