# Build stage
FROM node:22-trixie-slim AS builder

# Build tools are needed to compile the native dependencies
# (sharp, node-av, node-datachannel, zeromq).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage
# A recent glibc is required: node-av ships a glibc-only native binding and
# node-datachannel needs GLIBC_2.38+. Debian trixie provides glibc 2.41.
FROM node:22-trixie-slim

# FFmpeg with libzmq (for the azmq audio filter used by discord-video-stream),
# plus VAAPI drivers for GPU transcoding (ENCODER=vaapi):
#   - intel-media-va-driver-non-free: Intel Broadwell (5th gen) and newer, incl. encoding
#   - i965-va-driver: older Intel GPUs
#   - mesa-va-drivers: AMD GPUs
#   - vainfo: run `docker exec orbiscast vainfo` to check the GPU is visible
# The Intel drivers only exist for amd64, so they are skipped on other architectures.
RUN arch="$(dpkg --print-architecture)" \
    && sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg mesa-va-drivers vainfo \
    && if [ "$arch" = "amd64" ]; then \
        apt-get install -y --no-install-recommends intel-media-va-driver-non-free i965-va-driver; \
    fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Metadata labels
LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/master/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

CMD ["npm", "run", "start:prod"]
