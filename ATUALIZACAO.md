# SIGAA API — Guia de Atualização

> Processo de atualização com zero downtime via Docker Swarm rolling update

---

## Fluxo visual

```
LOCAL                          DOCKER HUB              VM (SWARM)
  │                                │                       │
  ├─ edita código                  │                       │
  ├─ docker build :nova-tag ──────►│                       │
  ├─ docker push :nova-tag ────────►│                       │
  │                                │                       │
  │  docker service update ────────┼──────────────────────►│
  │                                │                       ├─ pull :nova-tag
  │                                │                       ├─ sobe novo container
  │                                │                       ├─ aguarda healthcheck ✓
  │                                │                       ├─ derruba container antigo
  │                                │                       └─ ✅ atualização concluída
```

---

## Passo a passo

### Passo 1 — Fazer as alterações no código

Edite os arquivos necessários no seu projeto local.

### Passo 2 — Definir a nova versão

```bash
export DOCKER_USER="seu-usuario"
export IMAGE_NAME="sigaa-api"
export NOVA_TAG="1.1.0"          # use versionamento semântico: MAJOR.MINOR.PATCH
export CURRENT_TAG="1.0.0"       # tag atual em produção (para referência)
```

### Passo 3 — Build da nova imagem

```bash
docker build \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG} \
  --tag ${DOCKER_USER}/${IMAGE_NAME}:latest \
  .

# Confirmar que a imagem foi criada
docker images | grep ${IMAGE_NAME}
```

### Passo 4 — Teste local obrigatório

```bash
# Rodar na porta 3001 para não conflitar com produção
docker run --rm -d \
  --name sigaa-pre-deploy \
  -p 3001:3000 \
  -e MAX_SESSIONS=1 \
  ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}

# Aguardar inicialização
sleep 5

# Testar
curl -s http://localhost:3001/health
echo "Exit code: $?"

# Parar teste
docker stop sigaa-pre-deploy
```

> ⛔ **Não prossiga se o teste falhar.**

### Passo 5 — Publicar no Docker Hub

```bash
docker push ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG}
docker push ${DOCKER_USER}/${IMAGE_NAME}:latest
```

### Passo 6 — Atualizar o serviço no Swarm

```bash
# SSH na VM de produção
ssh usuario@IP-DA-VM

# Executar o update (o Swarm faz rolling update automaticamente)
docker service update \
  --image ${DOCKER_USER}/${IMAGE_NAME}:${NOVA_TAG} \
  --with-registry-auth \
  sigaa_sigaa-api
```

### Passo 7 — Monitorar o update

```bash
# Acompanhar em tempo real (Ctrl+C para sair)
watch -n 2 docker service ps sigaa_sigaa-api

# Ver logs durante o update
docker service logs -f sigaa_sigaa-api --tail 30
```

Estados esperados durante o update:

| Estado | Significado |
|--------|-------------|
| `Preparing` | Baixando nova imagem |
| `Starting` | Iniciando novo container |
| `Running` | Novo container saudável |
| `Shutdown` | Container antigo sendo removido |
| `Complete` | ✅ Update finalizado |

### Passo 8 — Validar após o update

```bash
# Confirmar versão rodando
docker service inspect sigaa_sigaa-api \
  --pretty | grep -A2 "Image"

# Testar endpoint
curl -s http://IP-DA-VM:3000/health

# Ver logs pós-update
docker service logs sigaa_sigaa-api --tail 20
```

---

## Rollback imediato

Se algo der errado após o update:

```bash
# Rollback automático para a versão anterior
docker service rollback sigaa_sigaa-api

# Confirmar
docker service ps sigaa_sigaa-api
```

---

## Atualização de configuração (sem nova imagem)

Para alterar apenas variáveis de ambiente:

```bash
docker service update \
  --env-add MAX_SESSIONS=8 \
  --env-add SESSION_TIMEOUT_MIN=20 \
  sigaa_sigaa-api
```

---

## Forçar re-deploy da mesma imagem

Se precisar reiniciar o serviço sem mudar a imagem:

```bash
docker service update \
  --force \
  sigaa_sigaa-api
```

---

## Changelog de versões (mantenha atualizado)

| Tag | Data | Mudanças |
|-----|------|----------|
| `1.0.0` | AAAA-MM-DD | Versão inicial |
| `1.1.0` | AAAA-MM-DD | Descreva aqui |
