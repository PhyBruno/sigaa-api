
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
