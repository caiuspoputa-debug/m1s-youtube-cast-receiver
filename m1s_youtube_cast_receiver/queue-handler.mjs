/** Use the sender's explicit queue before remote TV metadata navigation. */
export function createQueueHandler(BaseHandler, autoplayEnabled) {
  return class SenderQueueHandler extends BaseHandler {
    async getPreviousNextVideos(target, playlist) {
      const ids = playlist.videoIds || [];
      const supplied = Number(target.context?.index);
      const index = Number.isInteger(supplied) && ids[supplied] === target.id
        ? supplied : ids.indexOf(target.id);
      if (index < 0) return super.getPreviousNextVideos(target, playlist);
      const video = i => i >= 0 && i < ids.length ? {
        id: ids[i], client: target.client,
        context: { ...target.context, playlistId: playlist.id, index: i }
      } : null;
      const previous = video(index - 1);
      const next = video(index + 1);
      if (next || playlist.autoplayMode !== autoplayEnabled) return { previous, next };
      // Only recommendations beyond the explicit queue need a remote lookup.
      let timer;
      try {
        const remote = await Promise.race([
          super.getPreviousNextVideos(target, playlist),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 12000); })
        ]);
        const candidate = remote?.next?.id !== target.id ? remote?.next : null;
        if (!candidate) this.logger?.warn?.('[M1S-YT] No continuation returned for current queue boundary; autoplay is enabled.');
        return { previous, next: candidate || null };
      } catch (_) {
        return { previous, next: null };
      } finally { clearTimeout(timer); }
    }
  };
}
