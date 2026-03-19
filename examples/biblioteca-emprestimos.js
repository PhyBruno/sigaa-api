const { Sigaa } = require('../dist/sigaa-all-types');
const { loginSophia } = require('../sophia-library');
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
    if (ch === '\n' || ch === '\r') {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw);
      process.stdout.write('\n');
      resolve(input);
    } else if (ch === '\u0003') { process.exit(); }
    else if (ch === '\u007F' || ch === '\b') {
      if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
    } else { input += ch; process.stdout.write('*'); }
  };
  stdin.on('data', onData);
});

const main = async () => {
  console.log('\n  === Exemplo: Biblioteca SophiA via SIGAA ===\n');

  const username = await ask('  Usuario SIGAA: ');
  const password = await askHidden('  Senha SIGAA: ');

  console.log('\n  Conectando ao SIGAA...\n');

  const sigaa = new Sigaa({
    url: 'https://sigaa.ifsc.edu.br',
    institution: 'IFSC',
    browser: { debug: false, timeout: 60000 }
  });

  let account;
  try {
    account = await sigaa.login(username, password);
    console.log('  Login no SIGAA realizado com sucesso.');
  } catch (err) {
    console.log('  Erro no login SIGAA: ' + (err.message || err));
    rl.close();
    sigaa.close();
    return;
  }

  const bonds = await account.getActiveBonds();
  let matricula = '';
  for (const bond of bonds) {
    if (bond.type === 'student') {
      matricula = bond.registration;
      break;
    }
  }

  if (!matricula) {
    console.log('  Nenhum vinculo de aluno encontrado.');
    await account.logoff();
    sigaa.close();
    rl.close();
    return;
  }

  console.log('  Matricula: ' + matricula + '\n');

  console.log('  A senha da biblioteca NAO e a mesma do SIGAA.');
  const senhaBiblioteca = await askHidden('  Senha da biblioteca: ');

  console.log('\n  Conectando a biblioteca SophiA...\n');

  let sophia;
  try {
    const browser = sigaa.sigaaBrowser.browser;
    sophia = await loginSophia(browser, matricula, senhaBiblioteca);
    console.log('  Login na biblioteca realizado com sucesso!\n');
  } catch (err) {
    console.log('  Erro no login da biblioteca: ' + (err.message || err));
    await account.logoff();
    sigaa.close();
    rl.close();
    return;
  }

  try {
    console.log('  === Emprestimos ===\n');
    const emprestimos = await sophia.getEmprestimos();

    if (emprestimos.length === 0) {
      console.log('  Nenhum emprestimo encontrado.\n');
    } else {
      for (const livro of emprestimos) {
        console.log(`  #${livro.numero} - ${livro.titulo}`);
        console.log(`    Codigo: ${livro.codigo} | Chamada: ${livro.chamada}`);
        console.log(`    Biblioteca: ${livro.biblioteca}`);
        console.log(`    Saida: ${livro.dataSaida} | Prevista: ${livro.dataPrevista}`);
        console.log('');
      }
      console.log(`  Total: ${emprestimos.length} livro(s)\n`);

      const renovar = await ask('  Deseja renovar todos? (s/n): ');
      if (renovar.trim().toLowerCase() === 's') {
        console.log('\n  Renovando todos os emprestimos...\n');
        const resultado = await sophia.renovar([]);
        console.log('  Sucesso: ' + resultado.sucesso);
        console.log('  Resposta: ' + (resultado.mensagem || '').substring(0, 300));
      }
    }
  } catch (err) {
    console.log('  Erro: ' + (err.message || err));
  }

  console.log('\n  Encerrando sessoes...');
  await sophia.close();
  await account.logoff();
  sigaa.close();
  rl.close();
  console.log('  Pronto!\n');
};

main().catch((err) => {
  console.error('  Erro inesperado: ' + (err.message || err));
  process.exit(1);
});
