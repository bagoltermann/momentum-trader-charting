"""
Quote Relay Service — SocketIO consumer for trader app quote streaming

Connects to trader app (port 8080) via python-socketio client,
receives 'quote_update' events from Schwab LEVELONE_EQUITIES stream,
and relays them to registered callbacks (FastAPI WebSocket endpoint).

Contract (from trader app v1.46.0):
  Subscribe:   emit('subscribe_quotes', {symbols: ['XHLD']})
  Receive:     listen('quote_update', quote_dict)
  Unsubscribe: emit('unsubscribe_quotes', {symbols: ['XHLD']})
  Status:      GET http://localhost:8080/api/streaming/quotes/status
"""
import copy
import socketio
import threading
import time
import logging

_logger = logging.getLogger('quote_relay')


class QuoteRelay:
    """Connects to trader app SocketIO, relays quotes to frontend WebSocket clients"""

    def __init__(self, trader_url: str = "http://localhost:8080"):
        # Force IPv4 to avoid IPv6 connection hangs on Windows
        # localhost can resolve to ::1 (IPv6) which may hang if server only binds IPv4
        self.trader_url = trader_url.replace("localhost", "127.0.0.1")
        self.sio = socketio.Client(reconnection=True, reconnection_delay=5)
        self._callbacks = []
        self._status_callbacks = []  # Callbacks for connection status changes
        self._connected = False
        self._current_symbols = []
        self._quotes_relayed = 0
        self._thread = None
        self._started_at = None

        # Volume spike alert storage (v2.8.0)
        self._active_spikes = {}   # symbol -> spike_data dict
        self._spike_expiry = 30    # seconds

        # Register SocketIO event handlers
        self.sio.on('connect', self._on_connect)
        self.sio.on('disconnect', self._on_disconnect)
        self.sio.on('quote_update', self._on_quote)
        self.sio.on('volume_spike', self._on_volume_spike)
        self.sio.on('subscribe_response', self._on_subscribe_response)
        self.sio.on('unsubscribe_response', self._on_unsubscribe_response)

    def start(self):
        """Connect to trader app in background thread"""
        self._started_at = time.time()
        self._thread = threading.Thread(
            target=self._connect_loop, daemon=True, name="QuoteRelay"
        )
        self._thread.start()

    def _connect_loop(self):
        """Connect with retry — python-socketio handles reconnection internally"""
        try:
            self.sio.connect(self.trader_url, wait_timeout=10)
            self.sio.wait()  # Block thread until disconnect
        except Exception as e:
            _logger.error(f"Connection failed: {e}")
            self._connected = False

    def subscribe(self, symbols: list):
        """Request quote streaming for symbols (additive to existing subscriptions)"""
        self._current_symbols = list(set(self._current_symbols + symbols))
        if self._connected:
            self.sio.emit('subscribe_quotes', {'symbols': symbols})

    def unsubscribe(self, symbols: list):
        """Unsubscribe from specific symbols"""
        if self._connected:
            self.sio.emit('unsubscribe_quotes', {'symbols': symbols})
        self._current_symbols = [s for s in self._current_symbols if s not in symbols]

    def add_callback(self, cb):
        """Register callback for quote updates"""
        self._callbacks.append(cb)

    def remove_callback(self, cb):
        """Unregister callback"""
        if cb in self._callbacks:
            self._callbacks.remove(cb)

    def add_status_callback(self, cb):
        """Register callback for connection status changes"""
        self._status_callbacks.append(cb)
        # Immediately notify of current status
        try:
            cb({'type': 'status', 'connected': self._connected})
        except Exception:
            pass

    def remove_status_callback(self, cb):
        """Unregister status callback"""
        if cb in self._status_callbacks:
            self._status_callbacks.remove(cb)

    def _notify_status(self, connected: bool):
        """Notify all status callbacks of connection change"""
        for cb in self._status_callbacks:
            try:
                cb({'type': 'status', 'connected': connected})
            except Exception:
                pass

    def _on_connect(self):
        self._connected = True
        _logger.info("Connected to trader app")
        self._notify_status(True)
        # Re-subscribe on reconnect
        if self._current_symbols:
            self.sio.emit('subscribe_quotes', {'symbols': self._current_symbols})

    def _on_disconnect(self):
        self._connected = False
        _logger.info("Disconnected from trader app")
        self._notify_status(False)

    def _on_quote(self, data):
        """Relay quote to all registered callbacks"""
        self._quotes_relayed += 1
        for cb in self._callbacks:
            try:
                cb(data)
            except Exception:
                pass

    def _on_volume_spike(self, data):
        """Store volume spike event for REST polling (v2.8.0)"""
        symbol = data.get('symbol')
        if symbol:
            spike = copy.copy(data)
            spike['received_at'] = time.time()
            self._active_spikes[symbol] = spike
            _logger.info(f"Volume spike: {symbol} ({data.get('spike_ratio', '?')}x)")

    def get_active_spikes(self) -> dict:
        """Return active (non-expired) spikes. Called by REST endpoint."""
        now = time.time()
        expired = [s for s, d in self._active_spikes.items()
                   if now - d.get('received_at', 0) > self._spike_expiry]
        for s in expired:
            del self._active_spikes[s]
        return dict(self._active_spikes)

    def _on_subscribe_response(self, data):
        _logger.debug(f"Subscribe response: {data}")

    def _on_unsubscribe_response(self, data):
        _logger.debug(f"Unsubscribe response: {data}")

    def stop(self):
        """Disconnect from trader app"""
        try:
            if self._connected:
                self.sio.disconnect()
        except Exception:
            pass

    def get_stats(self) -> dict:
        """Get relay statistics"""
        uptime = 0.0
        if self._started_at:
            uptime = time.time() - self._started_at
        return {
            'connected': self._connected,
            'symbols': self._current_symbols,
            'quotes_relayed': self._quotes_relayed,
            'trader_url': self.trader_url,
            'uptime_seconds': round(uptime, 1)
        }
