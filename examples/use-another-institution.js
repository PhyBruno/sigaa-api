const { Sigaa } = require('../dist/sigaa-all-types');

// Exemplo com IFSC
const sigaaIFSC = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

// Exemplo com UFPB
const sigaaUFPB = new Sigaa({
  url: 'https://sigaa.ufpb.br',
  institution: 'UFPB',
  browser: { debug: true, timeout: 60000 }
});

// Se você quiser suporte a outra instituição, você pode testar com o padrão IFSC ou UFPB e abrir um issue com o erro gerado.
