# Rondevu WebTorrent Demo

This demo shows how to use `@xtr-dev/rondevu-webtorrent` to share files via WebTorrent with Rondevu-enhanced peer discovery.

## Overview

The demo includes two scripts:

1. **`seed.js`** - Creates a torrent from a file and seeds it
2. **`leech.js`** - Downloads the torrent from the seeder

Both scripts use Rondevu WebRTC signaling to discover each other and establish peer connections.

## Prerequisites

Make sure you've built the project first:

```bash
cd ..
npm install
npm run build
```

### Important Note: WebRTC in Node.js

The Rondevu WebRTC peer discovery features require a WebRTC implementation. This demo **includes the @roamhq/wrtc polyfill** which enables WebRTC functionality in Node.js.

The demo scripts already import and configure the polyfill, so Rondevu WebRTC connections work out of the box in Node.js!

## Quick Start

### Step 1: Start the Seeder

Open a terminal and run:

```bash
npm run demo:seed
```

Or directly:

```bash
node demo/seed.mjs
```

This will:
- Create a torrent from `demo/shared-files/test-file.txt`
- Display the magnet URI
- Save the magnet URI to `demo/magnet-uri.txt`
- Start seeding with Rondevu peer discovery enabled

You should see output like:

```
🌱 Starting Rondevu WebTorrent Seeder Demo

📦 Creating torrent from file: /path/to/demo/shared-files/test-file.txt

✅ Torrent created successfully!

📋 Torrent Information:
   Name: test-file.txt
   Info Hash: abc123...
   Magnet URI: magnet:?xt=urn:btih:abc123...
   Size: 512 bytes

================================================================================
COPY THIS MAGNET URI TO USE IN THE LEECHER:
magnet:?xt=urn:btih:abc123...
================================================================================

💾 Magnet URI saved to: /path/to/demo/magnet-uri.txt

🔗 Initializing Rondevu connection manager...
🌟 Seeding started! Press Ctrl+C to stop.
```

**Keep this terminal running!**

### Step 2: Start the Leecher

Open a **second terminal** and run:

```bash
npm run demo:leech
```

Or directly:

```bash
node demo/leech.mjs
```

This will automatically read the magnet URI from `magnet-uri.txt` and start downloading.

Alternatively, you can pass the magnet URI directly:

```bash
node demo/leech.mjs "magnet:?xt=urn:btih:abc123..."
```

You should see output like:

```
🌱 Starting Rondevu WebTorrent Leecher Demo

📖 Using magnet URI from file: /path/to/demo/magnet-uri.txt
🔗 Magnet URI: magnet:?xt=urn:btih:abc123...

📥 Download directory: /path/to/demo/downloads
🔗 Initializing Rondevu connection manager...

📦 Adding torrent...

✅ Torrent added successfully!

📋 Torrent Information:
   Name: test-file.txt
   Info Hash: abc123...
   Size: 512 B
   Files: 1

📄 Files:
   1. test-file.txt (512 B)

⏳ Waiting for peers and starting download...

🤝 New peer connected: WebRTC
📥 Progress: 100.00% | Downloaded: 512 B/512 B | Speed: 512 B/s | Peers: 1

✅ Download complete!
```

## What's Happening?

1. **Seeder** creates a torrent and publishes an offer to Rondevu with the torrent's `infoHash` as the topic
2. **Leecher** starts and also publishes an offer for the same `infoHash`
3. Both clients query Rondevu for other peers interested in the same torrent
4. They discover each other through Rondevu's signaling server
5. A WebRTC peer connection is established directly between them
6. Files are transferred peer-to-peer over the WebRTC data channel

## Directory Structure

```
demo/
├── README.md              # This file
├── seed.mjs              # Seeder script
├── leech.mjs             # Leecher script
├── shared-files/         # Files to seed
│   └── test-file.txt    # Test file
├── downloads/            # Downloaded files go here
└── magnet-uri.txt       # Auto-generated magnet URI
```

## Testing with Your Own Files

You can seed your own files by modifying the `FILE_PATH` in `seed.mjs` or by adding files to the `shared-files/` directory:

```javascript
// In seed.mjs, change this line:
const FILE_PATH = path.join(__dirname, 'shared-files', 'your-file.txt');
```

Or seed an entire directory:

```javascript
// Seed a directory
client.seed('/path/to/directory', (torrent) => {
  // ...
});
```

## Advanced Usage

### Custom Rondevu Server

If you're running your own Rondevu server, you can change the server URL:

```javascript
// In both seed.mjs and leech.mjs, modify:
const connectionManager = new RondevuConnectionManager(client, {
  rondevuServer: 'https://your-rondevu-server.com',
  // ...
});
```

### Debug Logging

Debug logging is enabled by default in the demo scripts. You'll see detailed logs about:
- Peer discovery
- WebRTC connection establishment
- Torrent events
- Upload/download stats

To disable debug logging, set `debug: false` in the options:

```javascript
const connectionManager = new RondevuConnectionManager(client, {
  debug: false,
  // ...
});
```

### Monitoring Stats

Both scripts display periodic stats. The seeder shows upload stats every 10 seconds, and the leecher shows download progress in real-time.

## Troubleshooting

### No peers found

If the leecher can't find the seeder:

1. **Check both scripts are running** - Make sure the seeder is running before starting the leecher
2. **Check network connectivity** - Both peers need to be able to reach `https://api.ronde.vu`
3. **Wait a bit** - Peer discovery can take 5-30 seconds
4. **Check firewalls** - WebRTC connections may require STUN/TURN servers in restrictive networks

### WebRTC connection fails

If you see WebRTC connection errors:

1. **Use TURN servers** - Add custom RTCConfiguration in the scripts:
   ```javascript
   const connectionManager = new RondevuConnectionManager(client, {
     rtcConfig: {
       iceServers: [
         { urls: 'stun:stun.l.google.com:19302' },
         { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
       ]
     }
   });
   ```

2. **Check NAT/firewall settings** - Some networks block WebRTC connections

### Build errors

Make sure you've built the project:

```bash
cd ..
npm run build
```

## Next Steps

- Try seeding larger files or directories
- Run multiple leechers simultaneously
- Monitor the Rondevu server logs to see peer discovery in action
- Experiment with different configuration options (maxPeersPerTorrent, refreshInterval, etc.)
- Integrate Rondevu WebTorrent into your own applications

## Learn More

- [WebTorrent Documentation](https://webtorrent.io/docs)
- [Rondevu Documentation](https://github.com/xtr-dev/rondevu)
- [Main README](../README.md)
