import WebTorrent from 'webtorrent';
import { RondevuConnectionManager } from './RondevuConnectionManager.js';

export { RondevuConnectionManager, RondevuConnectionManagerOptions, Credential, WebRTCPolyfill } from './RondevuConnectionManager.js';

// Example usage
// Check if this file is being run directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const client = new WebTorrent();

  // Initialize the Rondevu connection manager
  const connectionManager = new RondevuConnectionManager(client, {
    rondevuServer: 'https://api.ronde.vu', // Optional: defaults to this
    maxPeersPerTorrent: 50,
    debug: true,
    refreshInterval: 30000, // 30 seconds
  });

  // Add a torrent (example with a magnet link)
  const magnetURI = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10';

  client.add(magnetURI, (torrent) => {
    console.log(`Torrent added: ${torrent.name}`);
    console.log(`Info hash: ${torrent.infoHash}`);

    torrent.on('download', () => {
      console.log(`Progress: ${(torrent.progress * 100).toFixed(2)}%`);
      console.log(`Peers: ${torrent.numPeers}`);
      console.log(`Download speed: ${(torrent.downloadSpeed / 1024).toFixed(2)} KB/s`);
    });

    torrent.on('done', () => {
      console.log('Download complete!');
      console.log('Stats:', connectionManager.getStats());
    });
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    connectionManager.destroy();
    client.destroy(() => {
      console.log('WebTorrent client destroyed');
      process.exit(0);
    });
  });
}
