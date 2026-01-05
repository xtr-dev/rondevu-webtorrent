import WebTorrent from 'webtorrent';
import { Rondevu, OfferHandle, Peer } from '@xtr-dev/rondevu-client';
import { EventEmitter } from 'events';

/**
 * Credential type for rondevu authentication
 */
export interface Credential {
  name: string;
  secret: string;
}

/**
 * WebRTC polyfill interface for Node.js environments
 */
export interface WebRTCPolyfill {
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCIceCandidate: typeof RTCIceCandidate;
}

/**
 * Simple WebRTC adapter for Node.js using wrtc polyfill
 */
class NodeWebRTCAdapter {
  constructor(private polyfills: WebRTCPolyfill) {}

  createPeerConnection(config?: RTCConfiguration): RTCPeerConnection {
    return new this.polyfills.RTCPeerConnection(config);
  }

  createIceCandidate(candidateInit: RTCIceCandidateInit): RTCIceCandidate {
    return new this.polyfills.RTCIceCandidate(candidateInit);
  }
}

/**
 * SimplePeer-compatible wrapper for RTCPeerConnection + DataChannel
 * WebTorrent expects a SimplePeer-like interface with EventEmitter methods
 */
class SimplePeerWrapper extends EventEmitter {
  public _pc: RTCPeerConnection;
  public _channel: RTCDataChannel | null;
  public connected: boolean = false;
  public destroyed: boolean = false;
  public remoteAddress?: string;
  public remotePort?: number;

  constructor(pc: RTCPeerConnection, channel: RTCDataChannel | null) {
    super();
    this._pc = pc;
    this._channel = channel;

    this.setupPeerConnection();
    if (channel) {
      this.setupDataChannel(channel);
    }
  }

  private setupPeerConnection(): void {
    this._pc.oniceconnectionstatechange = () => {
      const state = this._pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        this.connected = true;
        this.emit('connect');
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.connected = false;
        this.emit('close');
      }
    };

    this._pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this._channel = channel;

    channel.onopen = () => {
      this.connected = true;
      this.emit('connect');
    };

    channel.onclose = () => {
      this.emit('close');
    };

    channel.onerror = (err) => {
      this.emit('error', err);
    };

    channel.onmessage = (event) => {
      this.emit('data', event.data);
    };
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (this._channel && this._channel.readyState === 'open') {
      this._channel.send(data as any);
    }
  }

  destroy(err?: Error): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connected = false;

    if (this._channel) {
      try { this._channel.close(); } catch {}
    }
    try { this._pc.close(); } catch {}

    if (err) {
      this.emit('error', err);
    }
    this.emit('close');
  }

  // Alias for compatibility
  get conn() { return this._pc; }
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
  credential?: Credential;

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
  private rondevu: Rondevu | null = null;
  private torrentOfferHandles: Map<string, OfferHandle> = new Map();
  private torrentPeers: Map<string, Set<Peer>> = new Map();
  private torrentCleanupHandlers: Map<string, () => void> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();
  private options: Required<Omit<RondevuConnectionManagerOptions, 'credential' | 'rondevuServer' | 'rtcConfig' | 'wrtc'>> & {
    rondevuServer?: string;
    rtcConfig?: RTCConfiguration;
    wrtc?: WebRTCPolyfill;
    credential?: Credential;
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
      credential: options.credential,
    };

    this.initialize();
  }

  /**
   * Initialize the connection manager by setting up event listeners and connecting to rondevu
   */
  private async initialize(): Promise<void> {
    this.log('Initializing RondevuConnectionManager');

    try {
      // Build connection options
      const connectOptions: Parameters<typeof Rondevu.connect>[0] = {
        apiUrl: this.options.rondevuServer,
        credential: this.options.credential,
        debug: this.options.debug,
      };

      // Add WebRTC adapter if wrtc polyfill provided
      if (this.options.wrtc) {
        connectOptions.webrtcAdapter = new NodeWebRTCAdapter(this.options.wrtc);
      }

      // Add ICE servers if custom config provided
      if (this.options.rtcConfig?.iceServers) {
        connectOptions.iceServers = this.options.rtcConfig.iceServers;
      }

      // Connect to rondevu (auto-generates credentials if not provided)
      this.rondevu = await Rondevu.connect(connectOptions);
      this.log(`Connected to rondevu as: ${this.rondevu.getName()}`);
    } catch (error) {
      this.log(`Failed to connect to rondevu: ${error}`);
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
    if (!this.rondevu) {
      this.log('Rondevu not initialized, skipping torrent');
      return;
    }

    const infoHash = torrent.infoHash;
    this.log(`Torrent added: ${infoHash}`);

    // Initialize tracking for this torrent
    this.torrentPeers.set(infoHash, new Set());

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

      // Cancel our offer for this torrent
      const offerHandle = this.torrentOfferHandles.get(infoHash);
      if (offerHandle) {
        offerHandle.cancel();
        this.torrentOfferHandles.delete(infoHash);
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
    if (!this.rondevu) return;

    const infoHash = torrent.infoHash;
    const currentPeerCount = this.torrentPeers.get(infoHash)?.size ?? 0;

    // Check if we already have enough peers
    if (currentPeerCount >= this.options.maxPeersPerTorrent) {
      this.log(`Max peers reached for ${infoHash}`);
      return;
    }

    try {
      // Create offers for this torrent if we haven't already
      if (!this.torrentOfferHandles.has(infoHash)) {
        this.log(`Creating offers for torrent ${infoHash}`);

        const offerHandle = await this.rondevu.offer({
          tags: [infoHash],
          maxOffers: 3, // Maintain pool of 3 offers
          ttl: 300000, // 5 minutes
          autoStart: true,
        });

        this.torrentOfferHandles.set(infoHash, offerHandle);

        // Listen for incoming connections on our offers
        this.rondevu.on('connection:opened', (_offerId, connection) => {
          this.log(`Incoming connection for torrent ${infoHash}`);

          connection.on('connected', () => {
            // Add the WebRTC peer connection to the torrent
            try {
              const pc = connection.getPeerConnection();
              const dc = connection.getDataChannel();
              if (pc) {
                const wrapper = new SimplePeerWrapper(pc, dc);
                (torrent as any).addPeer(wrapper);
                this.log(`Added incoming peer to torrent ${infoHash}`);
              }
            } catch (error) {
              this.log(`Failed to add incoming peer: ${error}`);
            }
          });
        });
      }

      // Discover other peers' offers for this torrent
      this.log(`Discovering peers for torrent ${infoHash}`);
      const result = await this.rondevu.discover([infoHash], {
        limit: this.options.maxPeersPerTorrent - currentPeerCount,
      });

      this.log(`Found ${result.offers.length} offers for torrent ${infoHash}`);

      // Connect to discovered peers using the simplified peer() API
      for (const remoteOffer of result.offers) {
        // Skip our own offers
        if (remoteOffer.username === this.rondevu.getName()) {
          continue;
        }

        try {
          this.log(`Connecting to peer ${remoteOffer.username} for torrent ${infoHash}`);

          const peer = await this.rondevu.peer({
            tags: [infoHash],
            username: remoteOffer.username,
          });

          // Track this peer
          this.torrentPeers.get(infoHash)?.add(peer);

          // Set up peer handlers
          peer.on('open', () => {
            this.log(`Connected to peer ${peer.peerUsername} for torrent ${infoHash}`);

            // Add the WebRTC peer connection to the torrent
            try {
              const pc = peer.peerConnection;
              const dc = peer.dataChannel;
              if (pc) {
                const wrapper = new SimplePeerWrapper(pc, dc);
                (torrent as any).addPeer(wrapper);
              }
            } catch (error) {
              this.log(`Failed to add WebRTC peer to torrent: ${error}`);
            }
          });

          peer.on('close', () => {
            this.log(`Peer disconnected for torrent ${infoHash}`);
            this.torrentPeers.get(infoHash)?.delete(peer);
          });

          peer.on('error', (error: Error) => {
            this.log(`Peer error for torrent ${infoHash}: ${error.message}`);
            this.torrentPeers.get(infoHash)?.delete(peer);
          });
        } catch (error) {
          this.log(`Failed to connect to peer ${remoteOffer.username}: ${error}`);
        }
      }
    } catch (error) {
      this.log(`Error discovering peers for ${infoHash}: ${error}`);
    }
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
      username: this.rondevu?.getName(),
      rondevuServer: this.options.rondevuServer ?? 'https://api.ronde.vu',
      torrents: torrentStats,
    };
  }

  /**
   * Get the rondevu credential for persistence
   */
  public getCredential(): Credential | undefined {
    return this.rondevu?.getCredential();
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
    this.torrentOfferHandles.clear();
    this.refreshTimers.clear();
  }
}
