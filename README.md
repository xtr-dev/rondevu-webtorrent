# @xtr-dev/rondevu-webtorrent

> **⚠️ EARLY DEVELOPMENT WARNING**: This package is in early development (version < 1.0.0). The API is subject to change, and there may be bugs or incomplete features. Use at your own risk in production environments.

WebTorrent peer discovery plugin using [Rondevu](https://github.com/xtr-dev/rondevu) WebRTC signaling for peer connectivity.

## Overview

`@xtr-dev/rondevu-webtorrent` acts as a plugin for [WebTorrent](https://webtorrent.io/), providing automatic peer discovery through the Rondevu WebRTC signaling service. It complements traditional BitTorrent peer discovery methods (DHT, trackers) by using WebRTC data channels for direct peer-to-peer connections.

## Features

- **Automatic Peer Discovery**: Automatically discovers and connects to peers for each torrent
- **WebRTC Signaling**: Uses Rondevu for WebRTC offer/answer exchange and ICE candidate signaling
- **Topic-Based Discovery**: Each torrent's `infoHash` is used as a topic for peer discovery
- **Bloom Filter Optimization**: Uses bloom filters to avoid rediscovering peers, reducing bandwidth and API calls
- **Configurable**: Control max peers per torrent, refresh intervals, and WebRTC configuration
- **Credential Persistence**: Save and reuse Rondevu credentials across sessions
- **Debug Mode**: Enable detailed logging to monitor peer discovery and connections

## Installation

```bash
npm install @xtr-dev/rondevu-webtorrent
```

## Demo

A complete working demo is available in the [`demo/`](./demo) folder. The demo includes:
- **Seeder script** - Creates and seeds a torrent
- **Leecher script** - Downloads the torrent
- Step-by-step instructions

See the [demo README](./demo/README.md) for details.

## Quick Start

### Browser

```typescript
import WebTorrent from 'webtorrent';
import { RondevuConnectionManager } from '@xtr-dev/rondevu-webtorrent';

// Create WebTorrent client
const client = new WebTorrent();

// Initialize Rondevu connection manager
const connectionManager = new RondevuConnectionManager(client, {
  rondevuServer: 'https://api.ronde.vu', // Optional: defaults to this
  maxPeersPerTorrent: 50,
  debug: true,
  refreshInterval: 30000, // 30 seconds
});

// Add a torrent
const magnetURI = 'magnet:?xt=urn:btih:...';
client.add(magnetURI, (torrent) => {
  console.log(`Torrent added: ${torrent.name}`);

  torrent.on('download', () => {
    console.log(`Progress: ${(torrent.progress * 100).toFixed(2)}%`);
    console.log(`Peers: ${torrent.numPeers}`);
  });

  torrent.on('done', () => {
    console.log('Download complete!');
  });
});
```

### Node.js (with WebRTC polyfill)

```typescript
import WebTorrent from 'webtorrent';
import { RondevuConnectionManager } from '@xtr-dev/rondevu-webtorrent';
import wrtc from '@roamhq/wrtc';

const client = new WebTorrent();

// Initialize with wrtc polyfill for Node.js
const connectionManager = new RondevuConnectionManager(client, {
  rondevuServer: 'https://api.ronde.vu',
  maxPeersPerTorrent: 50,
  debug: true,
  wrtc: wrtc, // Required for WebRTC in Node.js
});

// Rest is the same as browser...
```

## API

### `RondevuConnectionManager`

The main class that manages peer discovery for WebTorrent.

#### Constructor

```typescript
new RondevuConnectionManager(client: WebTorrent.Instance, options?: RondevuConnectionManagerOptions)
```

#### Options

```typescript
interface RondevuConnectionManagerOptions {
  /**
   * Rondevu server base URL
   * @default 'https://api.ronde.vu'
   */
  rondevuServer?: string;

  /**
   * Maximum number of peer connections per torrent
   * @default 50
   */
  maxPeersPerTorrent?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Interval in milliseconds to refresh peer discovery
   * @default 30000 (30 seconds)
   */
  refreshInterval?: number;

  /**
   * Custom RTCConfiguration for WebRTC peer connections
   */
  rtcConfig?: RTCConfiguration;

  /**
   * Existing Rondevu credentials to reuse
   */
  credentials?: { peerId: string; secret: string };

  /**
   * WebRTC polyfill for Node.js (e.g., @roamhq/wrtc)
   * Required for WebRTC functionality in Node.js environments
   */
  wrtc?: {
    RTCPeerConnection: typeof RTCPeerConnection;
    RTCSessionDescription: typeof RTCSessionDescription;
    RTCIceCandidate: typeof RTCIceCandidate;
  };
}
```

#### Methods

##### `discoverPeers(infoHash: string): Promise<void>`

Manually trigger peer discovery for a specific torrent.

```typescript
await connectionManager.discoverPeers(torrent.infoHash);
```

##### `getStats()`

Get statistics about the connection manager.

```typescript
const stats = connectionManager.getStats();
console.log(stats);
// {
//   activeTorrents: 1,
//   peerId: 'abc123...',
//   rondevuServer: 'https://api.ronde.vu',
//   torrents: [
//     { infoHash: '...', peerCount: 5 }
//   ]
// }
```

##### `getCredentials(): Credentials | undefined`

Get the current Rondevu credentials for persistence across sessions.

```typescript
const credentials = connectionManager.getCredentials();
// Save credentials to storage
localStorage.setItem('rondevu-credentials', JSON.stringify(credentials));

// Later, reuse credentials
const savedCredentials = JSON.parse(localStorage.getItem('rondevu-credentials'));
const newManager = new RondevuConnectionManager(client, {
  credentials: savedCredentials
});
```

##### `destroy(): void`

Clean up all resources and disconnect from Rondevu.

```typescript
connectionManager.destroy();
```

## How It Works

1. **Initialization**: When you create a `RondevuConnectionManager`, it registers with the Rondevu signaling server
2. **Torrent Added**: When a torrent is added to WebTorrent:
   - The manager creates a bloom filter to track seen peers
   - The manager creates a WebRTC offer and publishes it to Rondevu with the torrent's `infoHash` as the topic
   - The manager queries Rondevu for other peers offering the same `infoHash`, passing the bloom filter to exclude already-seen peers
   - WebRTC connections are established with discovered peers
   - Each discovered peer ID is added to the bloom filter
3. **Peer Connection**: Once WebRTC connections are established, the peer connections are added to the WebTorrent instance
4. **Periodic Refresh**: The manager periodically refreshes peer discovery to find new peers, using the bloom filter to avoid reconnecting to already-seen peers
5. **Cleanup**: When a torrent is removed, all associated peer connections, offers, and bloom filters are cleaned up

## Advanced Usage

### Custom RTCConfiguration

Provide custom STUN/TURN servers for WebRTC connections:

```typescript
const connectionManager = new RondevuConnectionManager(client, {
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:turn.example.com:3478',
        username: 'user',
        credential: 'pass'
      }
    ]
  }
});
```

### Persistent Credentials

Save and reuse credentials to maintain the same peer ID:

```typescript
// First time
const manager = new RondevuConnectionManager(client, { debug: true });

// Save credentials after initialization
setTimeout(() => {
  const credentials = manager.getCredentials();
  fs.writeFileSync('credentials.json', JSON.stringify(credentials));
}, 1000);

// Next time
const savedCredentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
const manager = new RondevuConnectionManager(client, {
  credentials: savedCredentials
});
```

### Graceful Shutdown

Always clean up when your application exits:

```typescript
process.on('SIGINT', () => {
  console.log('Shutting down...');
  connectionManager.destroy();
  client.destroy(() => {
    console.log('WebTorrent client destroyed');
    process.exit(0);
  });
});
```

## Limitations

- **Node.js WebRTC Support**: Node.js doesn't have native WebRTC support. To enable WebRTC functionality in Node.js, you need to install and pass a WebRTC polyfill like `@roamhq/wrtc` via the `wrtc` option (see the Node.js Quick Start example above). The polyfill requires native compilation during installation. Without the polyfill, the package will still work in Node.js using WebTorrent's traditional peer discovery methods (DHT, trackers), but Rondevu WebRTC peer discovery will not be available.
- **Browser Support**: WebRTC works natively in modern browsers, making this the ideal environment for full Rondevu WebRTC functionality without requiring any polyfills
- **Network Requirements**: The Rondevu signaling server must be accessible to all peers
- **Restrictive Networks**: WebRTC connections may not work in restrictive network environments without TURN servers

## Roadmap

- [x] Bloom filter support for efficient peer discovery
- [ ] Better error handling and recovery
- [ ] Metrics and monitoring
- [ ] Connection pooling and optimization
- [ ] Automated testing suite

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## Related Projects

- [WebTorrent](https://webtorrent.io/) - Streaming torrent client for Node.js and the browser
- [Rondevu](https://github.com/xtr-dev/rondevu) - WebRTC signaling and peer discovery service
