# SIGAA-API (Fork Modernizado)

## Sobre

Este projeto e um fork do [sigaa-api](https://github.com/GeovaneSchmitz/sigaa-api), originalmente criado por **Geovane Schmitz**. O projeto original foi arquivado apos o autor concluir seu curso no IFSC, e desde entao o SIGAA passou por atualizacoes que tornaram a biblioteca incompativel, incluindo a implementacao de protecao Cloudflare Turnstile em diversas instituicoes.

Este fork foi desenvolvido exclusivamente para **fins de estudo**, com o objetivo de modernizar a camada de acesso HTTP e adaptar a biblioteca as mudancas recentes do SIGAA.

> **Creditos:** Todo o merito da arquitetura original, parsing de paginas, estrutura de dados e logica de scraping pertence a [Geovane Schmitz](https://github.com/GeovaneSchmitz) e aos contribuidores do projeto original.

---

## O que mudou neste fork

### Camada HTTP substituida

O projeto original utilizava requisicoes HTTP diretas via HTTPS/axios. Com a adocao do Cloudflare Turnstile pelo SIGAA, essas requisicoes passaram a ser bloqueadas. A solucao foi substituir toda a camada HTTP por um navegador real controlado via Puppeteer, utilizando a biblioteca `puppeteer-real-browser`.

Isso permite:
- Resolver automaticamente os desafios do Cloudflare Turnstile
- Manter cookies e sessao de forma nativa pelo navegador
- Submeter formularios JSF da mesma forma que um usuario faria manualmente

### Arquivos modificados

| Arquivo | O que mudou |
|---------|-------------|
| `src/session/sigaa-browser.ts` | **Novo.** Gerencia o ciclo de vida do navegador, navegacao, submissao de formularios, download de arquivos e resolucao do Cloudflare. |
| `src/session/sigaa-http.ts` | Mesma interface publica, mas agora utiliza o navegador em vez de requisicoes HTTP diretas. |
| `src/session/sigaa-http-factory.ts` | Agora recebe e repassa a instancia do navegador. |
| `src/session/sigaa-page-navigator.ts` | **Novo.** Auxiliares para navegacao JSF (clique em menus, submissao de formularios, verificacao de sessao expirada). |
| `src/session/login/sigaa-login-ifsc.ts` | Login adaptado para usar o navegador (campos `user.login`/`user.senha`, navegacao em `/sigaa/verTelaLogin.do`). |
| `src/session/login/sigaa-login-ufpb.ts` | Login adaptado para UFPB (campos `form:login`/`form:senha`). |
| `src/session/login/sigaa-login-unb.ts` | Login adaptado para UNB. |
| `src/sigaa-main.ts` | Cria e gerencia a instancia do navegador. Aceita opcao `browser` no construtor. |
| `src/account/sigaa-account-ifsc.ts` | Parser da pagina inicial adaptado — fallback para `/sigaa/vinculos.jsf` quando a estrutura da pagina mudou. |

### O que foi removido

- **Dependencia do axios e requisicoes HTTP diretas** — substituidos pelo navegador real.
- **Exemplo `login-with-session.js`** — o conceito de sessao manual nao se aplica mais (o navegador gerencia cookies nativamente).
- **Exemplo `get-grades-simultaneously.js`** — incompativel com a abordagem de navegador unico.
- **Exemplo `search-teacher.js`** — removido por simplicidade (a funcionalidade de busca continua disponivel na biblioteca).
- **Exemplo `use-another-institution.js`** — removido do diretorio de exemplos.

### O que foi adicionado

- **`sigaa-menu.js`** — Menu interativo para terminal (PowerShell/bash). O aluno informa usuario e senha uma unica vez e tem acesso a todas as funcionalidades por meio de um menu numerado. Nenhum conhecimento tecnico necessario.
- **Reconexao automatica** — Se a sessao do SIGAA expirar durante o uso, o sistema reconecta automaticamente e repete a operacao.
- **Dismissao automatica de alertas** — Alertas JavaScript do SIGAA (como "Sua sessao expirou") sao aceitos automaticamente pelo navegador.
- **Download de arquivos corrigido** — O mecanismo de download usa interceptacao CDP (Chrome DevTools Protocol) para capturar arquivos que o navegador trataria como download, evitando erros `net::ERR_ABORTED`. Diretorios de destino sao criados automaticamente.
- **Parsing de indices academicos** — O exemplo `get-account-info.js` agora extrai da pagina principal: MC, IRA, IECH, IEPL, IEA, CAA e dados de integralizacao (CH pendentes, percentual integralizado).
- **Parsing de horarios** — O exemplo `get-courses.js` converte codigos de horario do SIGAA (ex: `2N34`) para formato legivel (ex: `Segunda a noite, 3a e 4a aula`).
- **Nome do professor** — O exemplo `get-courses.js` busca o nome e departamento do professor de cada disciplina.

---

## Tratativas tecnicas

### Cloudflare Turnstile

O SIGAA de diversas instituicoes passou a utilizar o Cloudflare Turnstile como protecao contra bots. A biblioteca `puppeteer-real-browser` resolve esses desafios automaticamente ao utilizar um navegador real (Chromium) com fingerprint nativo.

**Importante:** O navegador roda obrigatoriamente em modo visivel (`headless: false`). Em servidores sem interface grafica, o Xvfb (X Virtual Framebuffer) e utilizado automaticamente.

### Paginas intermediarias

Apos resolver o Turnstile, o SIGAA pode exibir uma ou mais paginas com botao "Continuar". O sistema detecta e clica automaticamente nesses botoes, verificando visibilidade real do elemento (display, visibility, opacity) para evitar cliques em elementos ocultos.

### Navegacao JSF

O SIGAA utiliza JavaServer Faces (JSF), que depende de estados de sessao (ViewState) e formularios ocultos. Todas as navegacoes usam:

- `waitUntil: 'domcontentloaded'` em vez de `load` ou `networkidle2`, pois paginas do SIGAA possuem atividade de rede continua (analytics, relogios, AJAX)
- Formularios temporarios injetados via `page.evaluate()` para submissoes POST
- A chamada `evaluate()` que dispara navegacao e tratada como fire-and-forget (o contexto de execucao e destruido quando a navegacao inicia)

### Sessao expirada

O SIGAA invalida a sessao apos inatividade ou navegacao excessiva. O sistema:
1. Intercepta alertas JavaScript do tipo "Sua sessao expirou"
2. Aceita o alerta automaticamente
3. Realiza novo login com as credenciais armazenadas em memoria
4. Re-executa a operacao que o usuario havia solicitado

---

## Funcionalidades disponiveis

- Listar disciplinas do semestre atual
- Ver notas e faltas
- Ver horarios de aula formatados
- Ver nome e departamento dos professores
- Ver atividades pendentes (tarefas, provas, quizzes)
- Ver detalhes de tarefas (descricao, tipo, datas)
- Ver aulas e conteudos
- Ver noticias das disciplinas
- Baixar todos os arquivos disponibilizados pelos professores
- Ver indices academicos (MC, IRA, IECH, IEPL, IEA, CAA)
- Ver integralizacao curricular (CH pendente, percentual)
- Ver informacoes da conta (nome, e-mail, matricula, curso)

---

## Como usar

### Pre-requisitos

- Node.js (v18 ou superior)
- npm

### Instalacao

```bash
git clone <url-do-repositorio>
cd sigaa-api
npm install --legacy-peer-deps
npm run build
```

A flag `--legacy-peer-deps` e necessaria por conta de conflitos de versao entre dependencias do Puppeteer.

### Menu interativo (recomendado)

A forma mais simples de usar. Nao requer nenhum conhecimento tecnico:

```bash
node sigaa-menu.js
```

O programa vai pedir seu usuario e senha do SIGAA, e em seguida mostrar um menu com todas as opcoes disponiveis:

```
════════════════════════════════════════════════════════
  SIGAA - Menu do Aluno
════════════════════════════════════════════════════════

  1. Informacoes da conta e indices academicos
  2. Disciplinas e professores
  3. Notas
  4. Faltas
  5. Atividades pendentes
  6. Tarefas
  7. Aulas
  8. Noticias
  9. Baixar arquivos das disciplinas
  0. Sair
```

### Exemplos individuais

Os exemplos na pasta `examples/` podem ser executados individualmente. Edite o arquivo desejado para inserir seu usuario e senha, e execute:

```bash
node examples/get-grades.js
```

Exemplos disponiveis:

| Arquivo | Descricao |
|---------|-----------|
| `get-account-info.js` | Informacoes da conta, indices academicos e integralizacao |
| `get-courses.js` | Disciplinas, horarios formatados e professores |
| `get-grades.js` | Notas de todas as disciplinas |
| `get-absences.js` | Faltas detalhadas por data |
| `get-activities.js` | Atividades pendentes |
| `get-homework.js` | Tarefas com descricao e datas |
| `get-lessons.js` | Aulas e conteudos |
| `get-news.js` | Noticias das disciplinas |
| `download-all-files.js` | Download de todos os arquivos |

### Uso como biblioteca

```javascript
const { Sigaa } = require('./dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

const account = await sigaa.login('usuario', 'senha');
const bonds = await account.getActiveBonds();

for (const bond of bonds) {
  if (bond.type !== 'student') continue;
  const courses = await bond.getCourses();
  for (const course of courses) {
    console.log(course.title);
  }
}

await account.logoff();
sigaa.close();
```

---

## Instituicoes testadas

- **IFSC** (Instituto Federal de Santa Catarina) — testado e funcionando
- **UFPB** (Universidade Federal da Paraiba) — login adaptado
- **UNB** (Universidade de Brasilia) — login adaptado

---

## Dependencias principais

| Pacote | Funcao |
|--------|--------|
| `puppeteer-real-browser` | Navegador real com bypass de Cloudflare |
| `cheerio` | Parsing de HTML |
| `form-data` | Manipulacao de formularios multipart |
| `he` | Decodificacao de entidades HTML |
| `iconv-lite` | Conversao de encoding de caracteres |

---

## Aviso legal

Este projeto foi desenvolvido exclusivamente para **fins de estudo e aprendizado**. Nao possui nenhuma afiliacao oficial com o SIGAA, o IFSC ou qualquer outra instituicao de ensino. O uso desta ferramenta e de total responsabilidade do usuario.

---

## Creditos

- **Projeto original:** [GeovaneSchmitz/sigaa-api](https://github.com/GeovaneSchmitz/sigaa-api)
- **Autor original:** [Geovane Schmitz](https://github.com/GeovaneSchmitz)
- **Licenca:** Mantida conforme o projeto original
