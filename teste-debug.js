const { Sigaa } = require('./dist/sigaa-all-types');
const fs = require('fs');

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
  console.log('Login realizado com sucesso!');

  const browser = sigaa.sigaaBrowser;
  const page = browser.getPage();

  const url1 = page.url();
  const html1 = await page.content();
  fs.writeFileSync('debug-pagina-apos-login.html', html1);
  console.log('\n=== Página após login ===');
  console.log('URL:', url1);
  console.log('HTML salvo em: debug-pagina-apos-login.html');
  console.log('Tamanho:', html1.length, 'caracteres');

  const perfilDocente = html1.includes('perfil-docente');
  const subFormulario = html1.includes('subFormulario');
  const vinculos = html1.includes('vinculos');
  const discente = html1.includes('discente.jsf');
  const matricula = html1.includes('Matrícula');

  console.log('\n=== Elementos encontrados na página ===');
  console.log('Contém #perfil-docente:', perfilDocente);
  console.log('Contém table.subFormulario:', subFormulario);
  console.log('Contém link vinculos:', vinculos);
  console.log('Contém discente.jsf:', discente);
  console.log('Contém "Matrícula":', matricula);

  console.log('\n=== Tentando buscar vínculos ===');
  try {
    const bonds = await account.getActiveBonds();
    console.log('Vínculos encontrados:', bonds.length);
    for (const bond of bonds) {
      console.log(`  Tipo: ${bond.type}, Matrícula: ${bond.registration}, Curso: ${bond.program}`);
    }
  } catch (err) {
    console.error('Erro ao buscar vínculos:', err.message);

    const url2 = page.url();
    const html2 = await page.content();
    fs.writeFileSync('debug-pagina-erro.html', html2);
    console.log('\nURL no momento do erro:', url2);
    console.log('HTML salvo em: debug-pagina-erro.html');
  }

  sigaa.close();
  console.log('\nNavegador fechado.');
};

main().catch((err) => {
  console.error('Erro geral:', err.message || err);
  sigaa.close();
  process.exit(1);
});
