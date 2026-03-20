FROM node:20-slim

# ─── Metadados ───────────────────────────────────────────────────────────────
LABEL maintainer="seu-email@exemplo.com"
LABEL description="SIGAA API Server com Puppeteer + Chromium headless via Xvfb"
LABEL version="1.0.0"

# ─── Dependências do sistema para Chromium + Xvfb ────────────────────────────
# Atualiza e instala em uma única camada para minimizar o tamanho da imagem
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Servidor de display virtual
    xvfb \
    # Chromium e dependências gráficas
    chromium \
    # Fontes
    fonts-liberation \
    fonts-noto-cjk \
    # Bibliotecas de sistema para Chromium
    libnss3 \
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    libdrm2 \
    libxkbcommon0 \
    # Utilitários
    ca-certificates \
    wget \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# ─── Usuário não-root (segurança) ────────────────────────────────────────────
# Cria usuário dedicado para rodar a aplicação
RUN groupadd -r sigaauser && useradd -r -g sigaauser -d /app -s /sbin/nologin sigaauser

# ─── Diretório de trabalho ───────────────────────────────────────────────────
WORKDIR /app

# ─── Copiar todo o código-fonte ──────────────────────────────────────────────
# IMPORTANTE: precisa vir ANTES do npm install porque o package.json tem um
# script "prepare" que executa "npm run build" automaticamente durante o
# install — e o build precisa do src/ já presente no container.
COPY . .

# ─── Instalar dependências e compilar ────────────────────────────────────────
# --ignore-scripts evita que o "prepare" rode durante o install (evitamos
# rodar o build duas vezes). Compilamos explicitamente logo abaixo.
RUN npm install --legacy-peer-deps --ignore-scripts && npm cache clean --force

# Compila o TypeScript explicitamente após o install
RUN npm run build

# ─── Ajustar permissões ──────────────────────────────────────────────────────
RUN chown -R sigaauser:sigaauser /app

# ─── Variáveis de ambiente ───────────────────────────────────────────────────
# Display virtual do Xvfb
ENV DISPLAY=:99
# Porta da API
ENV PORT=3000
# Modo de produção
ENV NODE_ENV=production
# CRÍTICO: Aponta para o Chromium do sistema (apt), não o baixado pelo puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Evita que o puppeteer tente baixar o Chromium durante o npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Configurações padrão de sessão (sobrescreváveis via -e no docker run)
ENV MAX_SESSIONS=5
ENV SESSION_TIMEOUT_MIN=15

# ─── Porta exposta ───────────────────────────────────────────────────────────
EXPOSE 3000

# ─── Mudar para usuário não-root ─────────────────────────────────────────────
USER sigaauser

# ─── Healthcheck ─────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# ─── Entrypoint ──────────────────────────────────────────────────────────────
# 1. Inicia Xvfb em background
# 2. Aguarda 2s para o display ficar disponível
# 3. Inicia o servidor Node
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 -nolisten tcp -ac +extension GLX +render -noreset & sleep 2 && node sigaa-api-server.js"]
