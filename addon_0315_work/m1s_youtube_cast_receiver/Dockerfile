FROM ghcr.io/home-assistant/base:3.23

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache \
      nodejs \
      npm \
      python3 \
      py3-pip \
      ffmpeg \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --pre "yt-dlp[default]"

WORKDIR /app
COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY index.mjs /app/index.mjs
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
