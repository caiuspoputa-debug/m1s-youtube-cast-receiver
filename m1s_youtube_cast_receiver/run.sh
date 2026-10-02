#!/usr/bin/with-contenv bashio
set -e

if ! node /app/migrate-friendly-name-options.mjs; then
  bashio::log.warning "Could not migrate the legacy Cast friendly-name settings; startup will continue."
fi

if options="$(bashio::addon.options 2>/dev/null)"; then
  if bashio::jq.exists "${options}" '.individual_friendly_names'; then
    bashio::log.info "Removing the legacy individual_friendly_names option after migration."
    if ! bashio::addon.option 'individual_friendly_names'; then
      bashio::log.warning "Could not remove the legacy individual_friendly_names option; startup will continue."
    fi
  fi
else
  bashio::log.warning "Could not inspect legacy add-on options; startup will continue."
fi

bashio::log.info "Starting M1S YouTube Cast Receiver..."
exec node /app/index.mjs
