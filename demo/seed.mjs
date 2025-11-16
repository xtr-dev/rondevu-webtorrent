#!/usr/bin/env node

/**
 * Seeder Demo Script
 * Creates a torrent from a file and seeds it using Rondevu for peer discovery
 */

import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RondevuConnectionManager } from '../dist/index.js';
import wrtc from '@roamhq/wrtc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File to seed
const FILE_PATH = path.join(__dirname, 'shared-files', 'test-file.txt');

// Check if file exists
if (!fs.existsSync(FILE_PATH)) {
  console.error(`Error: File not found at ${FILE_PATH}`);
  console.error('Make sure you have created the test file in demo/shared-files/');
  process.exit(1);
}

console.log('🌱 Starting Rondevu WebTorrent Seeder Demo\n');

// Create WebTorrent client
const client = new WebTorrent();

console.log('📦 Creating torrent from file:', FILE_PATH);

// Create torrent from file
client.seed(FILE_PATH, { name: 'test-file.txt' }, (torrent) => {
  console.log('\n✅ Torrent created successfully!\n');
  console.log('📋 Torrent Information:');
  console.log('   Name:', torrent.name);
  console.log('   Info Hash:', torrent.infoHash);
  console.log('   Magnet URI:', torrent.magnetURI);
  console.log('   Size:', torrent.length, 'bytes');
  console.log('\n' + '='.repeat(80));
  console.log('COPY THIS MAGNET URI TO USE IN THE LEECHER:');
  console.log(torrent.magnetURI);
  console.log('='.repeat(80) + '\n');

  // Save magnet URI to file for easy sharing
  const magnetFile = path.join(__dirname, 'magnet-uri.txt');
  fs.writeFileSync(magnetFile, torrent.magnetURI);
  console.log(`💾 Magnet URI saved to: ${magnetFile}\n`);

  // Initialize Rondevu connection manager
  console.log('🔗 Initializing Rondevu connection manager...');
  const connectionManager = new RondevuConnectionManager(client, {
    rondevuServer: 'https://api.ronde.vu',
    maxPeersPerTorrent: 50,
    debug: true,
    refreshInterval: 30000, // 30 seconds
    wrtc: wrtc, // WebRTC polyfill for Node.js
  });

  // Monitor torrent events
  torrent.on('upload', () => {
    console.log(`📤 Upload: ${formatBytes(torrent.uploaded)} | ` +
                `Rate: ${formatBytes(torrent.uploadSpeed)}/s | ` +
                `Peers: ${torrent.numPeers}`);
  });

  torrent.on('wire', (wire) => {
    console.log(`🤝 New peer connected: ${wire.remoteAddress || 'WebRTC'}`);
  });

  // Display stats periodically
  const statsInterval = setInterval(() => {
    const stats = connectionManager.getStats();
    console.log('\n📊 Stats:');
    console.log('   Peers:', torrent.numPeers);
    console.log('   Uploaded:', formatBytes(torrent.uploaded));
    console.log('   Upload rate:', formatBytes(torrent.uploadSpeed) + '/s');
    console.log('   Rondevu connections:', stats.torrents[0]?.peerCount || 0);
  }, 10000); // Every 10 seconds

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n\n🛑 Shutting down...');
    clearInterval(statsInterval);
    connectionManager.destroy();
    client.destroy(() => {
      console.log('✅ Seeder stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('🌟 Seeding started! Press Ctrl+C to stop.\n');
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
