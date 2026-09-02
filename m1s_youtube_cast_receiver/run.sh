#!/usr/bin/with-contenv bashio
set -e
bashio::log.info "Starting M1S YouTube Cast Receiver..."
exec node /app/index.mjs
