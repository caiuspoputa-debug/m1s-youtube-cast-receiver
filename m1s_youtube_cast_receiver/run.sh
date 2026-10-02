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

legacy_individual_match='aqara_m1s_zigbee_router'
current_individual_match="$(bashio::config 'individual_match' '')"
if [[ "${current_individual_match}" == "${legacy_individual_match}" ]]; then
  bashio::log.info "Expanding individual receiver discovery to include the M1S coordinator."
  if ! bashio::addon.option 'individual_match' 'aqara_m1s_zigbee'; then
    bashio::log.warning "Could not persist the expanded individual_match option; runtime discovery will still include the coordinator."
  fi
fi

bashio::log.info "Starting M1S YouTube Cast Receiver..."
exec node /app/index.mjs
