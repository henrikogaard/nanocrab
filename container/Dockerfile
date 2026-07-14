# NanoCrab Agent Container
# Runs the NanoCrab agent runner in an isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium and Vibe (Python)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    poppler-utils \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install agent runtimes globally (version-pinned)
ARG PI_VERSION=0.73.1
ARG VIBE_VERSION=2.19.1
RUN npm install -g \
    agent-browser@0.31.1 \
    @anthropic-ai/claude-code@2.1.207 \
    @openai/codex@0.144.3 \
    opencode-ai@1.17.18 \
    playwright@1.61.1 \
    @mariozechner/pi-coding-agent@${PI_VERSION} && \
    \
    # Install Mistral Vibe (PyPI package, not npm)
    python3 -m venv /usr/local/share/vibe && \
    /usr/local/share/vibe/bin/pip install --no-cache-dir "mistral-vibe==${VIBE_VERSION}" && \
    chmod -R 755 /usr/local/share/vibe && \
    ln -s /usr/local/share/vibe/bin/vibe /usr/local/bin/vibe

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
