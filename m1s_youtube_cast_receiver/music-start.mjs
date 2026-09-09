export function isMusicSender(senders, client) {
  const list = senders || [];
  if (list.length) return list.every(sender => sender.client?.key === 'YTMUSIC');
  return client?.key === 'YTMUSIC';
}
