const { Sigaa } = require('../dist/sigaa-all-types');
const { loginSophia } = require('../sophia-library');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

const username = '';
const password = '';
const senhaBiblioteca = '';

const main = async () => {
  try {
    const account = await sigaa.login(username, password);
    console.log('Login no SIGAA realizado com sucesso.');

    const bonds = await account.getActiveBonds();
    let matricula = '';
    for (const bond of bonds) {
      if (bond.type === 'student') {
        matricula = bond.registration;
        console.log('Matricula: ' + matricula);
        break;
      }
    }

    if (!matricula) {
      console.log('Nenhum vinculo de aluno encontrado.');
      return;
    }

    const browser = sigaa.sigaaBrowser.browser;
    const sophia = await loginSophia(browser, matricula, senhaBiblioteca);
    console.log('Login na biblioteca SophiA realizado com sucesso.\n');

    console.log('=== Livros emprestados ===\n');
    const emprestimos = await sophia.getEmprestimos();

    if (emprestimos.length === 0) {
      console.log('Nenhum emprestimo encontrado.');
    } else {
      for (const livro of emprestimos) {
        console.log(`  #${livro.numero} - ${livro.titulo}`);
        console.log(`    Codigo: ${livro.codigo}`);
        console.log(`    Chamada: ${livro.chamada}`);
        console.log(`    Biblioteca: ${livro.biblioteca}`);
        console.log(`    Data saida: ${livro.dataSaida}`);
        console.log(`    Data prevista: ${livro.dataPrevista}`);
        console.log('');
      }
    }

    console.log('=== Renovando todos os livros ===\n');
    const resultado = await sophia.renovar([]);
    console.log('Sucesso:', resultado.sucesso);
    console.log('Mensagem:', resultado.mensagem);

    await sophia.close();
    await account.logoff();
  } finally {
    sigaa.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
