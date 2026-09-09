// Accept explicit navigation/autoplay endpoints, never arbitrary related videos.
export function extractNavigation(data) {
  const results = data?.contents?.singleColumnWatchNextResults;
  const set = results?.autoplay?.autoplay?.sets?.[0];
  const previous = set?.previousVideoRenderer?.autoplayEndpointRenderer?.endpoint || null;
  let next = set?.nextVideoRenderer?.autoplayEndpointRenderer?.endpoint || null;
  let autoplay = set?.autoplayVideoRenderer?.mdxAutoplayVideoRenderer?.navigationEndpoint || null;
  const desktop = data?.contents?.twoColumnWatchNextResults;
  // Desktop watch-next explicitly labels its autoplay choice.
  for (const item of desktop?.secondaryResults?.secondaryResults?.results || []) {
    const entries = item?.compactAutoplayRenderer?.contents || [];
    for (const entry of entries) {
      autoplay ||= entry?.compactVideoRenderer?.navigationEndpoint || null;
    }
  }
  autoplay ||= data?.playerOverlays?.playerOverlayRenderer?.autoplay
    ?.playerOverlayAutoplayRenderer?.nextButton?.buttonRenderer?.navigationEndpoint || null;
  // The selected playlist row identifies the real successor, not a recommendation.
  const panel = desktop?.playlist?.playlist || results?.playlist?.playlist;
  const rows = panel?.contents || [];
  const selected = rows.findIndex(row => row?.playlistPanelVideoRenderer?.selected);
  if (!next && selected >= 0) {
    next = rows[selected + 1]?.playlistPanelVideoRenderer?.navigationEndpoint || null;
  }
  const valid = endpoint => typeof endpoint?.watchEndpoint?.videoId === 'string'
    && endpoint.watchEndpoint.videoId.length > 0 ? endpoint : null;
  return { previous: valid(previous), next: valid(next), autoplay: valid(autoplay) };
}
