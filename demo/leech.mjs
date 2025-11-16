#!/usr/bin/env node

/**
 * Leecher Demo Script
 * Downloads a torrent using Rondevu for peer discovery
 */

import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RondevuConnectionManager } from '../dist/index.js';
import wrtc from '@roamhq/wrtc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get magnet URI from command line argument or file
let magnetURI = process.argv[2];

if (!magnetURI) {
  const magnetFile = path.join(__dirname, 'magnet-uri.txt');
  if (fs.existsSync(magnetFile)) {
    magnetURI = fs.readFileSync(magnetFile, 'utf8').trim();
    console.log('📖 Using magnet URI from file:', magnetFile);
  } else {
    console.error('❌ Error: No magnet URI provided');
    console.error('\nUsage:');
    console.error('  node leech.mjs <magnet-uri>');
    console.error('  OR run the seeder first to generate magnet-uri.txt');
    process.exit(1);
  }
}

console.log('🌱 Starting Rondevu WebTorrent Leecher Demo\n');
console.log('🔗 Magnet URI:', magnetURI.substring(0, 60) + '...\n');

// Create WebTorrent client
const client = new WebTorrent();

// Download directory
const downloadPath = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadPath)) {
  fs.mkdirSync(downloadPath, { recursive: true });
}

console.log('📥 Download directory:', downloadPath);

// Initialize Rondevu connection manager
console.log('🔗 Initializing Rondevu connection manager...\n');
const connectionManager = new RondevuConnectionManager(client, {
  rondevuServer: 'https://api.ronde.vu',
  maxPeersPerTorrent: 50,
  debug: true,
  refreshInterval: 30000, // 30 seconds
  wrtc: wrtc, // WebRTC polyfill for Node.js
});

// Add torrent
console.log('📦 Adding torrent...\n');
client.add(magnetURI, { path: downloadPath }, (torrent) => {
  console.log('✅ Torrent added successfully!\n');
  console.log('📋 Torrent Information:');
  console.log('   Name:', torrent.name);
  console.log('   Info Hash:', torrent.infoHash);
  console.log('   Size:', formatBytes(torrent.length));
  console.log('   Files:', torrent.files.length);
  console.log();

  // List files
  console.log('📄 Files:');
  torrent.files.forEach((file, i) => {
    console.log(`   ${i + 1}. ${file.name} (${formatBytes(file.length)})`);
  });
  console.log();

  console.log('⏳ Waiting for peers and starting download...\n');

  // Monitor download progress
  torrent.on('download', () => {
    const progress = (torrent.progress * 100).toFixed(2);
    const downloaded = formatBytes(torrent.downloaded);
    const total = formatBytes(torrent.length);
    const speed = formatBytes(torrent.downloadSpeed);
    const peers = torrent.numPeers;

    // Clear line and print progress
    process.stdout.write(`\r📥 Progress: ${progress}% | ` +
                        `Downloaded: ${downloaded}/${total} | ` +
                        `Speed: ${speed}/s | ` +
                        `Peers: ${peers}`);
  });

  torrent.on('wire', (wire) => {
    console.log(`\n🤝 New peer connected: ${wire.remoteAddress || 'WebRTC'}`);
  });

  torrent.on('done', () => {
    console.log('\n\n✅ Download complete!\n');
    console.log('📊 Final Stats:');
    console.log('   Downloaded:', formatBytes(torrent.downloaded));
    console.log('   Upload:', formatBytes(torrent.uploaded));
    console.log('   Ratio:', (torrent.uploaded / torrent.downloaded).toFixed(2));
    console.log('   Peers:', torrent.numPeers);
    console.log();

    console.log('📁 Downloaded files:');
    torrent.files.forEach((file) => {
      const filePath = path.join(downloadPath, file.path);
      console.log(`   ${filePath}`);
    });
    console.log();

    // Continue seeding for a bit
    console.log('🌱 Continuing to seed for 30 seconds...');
    setTimeout(() => {
      shutdown();
    }, 30000);
  });

  // Display stats periodically
  const statsInterval = setInterval(() => {
    const stats = connectionManager.getStats();
    console.log('\n📊 Connection Stats:');
    console.log('   WebTorrent peers:', torrent.numPeers);
    console.log('   Rondevu peer connections:', stats.torrents[0]?.peerCount || 0);
    console.log('   Progress:', (torrent.progress * 100).toFixed(2) + '%');
  }, 15000); // Every 15 seconds

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n\n🛑 Shutting down...');
    clearInterval(statsInterval);
    connectionManager.destroy();
    client.destroy(() => {
      console.log('✅ Leecher stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Error handling
client.on('error', (err) => {
  console.error('❌ WebTorrent error:', err.message);
});
