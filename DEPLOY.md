# SIGAA API — Guia Completo: Build, Publicação e Deploy

> **Stack:** Node 20 · Chromium · Xvfb · Docker · Docker Swarm  
> **Pré-requisito:** Docker instalado na máquina local e na VM de destino

> 💻 **Atenção Windows:** Os comandos das seções 2, 3 e 4 possuem variantes para **PowerShell** e **Bash/Linux**.  
> Seções 5 em diante são executadas na VM Linux via SSH — use sempre a sintaxe bash lá.

---

## Índice

1. [Estrutura de arquivos](#1-estrutura-de-arquivos)
2. [Build da imagem Docker](#2-build-da-imagem-docker)
3. [Testes locais antes de publicar](#3-testes-locais-antes-de-publicar)
4. [Publicação no Docker Hub](#4-publicação-no-docker-hub)
5. [Checklist da VM — garantindo Xvfb e Chromium](#5-checklist-da-vm--garantindo-xvfb-e-chromium)
6. [Inicializar o Docker Swarm na VM](#6-inicializar-o-docker-swarm-na-vm)
7. [Deploy do stack](#7-deploy-do-stack)
8. [Verificando a saúde do serviço](#8-verificando-a-saúde-do-serviço)
9. [Atualização de versão (rolling update)](#9-atualização-de-versão-rolling-update)
10. [Rollback em caso de falha](#10-rollback-em-caso-de-falha)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Estrutura de arquivos

Confirme que seu projeto possui estes arquivos na raiz antes de começar:

```
sigaa-api/
├── Dockerfile
├── .dockerignore
├── docker-stack.yml
├── package.json
├── package-lock.json
├── sigaa-api-server.js   ← ou o entrypoint compilado
├── src/
│   └── ...
└── tsconfig.json         ← se usar TypeScript
```

---

## 2. Build da imagem Docker

> ⚠️ **Diferença crítica entre sistemas operacionais:**
> - **Windows PowerShell:** continuação de linha = `` ` `` (backtick), variáveis = `$VAR = "valor"`
> - **Linux/macOS Bash:** continuação de linha = `\` (barra), variáveis = `export VAR="valor"`

---

### 2.1 Build padrão

#### 🪟 Windows — PowerShell

```powershell
# Entre no diretório do projeto primeiro
cd C:\sigaa-api

# Confirme que o Dockerfile está presente
dir Dockerfile

# Defina as variáveis
$DOCKER_USER = "seu-usuario"
$IMAGE_NAME  = "sigaa-api"
$IMAGE_TAG   = "1.0.0"

# Build
docker build `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG}" `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:latest" `
  --file Dockerfile `
  .
```

#### 🐧 Linux / macOS — Bash

```bash
# Entre no diretório do projeto
cd ~/sigaa-api

export DOCKER_USER="seu-usuario"
export IMAGE_NAME="sigaa-api"
export IMAGE_TAG="1.0.0"

docker build \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG} \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:latest \
  --file Dockerfile \
  .
```

---

### 2.2 Build com BuildKit (mais rápido, cache melhorado)

#### 🪟 Windows — PowerShell

```powershell
$env:DOCKER_BUILDKIT = "1"

docker build `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG}" `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:latest" `
  --progress=plain `
  .
```

#### 🐧 Linux / macOS — Bash

```bash
DOCKER_BUILDKIT=1 docker build \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG} \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:latest \
  --progress=plain \
  .
```

---

### 2.3 Build multi-plataforma (se a VM for ARM, ex: Oracle Cloud A1)

#### 🪟 Windows — PowerShell

```powershell
# Criar builder multi-plataforma
docker buildx create --use --name multibuilder

docker buildx build `
  --platform linux/amd64,linux/arm64 `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG}" `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:latest" `
  --push `
  .
```

#### 🐧 Linux / macOS — Bash

```bash
docker buildx create --use --name multibuilder

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG} \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:latest \
  --push \
  .
```

> ⚠️ O `--push` no buildx envia direto ao registry. Omita se quiser apenas buildar localmente.

---

## 3. Testes locais antes de publicar

> Os comandos `docker run`, `docker logs`, `docker exec` e `docker stop` são **iguais** em Windows e Linux.  
> A única diferença está na forma de passar variáveis de ambiente inline.

### 3.1 Rodar o container

#### 🪟 Windows — PowerShell

```powershell
docker run -d `
  --name sigaa-api-test `
  -p 3000:3000 `
  -e MAX_SESSIONS=2 `
  -e SESSION_TIMEOUT_MIN=10 `
  "${DOCKER_USER}/${IMAGE_NAME}:latest"
```

#### 🐧 Linux / macOS — Bash

```bash
docker run -d \
  --name sigaa-api-test \
  -p 3000:3000 \
  -e MAX_SESSIONS=2 \
  -e SESSION_TIMEOUT_MIN=10 \
  ${DOCKER_USER}/${IMAGE_NAME}:latest
```

### 3.2 Verificar se subiu corretamente

```bash
# Ver logs em tempo real (igual em todos os sistemas)
docker logs -f sigaa-api-test

# Checar processos dentro do container
docker exec sigaa-api-test ps aux

# Verificar se o Xvfb está rodando dentro do container
docker exec sigaa-api-test ps aux | grep Xvfb

# Testar o endpoint de status da API
# Windows PowerShell — use Invoke-WebRequest ou curl.exe
curl.exe -v http://localhost:3000/status

# Linux / macOS
curl -v http://localhost:3000/status
```

### 3.3 Inspecionar o container em caso de problema

```bash
# Entrar no container interativamente (igual em todos os sistemas)
docker exec -it sigaa-api-test bash

# Verificar variáveis de ambiente
# Windows PowerShell:
docker exec sigaa-api-test env | Select-String "DISPLAY|PUPPETEER|PORT"

# Linux / macOS:
docker exec sigaa-api-test env | grep -E "DISPLAY|PUPPETEER|PORT"

# Verificar se o Chromium está acessível (igual em todos)
docker exec sigaa-api-test which chromium
docker exec sigaa-api-test chromium --version
```

### 3.4 Parar e remover o container de teste

```bash
# Igual em todos os sistemas
docker stop sigaa-api-test
docker rm sigaa-api-test
```

---

## 4. Publicação no Docker Hub

### 4.1 Login

```bash
# Igual em todos os sistemas
docker login
# Digite seu username e password/token quando solicitado
```

> 💡 **Recomendado:** use um Access Token em vez da senha.  
> Docker Hub → Account Settings → Security → New Access Token

### 4.2 Push da imagem

#### 🪟 Windows — PowerShell

```powershell
# Envia a versão específica
docker push "${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG}"

# Envia a tag latest
docker push "${DOCKER_USER}/${IMAGE_NAME}:latest"
```

#### 🐧 Linux / macOS — Bash

```bash
docker push ${DOCKER_USER}/${IMAGE_NAME}:${IMAGE_TAG}
docker push ${DOCKER_USER}/${IMAGE_NAME}:latest
```

### 4.3 Verificar no Docker Hub

#### 🪟 Windows — PowerShell

```powershell
# Usando curl.exe (disponível no Windows 10+)
curl.exe -s "https://hub.docker.com/v2/repositories/${DOCKER_USER}/${IMAGE_NAME}/tags/"
```

#### 🐧 Linux / macOS — Bash

```bash
curl -s https://hub.docker.com/v2/repositories/${DOCKER_USER}/${IMAGE_NAME}/tags/ \
  | python3 -m json.tool | grep '"name"'
```

---

## 5. Checklist da VM — garantindo Xvfb e Chromium

> 🐧 **Esta seção é executada inteiramente na VM Linux via SSH.**  
> Do Windows, conecte-se com: `ssh usuario@IP-DA-VM`  
> Todos os comandos abaixo são bash.

### 5.1 Verificar kernel e OS

```bash
uname -r          # kernel (precisa ser >= 4.4 para namespaces Docker)
cat /etc/os-release | grep -E "ID|VERSION"
```

### 5.2 Verificar Docker instalado e rodando

```bash
docker --version
docker info | grep -E "Server Version|Storage Driver|Cgroup"
systemctl status docker
```

### 5.3 Verificar suporte a namespaces (necessário para Chromium sem --privileged)

```bash
# Deve retornar "max" ou um valor >= 65536
cat /proc/sys/user/max_user_namespaces

# Se retornar 0, habilite com:
sudo sysctl -w user.max_user_namespaces=65536
echo "user.max_user_namespaces=65536" | sudo tee -a /etc/sysctl.conf
```

### 5.4 Verificar recursos disponíveis

```bash
# RAM disponível (cada sessão Chromium usa ~400MB)
free -h

# CPU
nproc

# Espaço em disco (imagem Docker ocupa ~800MB-1.2GB)
df -h /
```

### 5.5 Testar Xvfb isoladamente na VM (opcional, mas útil para debug)

```bash
# Instala Xvfb na VM host para teste (Ubuntu/Debian)
sudo apt-get install -y xvfb

# Roda um display virtual de teste
Xvfb :99 -screen 0 1280x720x24 &
echo "DISPLAY=:99 funcionando, PID=$!"

# Verifica se o socket foi criado
ls -la /tmp/.X11-unix/X99

# Mata o teste
kill %1
```

### 5.6 Verificar limites de arquivos abertos (importante para muitas sessões)

```bash
ulimit -n                     # valor atual (deve ser >= 65536)

# Para aumentar permanentemente:
# Adicione ao /etc/security/limits.conf:
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
```

### 5.7 Verificar se a porta 3000 está livre

```bash
sudo ss -tlnp | grep :3000
# ou
sudo netstat -tlnp | grep :3000
```

### 5.8 Firewall — liberar porta 3000

```bash
# UFW (Ubuntu)
sudo ufw allow 3000/tcp
sudo ufw status

# iptables direto
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

---

## 6. Inicializar o Docker Swarm na VM

### 6.1 Swarm com um único nó (modo standalone)

```bash
# Obter o IP da VM (use o IP privado se estiver em cloud)
MANAGER_IP=$(hostname -I | awk '{print $1}')
echo "IP do manager: ${MANAGER_IP}"

# Inicializar o Swarm
docker swarm init --advertise-addr ${MANAGER_IP}

# Verificar
docker node ls
```

### 6.2 Swarm com múltiplos nós (opcional)

```bash
# No manager, obter o token para workers
docker swarm join-token worker

# Em cada VM worker, executar o comando retornado, ex:
# docker swarm join --token SWMTKN-xxx <manager-ip>:2377
```

---

## 7. Deploy do stack

### 7.1 Copiar os arquivos para a VM

#### 🪟 Windows — PowerShell

```powershell
# scp funciona nativamente no Windows 10+ via PowerShell
scp docker-stack.yml usuario@IP-DA-VM:/home/usuario/sigaa/
```

#### 🐧 Linux / macOS — Bash

```bash
scp docker-stack.yml usuario@IP-DA-VM:/home/usuario/sigaa/
```

#### Qualquer sistema — via Git (recomendado)

```bash
# Na VM (após conectar via SSH):
git clone https://github.com/seu-usuario/sigaa-api.git
cd sigaa-api
```

### 7.2 Deploy inicial

```bash
# Na VM, no diretório onde está o docker-stack.yml
docker stack deploy \
  --compose-file docker-stack.yml \
  --with-registry-auth \
  sigaa
```

> O `--with-registry-auth` é necessário se a imagem for privada no Docker Hub.

### 7.3 Verificar o deploy

```bash
# Listar stacks
docker stack ls

# Listar serviços do stack
docker stack services sigaa

# Listar tasks (containers) do serviço
docker stack ps sigaa

# Ver logs do serviço
docker service logs -f sigaa_sigaa-api
```

---

## 8. Verificando a saúde do serviço

```bash
# Status geral
docker service ps sigaa_sigaa-api --no-trunc

# Inspecionar um container específico
CONTAINER_ID=$(docker ps --filter "name=sigaa_sigaa-api" -q | head -1)
docker inspect ${CONTAINER_ID} | grep -A5 "Health"

# Testar o endpoint de status
curl -s http://localhost:3000/status
```

---

## 9. Atualização de versão (rolling update)

> 🪟 **Windows:** Passos 1–3 no PowerShell local. Passos 4–5 na VM Linux via SSH.

### 9.1 Fluxo completo de atualização

#### 🪟 Windows — PowerShell (passos locais)

```powershell
# ── PASSO 1: Definir nova versão ───────────────────────────────────────────
$NOVA_TAG = "1.1.0"

# ── PASSO 2: Build ────────────────────────────────────────────────────────
docker build `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}" `
  --tag "${DOCKER_USER}/${IMAGE_NAME}:latest" `
  .

# ── PASSO 3: Testar localmente ─────────────────────────────────────────────
docker run --rm -d `
  --name sigaa-test-nova `
  -p 3001:3000 `
  "${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}"

curl.exe -s http://localhost:3001/status
docker stop sigaa-test-nova

# ── PASSO 4: Publicar ──────────────────────────────────────────────────────
docker push "${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}"
docker push "${DOCKER_USER}/${IMAGE_NAME}:latest"
```

#### 🐧 Linux / macOS — Bash (passos locais)

```bash
# ── PASSO 1: Definir nova versão ───────────────────────────────────────────
export NOVA_TAG="1.1.0"

# ── PASSO 2: Build ────────────────────────────────────────────────────────
docker build \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG} \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:latest \
  .

# ── PASSO 3: Testar localmente ─────────────────────────────────────────────
docker run --rm -d \
  --name sigaa-test-nova \
  -p 3001:3000 \
  ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}

curl -s http://localhost:3001/status
docker stop sigaa-test-nova

# ── PASSO 4: Publicar ──────────────────────────────────────────────────────
docker push ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}
docker push ${DOCKER_USER}/${IMAGE_NAME}:latest
```

#### 🐧 Na VM Linux — via SSH (passos 5 e 6, iguais para qualquer OS local)

```bash
# ── PASSO 5: Atualizar o serviço no Swarm ─────────────────────────────────
# Substitua seu-usuario/sigaa-api:1.1.0 pela sua imagem
docker service update \
  --image seu-usuario/sigaa-api:1.1.0 \
  --with-registry-auth \
  sigaa_sigaa-api

# ── PASSO 6: Acompanhar o update ───────────────────────────────────────────
watch docker service ps sigaa_sigaa-api
```

### 9.2 Atualizar apenas variáveis de ambiente (sem nova imagem)

```bash
docker service update \
  --env-add MAX_SESSIONS=8 \
  --env-add SESSION_TIMEOUT_MIN=20 \
  sigaa_sigaa-api
```

### 9.3 Escalar réplicas

```bash
# Aumentar para 2 réplicas (garanta RAM suficiente: 2 × 2GB = 4GB)
docker service scale sigaa_sigaa-api=2

# Voltar para 1
docker service scale sigaa_sigaa-api=1
```

---

## 10. Rollback em caso de falha

```bash
# Rollback automático para a versão anterior
docker service rollback sigaa_sigaa-api

# Verificar após rollback
docker service ps sigaa_sigaa-api
docker service logs -f sigaa_sigaa-api --tail 50
```

---

## 11. Troubleshooting

### Xvfb não inicia dentro do container

```bash
# Sintoma: "cannot open display :99" nos logs
# Verificar:
docker exec -it <container_id> bash
ps aux | grep Xvfb
ls -la /tmp/.X11-unix/

# Solução: iniciar manualmente para ver o erro
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp -ac +extension GLX +render -noreset
```

### Chromium falha com "No usable sandbox"

```bash
# Sintoma: "Running as root without --no-sandbox is not supported"
# Solução 1: garantir que o usuário não é root (já feito no Dockerfile)
# Solução 2: adicionar flag ao rodar a stack
docker run --cap-add=SYS_ADMIN ${DOCKER_USER}/${IMAGE_NAME}:latest

# No Swarm, no docker-stack.yml, adicione em deploy:
# cap_add:
#   - SYS_ADMIN
```

### Container em loop de reinicialização

```bash
# Ver o histórico de tasks falhas
docker stack ps sigaa --no-trunc | grep -i shutdown

# Ver logs da task que falhou (ID da task no comando acima)
docker service logs sigaa_sigaa-api 2>&1 | tail -50
```

### Memória insuficiente

```bash
# Ver uso de memória dos containers
docker stats --no-stream

# Se OOMKilled aparecer:
docker inspect <container_id> | grep OOMKilled
# Solução: aumentar o limite em docker-stack.yml ou reduzir MAX_SESSIONS
```

### Permissão negada no /tmp

```bash
# O usuário sigaauser precisa escrever em /tmp para o Xvfb
# Verificar permissões do volume
docker exec <container_id> ls -la /tmp
# Deve ser drwxrwxrwt (1777)
```

---

## Referência rápida de comandos

| Ação | Comando |
|------|---------|
| Build | `docker build -t user/sigaa-api:tag .` |
| Push | `docker push user/sigaa-api:tag` |
| Deploy | `docker stack deploy -c docker-stack.yml sigaa` |
| Status | `docker stack services sigaa` |
| Logs | `docker service logs -f sigaa_sigaa-api` |
| Update | `docker service update --image user/sigaa-api:nova-tag sigaa_sigaa-api` |
| Rollback | `docker service rollback sigaa_sigaa-api` |
| Remover stack | `docker stack rm sigaa` |
