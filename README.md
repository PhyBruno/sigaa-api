# SIGAA-API — Fork Modernizado para IFSC

**API não-oficial de alto desempenho para o SIGAA do IFSC**, com bypass de Cloudflare Turnstile, servidor REST completo, integração com o sistema de biblioteca SophiA e compatibilidade com Linux/Docker.

---

## Créditos

Este projeto é um **fork** do excelente trabalho do [Geovane Schmitz](https://github.com/GeovaneSchmitz/sigaa-api), que criou a base original da biblioteca `sigaa-api` — um projeto pioneiro de web scraping para o SIGAA, feito em TypeScript com uma arquitetura limpa e extensível.

**Este fork, porém, foi muito além do escopo original:**

- Migrou o motor de navegação de `puppeteer` para [`puppeteer-real-browser`](https://github.com/nicedayzhu/puppeteer-real-browser), resolvendo o bloqueio do Cloudflare Turnstile que inutilizava a biblioteca original no IFSC
- Adicionou um **servidor REST completo** com Express, gerenciamento de sessões, auto-reconexão e 16 endpoints
- Criou do zero a **integração com o SophiA** (biblioteca.ifsc.edu.br) — login, consulta de empréstimos, renovação com recibo e fechamento automático de popup
- Reescreveu o fluxo de login do IFSC com manipulação direta do DOM e espera pelo Turnstile
- Adicionou 9 exemplos interativos com prompt de credenciais e mascaramento de senha
- Corrigiu bugs críticos (truncamento de notícias, parsing de horários, etc.)
- Criou um menu interativo completo (`sigaa-menu.js`) e uma collection Postman com 16 endpoints documentados

---

## Stack Técnica

| Camada | Tecnologia | Versão |
|---|---|---|
| **Linguagem** | TypeScript (fonte) / JavaScript (runtime) | TS 5.9 / Node.js 20+ |
| **Transpilação** | Babel (`@babel/cli` + `@babel/preset-typescript`) | 7.x |
| **Navegador** | Chromium via `puppeteer-real-browser` | 1.4.4 |
| **Display Virtual** | Xvfb (`xorg.xorgserver` via Nix) | — |
| **Servidor HTTP** | Express | 5.2 |
| **Parsing HTML** | Cheerio | 1.2 |
| **Encoding** | iconv-lite / he | — |
| **HTTP Multipart** | form-data / formdata-node | — |
| **Testes** | Jest + ts-jest | 30.x |
| **Documentação** | TypeDoc | 0.28 |
| **Linting** | ESLint + Prettier | — |

---

## Arquitetura do Projeto

```
sigaa-api/
├── src/                          # Código-fonte TypeScript
│   ├── sigaa-main.ts             # Classe principal Sigaa (entry point)
│   ├── sigaa-all-types.ts        # Barrel de exportações públicas
│   ├── sigaa-types.ts            # Tipos e enums compartilhados
│   ├── session/
│   │   ├── sigaa-browser.ts      # Motor puppeteer-real-browser + Cloudflare bypass
│   │   ├── sigaa-http.ts         # HTTP client com cookies e retry
│   │   ├── sigaa-http-factory.ts # Factory para instâncias HTTP
│   │   ├── sigaa-page.ts         # Abstração de página do SIGAA
│   │   ├── login/
│   │   │   ├── sigaa-login-ifsc.ts   # Login IFSC (Turnstile + DOM)
│   │   │   ├── sigaa-login-ufpb.ts   # Login UFPB
│   │   │   └── sigaa-login-unb.ts    # Login UnB
│   │   └── page/                     # Implementações por instituição
│   ├── account/                  # Dados da conta do aluno
│   ├── bonds/                    # Vínculos (aluno, professor)
│   ├── courses/
│   │   └── resources/
│   │       ├── sigaa-grades-student.ts     # Notas
│   │       ├── sigaa-absence-list-student.ts # Faltas
│   │       ├── sigaa-news-student.ts       # Notícias (fix: conteúdo completo)
│   │       ├── sigaa-lesson-student.ts     # Aulas
│   │       ├── sigaa-exam-student.ts       # Provas
│   │       ├── sigaa-syllabus-student.ts   # Ementa
│   │       ├── sigaa-member-list-student.ts # Professores
│   │       ├── attachments/                # Anexos/arquivos
│   │       └── forum/                      # Fórum
│   ├── activity/                 # Atividades (tarefas, quizzes, provas)
│   ├── search/                   # Busca no SIGAA
│   └── helpers/                  # Utilitários (parser, promise stack)
│
├── dist/                         # Código compilado (gerado pelo Babel)
│
├── sigaa-api-server.js           # Servidor REST Express (703 linhas)
├── sophia-library.js             # Biblioteca SophiA completa (590 linhas)
├── sigaa-menu.js                 # Menu interativo terminal (822 linhas)
│
├── examples/                     # 9 exemplos com prompt interativo
│   ├── get-account-info.js
│   ├── get-courses.js
│   ├── get-grades.js
│   ├── get-absences.js
│   ├── get-activities.js
│   ├── get-homework.js
│   ├── get-lessons.js
│   ├── get-news.js
│   ├── download-all-files.js
│   └── biblioteca-emprestimos.js
│
├── SIGAA-API.postman_collection.json  # Collection Postman (16 endpoints)
└── package.json
```

---

## Implementações Detalhadas

### 1. Bypass do Cloudflare Turnstile

O SIGAA do IFSC é protegido por **Cloudflare Turnstile**, que bloqueia navegadores headless tradicionais (Puppeteer padrão, Playwright). Este fork resolveu o problema substituindo completamente o motor de navegação:

- **Antes:** `puppeteer` padrão → bloqueado pelo Turnstile
- **Depois:** `puppeteer-real-browser` → emula um navegador real com fingerprint legítimo

O fluxo de login:
1. Abre o Chromium via `puppeteer-real-browser` com `connect()`
2. Navega até `/sigaa/verTelaLogin.do`
3. Preenche credenciais via `page.evaluate()` com dispatch de eventos reais (`input`, `change`)
4. Aguarda o Turnstile resolver automaticamente (`waitForTurnstile()`)
5. Clica no submit e espera `networkidle2`

**Design intencional:** O navegador roda com `headless: false` dentro do **Xvfb** (display virtual X11). Isso é necessário porque o Turnstile detecta e bloqueia o modo headless real.

### 2. Servidor REST Express (sigaa-api-server.js)

API REST completa com **16 endpoints**, gerenciamento de sessões com tokens e reconexão automática.

#### Endpoints

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `POST` | `/login` | Não | Login no SIGAA, retorna token |
| `POST` | `/logout` | Bearer | Encerra sessão e fecha navegador |
| `GET` | `/conta` | Bearer | Dados da conta, índices (IRA, MC, IEA) e integralização |
| `GET` | `/disciplinas` | Bearer | Disciplinas com horários e professores |
| `GET` | `/notas` | Bearer | Notas por disciplina (média ponderada, soma, etc.) |
| `GET` | `/faltas` | Bearer | Faltas detalhadas por data |
| `GET` | `/atividades` | Bearer | Atividades pendentes (tarefas, quizzes, provas) |
| `GET` | `/tarefas` | Bearer | Tarefas com descrição, datas, grupo e nota |
| `GET` | `/aulas` | Bearer | Aulas ministradas com conteúdo e anexos |
| `GET` | `/noticias` | Bearer | Notícias das disciplinas (conteúdo completo) |
| `GET` | `/arquivos` | Bearer | Arquivos disponíveis para download |
| `POST` | `/biblioteca/login` | Bearer | Login no SophiA (matrícula automática) |
| `GET` | `/biblioteca/emprestimos` | Bearer | Lista empréstimos ativos |
| `POST` | `/biblioteca/renovar` | Bearer | Renova empréstimos (todos ou específicos) |
| `POST` | `/biblioteca/logout` | Bearer | Encerra sessão da biblioteca |
| `GET` | `/status` | Não | Status do servidor e sessões ativas |

#### Recursos do Servidor

- **Tokens de sessão**: Gerados com `crypto.randomBytes(32)`, armazenados em memória
- **Auto-reconexão**: Se a sessão do SIGAA expirar (`ViewExpiredException`), o servidor faz login novamente automaticamente via `withRetry()`
- **Limpeza automática**: Sessões inativas são removidas a cada 60s (timeout padrão: 5 min)
- **Limite de sessões**: Máximo de 5 sessões simultâneas (configurável via `MAX_SESSIONS`)
- **CORS habilitado**: Aceita requisições de qualquer origem

### 3. Biblioteca SophiA (sophia-library.js)

Integração completa com o sistema de biblioteca do IFSC (**biblioteca.ifsc.edu.br**), construída do zero com automação de navegador.

#### Funcionalidades

- **Login**: Autentica com matrícula e senha no portal SophiA, manipulando frames aninhados
- **Consulta de empréstimos**: Parseia a `table.tab_circulacoes` extraindo número, título, chamada, código, biblioteca, datas
- **Renovação**: Marca checkboxes individuais ou usa `selTudo` para renovar todos
- **Recibo oficial**: Após renovar, clica em `LinkImpRecibo(1)`, parseia a tabela `#dRecibo` e retorna dados estruturados (código de renovação, título, biblioteca, chamada, exemplar, datas)
- **Fechamento de popup**: Após capturar o recibo, fecha automaticamente o popup chamando `fechaPopup()` com fallbacks
- **Navegação inteligente**: `navigateToCirculacoes()` detecta 3 estados possíveis e navega pelo caminho correto

#### Fluxo de Renovação

```
Selecionar checkboxes → LinkRenovar() → esperar 4s → parsear dados pré-recibo
→ LinkImpRecibo(1) → esperar 2s → parsear #dRecibo → fechaPopup() → retorno estruturado
```

### 4. Refatorações e Correções

- **Notícias completas**: O código original usava `newsElement.find('div').html()` (pegava só o primeiro div). Corrigido para iterar sobre todos os divs com `divs.each()` e concatenar o HTML, tanto no TypeScript fonte quanto no dist compilado
- **Horários parseados**: Implementação de `parseSchedule()` que converte o formato do SIGAA (`2M12 4M34`) para objetos legíveis com dia, turno e aulas
- **9 exemplos interativos**: Todos os exemplos agora pedem credenciais via `readline` com mascaramento de senha (asteriscos) — sem mais strings hardcoded
- **Menu interativo** (`sigaa-menu.js`): 822 linhas com interface completa para terminal, incluindo todas as funcionalidades acadêmicas e da biblioteca

### 5. Captação de Informações Acadêmicas

O projeto extrai dados de diversas áreas do SIGAA via web scraping:

| Dado | Técnica |
|---|---|
| **Nome, e-mails, foto** | API interna do SIGAA (`account.getName()`, etc.) |
| **Matrícula e curso** | Extraído do vínculo ativo (`bond.registration`, `bond.program`) |
| **Índices acadêmicos** (IRA, MC, IEA) | Parsing do portal com Cheerio (`<acronym>` tags) |
| **Integralização** (CH, percentual) | Parsing de tabelas do portal discente |
| **Disciplinas** | `bond.getCourses()` + parsing de horários |
| **Professores** | `course.getMembers()` com nome, departamento, e-mail |
| **Notas** | `course.getGrades()` — suporta média ponderada, soma e média simples |
| **Faltas** | `course.getAbsence()` com máximo permitido e detalhes por data |
| **Atividades** | `bond.getActivities()` — tarefas, quizzes e provas |
| **Tarefas** | `course.getHomeworks()` com descrição, datas, grupo e nota |
| **Aulas** | `course.getLessons()` com conteúdo e anexos |
| **Notícias** | `course.getNews()` com conteúdo completo (fix aplicado) |
| **Arquivos** | `course.getFiles()` com título e descrição |
| **Empréstimos (SophiA)** | Parsing de `table.tab_circulacoes` via frame manipulation |
| **Recibo de renovação** | Parsing de `#dRecibo` após `LinkImpRecibo()` |

---

## Instalação e Uso

### Pré-requisitos

- **Node.js** 20+ (recomendado)
- **Xvfb** (display virtual X11 — obrigatório em servidores sem GUI)
- **Chromium** (instalado automaticamente pelo `puppeteer-real-browser`)

### Instalação

```bash
git clone https://github.com/PhyBruno/sigaa-api.git
cd sigaa-api
npm install --legacy-peer-deps
npm run build
```

> **Nota:** O `--legacy-peer-deps` é necessário devido a conflitos de peer dependencies do ESLint.

### Iniciar o Servidor REST

```bash
# Com Xvfb (servidores sem GUI)
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
node sigaa-api-server.js

# O servidor inicia na porta 3000
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor Express |
| `MAX_SESSIONS` | `5` | Máximo de sessões simultâneas |
| `SESSION_TIMEOUT_MIN` | `5` | Timeout de inatividade (minutos) |
| `DISPLAY` | — | Display X11 (obrigatório para Xvfb) |

### Menu Interativo

```bash
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
node sigaa-menu.js
```

### Exemplos Individuais

```bash
node examples/get-courses.js
node examples/get-grades.js
node examples/biblioteca-emprestimos.js
# ... etc
```

---

## Uso com Docker

```dockerfile
# =============================================================================
# SIGAA API — Dockerfile
# Base: Node 20 slim (Debian 12 Bookworm)
# =============================================================================

FROM node:20-slim

# -----------------------------------------------------------------------------
# Dependências do sistema
#
# Grupos:
#   - Xvfb e X11: servidor de display virtual + libs de renderização
#   - Chromium: navegador e todas as suas dependências de sistema
#   - Utilitários: curl (healthcheck), ca-certificates (HTTPS), fontes
#
# Notas importantes:
#   - xauth:       obrigatório para xvfb-run criar a sessão X corretamente
#   - x11-utils:   ferramentas auxiliares do X11 (xdpyinfo, xwininfo etc.)
#   - libx11-6:    biblioteca base do protocolo X11
#   - libxext6:    extensões do X11 usadas pelo Chromium
#   - libxrender1: extensão de renderização do X11
#   - libxtst6:    extensão de input do X11
#   - libasound2t64: nome correto no Debian 12 (Bookworm) — era libasound2
#   - libgbm1:     gerenciador de buffer gráfico (GPU buffer management)
# -----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    xauth \
    x11-utils \
    fonts-liberation \
    fonts-noto \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxext6 \
    libxrender1 \
    libxtst6 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libxshmfence1 \
    libdrm2 \
    libxkbcommon0 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Configuração do Puppeteer
#
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: impede o download de um segundo Chromium
#   durante o npm install (~300MB economizados na imagem)
# PUPPETEER_EXECUTABLE_PATH: aponta para o Chromium instalado via apt acima
# -----------------------------------------------------------------------------
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# -----------------------------------------------------------------------------
# Variáveis da aplicação — sobrescrevíveis via Portainer / docker-compose
# -----------------------------------------------------------------------------
ENV PORT=3000
ENV MAX_SESSIONS=5
ENV SESSION_TIMEOUT_MIN=30

# Display virtual — deve coincidir com o número passado ao xvfb-run no CMD
ENV DISPLAY=:99

# -----------------------------------------------------------------------------
# Usuário não-root
#
# Rodar Chromium como root exige --no-sandbox, desativando uma camada de
# segurança importante. Com um usuário dedicado, o sandbox permanece ativo.
# Os grupos audio e video são necessários para alguns drivers do Chromium.
# -----------------------------------------------------------------------------
RUN groupadd -r sigaa \
    && useradd -r -g sigaa -G audio,video sigaa \
    && mkdir -p /home/sigaa \
    && chown -R sigaa:sigaa /home/sigaa

# -----------------------------------------------------------------------------
# Permissão no socket do X11
#
# O Xvfb cria o socket em /tmp/.X11-unix — o diretório precisa existir e
# ser acessível pelo usuário não-root antes do processo iniciar.
# -----------------------------------------------------------------------------
RUN mkdir -p /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix

# -----------------------------------------------------------------------------
# Instalação das dependências Node
#
# Separado do COPY . . para aproveitar o cache de camadas do Docker:
# só reinstala pacotes quando package.json ou package-lock.json mudar.
# npm ci é mais rígido que npm install — usa exatamente o package-lock.json.
# -----------------------------------------------------------------------------
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# -----------------------------------------------------------------------------
# Código-fonte e build
#
# O .dockerignore garante que node_modules, dist, .git etc. não são copiados.
# -----------------------------------------------------------------------------
COPY . .
RUN npm run build

# Ajusta dono dos arquivos para o usuário não-root
RUN chown -R sigaa:sigaa /app

USER sigaa

EXPOSE 3000

# -----------------------------------------------------------------------------
# Healthcheck
#
# --start-period=20s: tempo de graça para o servidor subir antes de contar
#   falhas (Xvfb + Chromium + Node levam alguns segundos)
# -----------------------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3000/status || exit 1

# -----------------------------------------------------------------------------
# Inicialização
#
# xvfb-run garante que o Xvfb está completamente pronto antes de iniciar o
# Node — elimina a necessidade de sleep e race conditions.
#
# Flags do xvfb-run:
#   --auto-servernum:  escolhe display disponível automaticamente (:99, :100...)
#   --server-args:     configura resolução e desativa TCP (só Unix socket)
#
# Flags do Xvfb (-server-args):
#   -screen 0 1280x720x24: resolução 1280x720, 24-bit de cor
#   -nolisten tcp:          segurança — só aceita conexões via Unix socket
# -----------------------------------------------------------------------------
CMD ["xvfb-run", \
     "--auto-servernum", \
     "--server-args=-screen 0 1280x720x24 -nolisten tcp", \
     "node", "sigaa-api-server.js"]
```

```bash
docker build -t sigaa-api .
docker run -p 3000:3000 sigaa-api
```

### Docker Compose

```yaml
            version: "3.9"

            # =============================================================================
            # SIGAA API — Docker Swarm Stack
            #
            # Pré-requisitos:
            #   - Rede overlay "network_public" já existente com Traefik rodando nela.
            #   - Caso a rede não exista, crie antes do deploy:
            #       docker network create --driver overlay --attachable network_public
            #
            # Antes de fazer o deploy, ajuste:
            #   - "JustBrunasso/sigaa-api:latest"  → seu usuário real do Docker Hub
            #   - "sigaa.seudominio.com"      → seu domínio real
            #   - "letsencrypt"               → nome do certresolver no seu Traefik
            # =============================================================================

            services:

              # ---------------------------------------------------------------------------
              # Traefik — já rodando como stack separada. Descomente este bloco completo
              # caso queira gerenciar o Traefik por aqui também.
              # ---------------------------------------------------------------------------
              # traefik:
              #   image: traefik:v3.0
              #   command:
              #     - --api.dashboard=true
              #     - --providers.docker=true
              #     - --providers.docker.swarmMode=true
              #     - --providers.docker.exposedbydefault=false
              #     - --entrypoints.web.address=:80
              #     - --entrypoints.websecure.address=:443
              #     - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
              #     - --certificatesresolvers.letsencrypt.acme.email=seu@email.com
              #     - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
              #   ports:
              #     - target: 80
              #       published: 80
              #       protocol: tcp
              #       mode: host
              #     - target: 443
              #       published: 443
              #       protocol: tcp
              #       mode: host
              #   volumes:
              #     - /var/run/docker.sock:/var/run/docker.sock:ro
              #     - traefik-letsencrypt:/letsencrypt
              #   networks:
              #     - network_public
              #   deploy:
              #     placement:
              #       constraints:
              #         - node.role == manager

              # ---------------------------------------------------------------------------
              # SIGAA API Server
              # ---------------------------------------------------------------------------
              sigaa-api:
                image: JustBrunasso/sigaa-api:latest

                environment:
                  - PORT=3000
                  - MAX_SESSIONS=5
                  - SESSION_TIMEOUT_MIN=30
                  - DISPLAY=:99

                expose:
                  - "3000"

                volumes:
                  # Persistência dos arquivos baixados pelo scraper entre restarts
                  - sigaa-downloads:/app/downloads

                  # /dev/shm como tmpfs com 1GB
                  # Obrigatório: o Docker limita /dev/shm a 64MB por padrão.
                  # O Chromium usa shared memory intensivamente — sem isso ele crasha
                  # em páginas mais pesadas sem nenhuma mensagem de erro clara.
                  - type: tmpfs
                    target: /dev/shm
                    tmpfs:
                      size: 1073741824  # 1GB em bytes (1024 * 1024 * 1024)

                  # Socket do X11 — garante que o diretório existe no host
                  # e é compartilhado corretamente com o container
                  - type: tmpfs
                    target: /tmp/.X11-unix
                    tmpfs:
                      mode: "01777"   # sticky bit + rwx para todos (mesmo que mkdir 1777)

                networks:
                  - network_public

                deploy:
                  mode: replicated
                  replicas: 1

                  # Fixado no manager: o Chromium com Xvfb exige acesso a recursos
                  # gráficos e de sistema que workers Swarm geralmente não têm.
                  placement:
                    constraints:
                      - node.role == manager

                  # Limites de recursos — ajuste conforme o servidor
                  # Cada réplica (sessão Chromium) consome ~300-500MB de RAM
                  resources:
                    limits:
                      cpus: "2.0"
                      memory: 3G
                    reservations:
                      cpus: "0.5"
                      memory: 512M

                  # Restart em caso de falha
                  restart_policy:
                    condition: on-failure
                    delay: 10s
                    max_attempts: 3
                    window: 60s

                  # Rolling update sem downtime
                  update_config:
                    parallelism: 1
                    delay: 15s
                    failure_action: rollback
                    order: start-first

                  # Rollback automático se a atualização falhar
                  rollback_config:
                    parallelism: 1
                    delay: 10s
                    failure_action: pause
                    order: stop-first

                  # No modo Swarm, as labels do Traefik ficam obrigatoriamente
                  # dentro do bloco deploy — labels fora daqui são ignoradas pelo Traefik
                  labels:
                    - "traefik.enable=true"

                    # HTTP → redireciona para HTTPS
                    - "traefik.http.routers.sigaa-api-http.rule=Host(`sigaa.seudominio.com`)"
                    - "traefik.http.routers.sigaa-api-http.entrypoints=web"
                    - "traefik.http.routers.sigaa-api-http.middlewares=redirect-to-https"

                    # HTTPS com TLS automático
                    - "traefik.http.routers.sigaa-api.rule=Host(`sigaa.seudominio.com`)"
                    - "traefik.http.routers.sigaa-api.entrypoints=websecure"
                    - "traefik.http.routers.sigaa-api.tls=true"
                    - "traefik.http.routers.sigaa-api.tls.certresolver=letsencrypt"

                    # Porta interna do container
                    - "traefik.http.services.sigaa-api.loadbalancer.server.port=3000"

                    # Middleware de redirect HTTP → HTTPS
                    - "traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https"
                    - "traefik.http.middlewares.redirect-to-https.redirectscheme.permanent=true"

                    # Rede que o Traefik deve usar para alcançar este serviço
                    - "traefik.docker.network=network_public"

            # =============================================================================
            # Volumes
            # =============================================================================
            volumes:
              sigaa-downloads:
                driver: local

              # Descomente se subir o Traefik por aqui
              # traefik-letsencrypt:
              #   driver: local

            # =============================================================================
            # Redes — usa a rede overlay externa onde o Traefik já está rodando
            # =============================================================================
            networks:
              network_public:
                external: true
```

---

## Uso da API

### 1. Login

```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"usuario": "seu.usuario", "senha": "suasenha"}'
```

Resposta:
```json
{
  "token": "a1b2c3d4...",
  "nome": "NOME DO ALUNO",
  "mensagem": "Login realizado com sucesso. Use o token no header Authorization: Bearer <token>"
}
```

### 2. Consultar Dados

```bash
# Notas
curl http://localhost:3000/notas -H "Authorization: Bearer SEU_TOKEN"

# Disciplinas
curl http://localhost:3000/disciplinas -H "Authorization: Bearer SEU_TOKEN"

# Faltas
curl http://localhost:3000/faltas -H "Authorization: Bearer SEU_TOKEN"
```

### 3. Biblioteca SophiA

```bash
# Login na biblioteca (matrícula obtida automaticamente)
curl -X POST http://localhost:3000/biblioteca/login \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"senhaBiblioteca": "suasenha"}'

# Listar empréstimos
curl http://localhost:3000/biblioteca/emprestimos \
  -H "Authorization: Bearer SEU_TOKEN"

# Renovar todos
curl -X POST http://localhost:3000/biblioteca/renovar \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Renovar específicos
curl -X POST http://localhost:3000/biblioteca/renovar \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"codigos": ["1455928"]}'
```

### 4. Logout

```bash
curl -X POST http://localhost:3000/logout \
  -H "Authorization: Bearer SEU_TOKEN"
```

---

## Collection Postman

O arquivo `SIGAA-API.postman_collection.json` contém todos os 16 endpoints documentados com:

- Exemplos de request e response para cada endpoint
- Scripts de teste automáticos (token salvo automaticamente após login)
- Variáveis da collection pré-configuradas (`base_url`, `token`, credenciais)
- Descrições detalhadas em português
- Exemplos de erro (credenciais inválidas, campos faltando, sessão expirada)

**Para importar:** Postman → Import → Upload File → `SIGAA-API.postman_collection.json`

---

## Compatibilidade

| Ambiente | Status | Notas |
|---|---|---|
| **Linux (GUI)** | Funciona | Usa o display nativo do X11 |
| **Linux (headless)** | Funciona | Requer Xvfb (`export DISPLAY=:99`) |
| **Docker** | Funciona | Dockerfile com Xvfb incluso |
| **macOS** | Funciona | Xvfb não necessário (display nativo) |
| **Windows** | Funciona | Xvfb não necessário |

---

## Instituições Suportadas

O código-fonte mantém suporte a múltiplas instituições, com implementações de login separadas:

| Instituição | Login | Turnstile | Status |
|---|---|---|---|
| **IFSC** | `sigaa-login-ifsc.ts` | Sim (bypass) | Totalmente funcional |
| **UFPB** | `sigaa-login-ufpb.ts` | Não | Herdado do original |
| **UnB** | `sigaa-login-unb.ts` | Não | Herdado do original |

---

## Licença

MIT — veja [LICENSE](LICENSE) para detalhes.

## Autor Original

[Geovane Schmitz](https://github.com/GeovaneSchmitz) — criador da biblioteca `sigaa-api` original.

## Fork Modernizado

Refatoração completa, bypass do Cloudflare, servidor REST, integração SophiA e toda a infraestrutura adicional.
