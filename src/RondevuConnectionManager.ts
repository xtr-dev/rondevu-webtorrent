import WebTorrent from 'webtorrent';
import { Rondevu, Credentials, RondevuPeer, BloomFilter } from '@xtr-dev/rondevu-client';

/**
 * WebRTC polyfill interface for Node.js environments
 */
export interface WebRTCPolyfill {
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCSessionDescription: typeof RTCSessionDescription;
  RTCIceCandidate: typeof RTCIceCandidate;
}

/**
 * Options for configuring the RondevuConnectionManager
 */
export interface RondevuConnectionManagerOptions {
  /**
   * Rondevu server base URL (default: 'https://api.ronde.vu')
   */
  rondevuServer?: string;

  /**
   * Maximum number of peer connections to establish per torrent (default: 50)
   */
  maxPeersPerTorrent?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Interval in milliseconds to refresh peer discovery (default: 30000ms)
   */
  refreshInterval?: number;

  /**
   * Custom RTCConfiguration for WebRTC peer connections
   */
  rtcConfig?: RTCConfiguration;

  /**
   * Existing rondevu credentials to reuse
   */
  credentials?: Credentials;

  /**
   * WebRTC polyfill for Node.js (e.g., @roamhq/wrtc)
   * Required for WebRTC functionality in Node.js environments
   */
  wrtc?: WebRTCPolyfill;
}

/**
 * Connection manager that uses Rondevu for WebTorrent peer discovery via WebRTC.
 * This class acts as a plugin for WebTorrent, automatically discovering
 * and connecting to peers through rondevu WebRTC signaling.
 */
export class RondevuConnectionManager {
  private client: WebTorrent.Instance;
  private rondevu: Rondevu;
  private torrentPeers: Map<string, Set<RondevuPeer>> = new Map();
  private torrentOffers: Map<string, string[]> = new Map();
  private torrentCleanupHandlers: Map<string, () => void> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private torrentBloomFilters: Map<string, BloomFilter> = new Map();
  private options: Required<Omit<RondevuConnectionManagerOptions, 'credentials' | 'rondevuServer' | 'rtcConfig' | 'wrtc'>> & {
    rondevuServer?: string;
    rtcConfig?: RTCConfiguration;
    wrtc?: WebRTCPolyfill;
  };

  constructor(
    client: WebTorrent.Instance,
    options: RondevuConnectionManagerOptions = {}
  ) {
    this.client = client;
    this.options = {
      rondevuServer: options.rondevuServer,
      maxPeersPerTorrent: options.maxPeersPerTorrent ?? 50,
      debug: options.debug ?? false,
      refreshInterval: options.refreshInterval ?? 30000,
      rtcConfig: options.rtcConfig,
      wrtc: options.wrtc,
    };

    this.rondevu = new Rondevu({
      baseUrl: options.rondevuServer,
      credentials: options.credentials,
      RTCPeerConnection: options.wrtc?.RTCPeerConnection,
      RTCSessionDescription: options.wrtc?.RTCSessionDescription,
      RTCIceCandidate: options.wrtc?.RTCIceCandidate,
    });

    this.initialize();
  }

  /**
   * Initialize the connection manager by setting up event listeners and registering with rondevu
   */
  private async initialize(): Promise<void> {
    this.log('Initializing RondevuConnectionManager');

    try {
      if (!this.rondevu.isAuthenticated()) {
        const credentials = await this.rondevu.register();
        this.log(`Registered with rondevu: ${credentials.peerId}`);
      } else {
        this.log(`Using existing credentials: ${this.rondevu.getCredentials()?.peerId}`);
      }
    } catch (error) {
      this.log(`Failed to register with rondevu: ${error}`);
      return;
    }

    // Listen for new torrents being added
    this.client.on('torrent', (torrent: WebTorrent.Torrent) => {
      this.handleTorrentAdded(torrent);
    });

    // Handle existing torrents if any
    this.client.torrents.forEach((torrent) => {
      this.handleTorrentAdded(torrent);
    });
  }

  /**
   * Handle a torrent being added to the WebTorrent client
   */
  private async handleTorrentAdded(torrent: WebTorrent.Torrent): Promise<void> {
    const infoHash = torrent.infoHash;
    this.log(`Torrent added: ${infoHash}`);

    // Initialize tracking for this torrent
    this.torrentPeers.set(infoHash, new Set());
    this.torrentOffers.set(infoHash, []);
    this.torrentBloomFilters.set(infoHash, new BloomFilter(1024, 3));

    // Start discovering peers and creating offers
    await this.discoverPeersForTorrent(torrent);

    // Set up periodic peer refresh
    const refreshTimer = setInterval(() => {
      this.discoverPeersForTorrent(torrent);
    }, this.options.refreshInterval);

    this.refreshTimers.set(infoHash, refreshTimer);

    // Set up cleanup handler for when torrent is destroyed
    const cleanup = () => {
      this.log(`Cleaning up torrent ${infoHash}`);

      const timer = this.refreshTimers.get(infoHash);
      if (timer) {
        clearInterval(timer);
        this.refreshTimers.delete(infoHash);
      }

      // Close all peer connections for this torrent
      const peers = this.torrentPeers.get(infoHash);
      if (peers) {
        peers.forEach((peer) => {
          try {
            peer.close();
          } catch (error) {
            this.log(`Error closing peer: ${error}`);
          }
        });
        this.torrentPeers.delete(infoHash);
      }

      // Delete our offers for this torrent
      const offerIds = this.torrentOffers.get(infoHash);
      if (offerIds) {
        offerIds.forEach(async (offerId) => {
          try {
            await this.rondevu.offers.delete(offerId);
          } catch (error) {
            this.log(`Error deleting offer: ${error}`);
          }
        });
        this.torrentOffers.delete(infoHash);
      }

      // Clean up bloom filter
      this.torrentBloomFilters.delete(infoHash);

      this.torrentCleanupHandlers.delete(infoHash);
    };

    torrent.on('done', () => {
      this.log(`Torrent ${infoHash} completed`);
    });

    // Clean up when torrent is destroyed
    torrent.once('destroyed', cleanup);

    this.torrentCleanupHandlers.set(infoHash, cleanup);
  }

  /**
   * Discover peers for a torrent using rondevu
   */
  private async discoverPeersForTorrent(torrent: WebTorrent.Torrent): Promise<void> {
    const infoHash = torrent.infoHash;
    const currentPeerCount = this.torrentPeers.get(infoHash)?.size ?? 0;

    // Check if we already have enough peers
    if (currentPeerCount >= this.options.maxPeersPerTorrent) {
      this.log(`Max peers reached for ${infoHash}`);
      return;
    }

    try {
      // Create our own offer for this torrent using rondevu.createPeer() to get WebRTC polyfills
      const peer = this.rondevu.createPeer(this.options.rtcConfig);

      this.log(`Creating offer for torrent ${infoHash}`);
      const offerId = await peer.createOffer({
        topics: [infoHash],
        ttl: 300000, // 5 minutes in milliseconds
        createDataChannel: true,
        dataChannelLabel: 'webtorrent',
      });

      this.torrentOffers.get(infoHash)?.push(offerId);

      // Set up peer connection handlers
      this.setupPeerHandlers(peer, torrent, true);

      // Discover other peers' offers for this torrent
      this.log(`Discovering peers for torrent ${infoHash}`);
      const bloomFilter = this.torrentBloomFilters.get(infoHash);
      const offers = await this.rondevu.offers.findByTopic(infoHash, {
        limit: this.options.maxPeersPerTorrent - currentPeerCount,
        bloomFilter: bloomFilter?.toBytes(),
      });

      this.log(`Found ${offers.length} offers for torrent ${infoHash}`);

      // Connect to discovered peers
      for (const remoteOffer of offers) {
        // Skip our own offers
        if (remoteOffer.peerId === this.rondevu.getCredentials()?.peerId) {
          continue;
        }

        // Skip if already answered
        if (remoteOffer.answererPeerId) {
          continue;
        }

        // Add to bloom filter to avoid rediscovering
        bloomFilter?.add(remoteOffer.peerId);

        try {
          // Create peer using rondevu.createPeer() to get WebRTC polyfills
          const answerPeer = this.rondevu.createPeer(this.options.rtcConfig);

          this.log(`Answering offer ${remoteOffer.id} for torrent ${infoHash}`);
          await answerPeer.answer(remoteOffer.id, remoteOffer.sdp, {
            topics: [infoHash],
          });

          // Set up peer connection handlers
          this.setupPeerHandlers(answerPeer, torrent, false);
        } catch (error) {
          this.log(`Failed to answer offer ${remoteOffer.id}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Error discovering peers for ${infoHash}: ${error}`);
    }
  }

  /**
   * Set up event handlers for a rondevu peer
   */
  private setupPeerHandlers(
    peer: RondevuPeer,
    torrent: WebTorrent.Torrent,
    isOfferer: boolean
  ): void {
    const infoHash = torrent.infoHash;

    peer.on('connected', () => {
      this.log(`Peer connected for torrent ${infoHash}`);
      this.torrentPeers.get(infoHash)?.add(peer);

      // Add the WebRTC peer connection to the torrent
      // WebTorrent can use WebRTC peer connections directly
      try {
        (torrent as any).addPeer(peer.pc);
      } catch (error) {
        this.log(`Failed to add WebRTC peer to torrent: ${error}`);
      }
    });

    peer.on('disconnected', () => {
      this.log(`Peer disconnected for torrent ${infoHash}`);
      this.torrentPeers.get(infoHash)?.delete(peer);
    });

    peer.on('failed', (error: Error) => {
      this.log(`Peer failed for torrent ${infoHash}: ${error.message}`);
      this.torrentPeers.get(infoHash)?.delete(peer);
    });

    peer.on('datachannel', (channel: RTCDataChannel) => {
      this.log(`Data channel opened for torrent ${infoHash}: ${channel.label}`);
    });
  }

  /**
   * Log a message if debug mode is enabled
   */
  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[RondevuConnectionManager] ${message}`);
    }
  }

  /**
   * Manually trigger peer discovery for a specific torrent
   */
  public async discoverPeers(infoHash: string): Promise<void> {
    const torrent = this.client.torrents.find((t) => t.infoHash === infoHash);
    if (!torrent) {
      this.log(`Torrent ${infoHash} not found`);
      return;
    }
    await this.discoverPeersForTorrent(torrent);
  }

  /**
   * Get statistics about the connection manager
   */
  public getStats() {
    const torrentStats = Array.from(this.torrentPeers.entries()).map(([infoHash, peers]) => ({
      infoHash,
      peerCount: peers.size,
    }));

    return {
      activeTorrents: this.client.torrents.length,
      peerId: this.rondevu.getCredentials()?.peerId,
      rondevuServer: this.options.rondevuServer ?? 'https://api.ronde.vu',
      torrents: torrentStats,
    };
  }

  /**
   * Get the rondevu credentials for persistence
   */
  public getCredentials(): Credentials | undefined {
    return this.rondevu.getCredentials();
  }

  /**
   * Clean up all resources and disconnect from rondevu
   */
  public destroy(): void {
    this.log('Destroying RondevuConnectionManager');

    // Run all cleanup handlers
    this.torrentCleanupHandlers.forEach((cleanup) => cleanup());
    this.torrentCleanupHandlers.clear();

    this.torrentPeers.clear();
    this.torrentOffers.clear();
    this.refreshTimers.clear();
    this.torrentBloomFilters.clear();
  }
}
