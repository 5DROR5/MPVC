// =============================================================================
// MPVC — Proximity Voice Chat  |   UI Controller
// Version: 1.0.0               |   Author: 5DROR5
// License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
// =============================================================================

var MicBridge = (function () {
  var WS_URL      = 'ws://localhost:7777';
  var SAMPLE_RATE = 48000;
  var CHUNK       = 960;
  var CHUNK_DUR   = CHUNK / SAMPLE_RATE;
  var AHEAD_SEC   = 0.03;
  var MAX_AHEAD   = 0.05;
  var TIMEOUT_MS  = 5000;
  var MAX_RETRIES = 5;
  var RETRY_MS    = 2000;

  var _ctx, _dest, _ws, _nextTime;

  function connect(attempt) {
    attempt = attempt || 1;
    if (_ws && _ws.readyState === WebSocket.OPEN) return Promise.resolve(_dest.stream);
    _ctx  = new AudioContext({ sampleRate: SAMPLE_RATE });
    _dest = _ctx.createMediaStreamDestination();

    return new Promise(function (resolve, reject) {
      var tid = setTimeout(function () {
        _ws && _ws.close();
        reject(new Error('MicBridge: timeout'));
      }, TIMEOUT_MS);

      _ws = new WebSocket(WS_URL);
      _ws.binaryType = 'arraybuffer';

      _ws.onopen = function () {
        clearTimeout(tid);
        _nextTime = _ctx.currentTime + AHEAD_SEC;
        resolve(_dest.stream);
      };

      _ws.onerror = function () {
        clearTimeout(tid);
        if (attempt < MAX_RETRIES) {
          setTimeout(function () {
            connect(attempt + 1).then(resolve).catch(reject);
          }, RETRY_MS);
        } else {
          reject(new Error('MicBridge: connection failed'));
        }
      };

      _ws.onmessage = function (e) {
        var pcm = new Float32Array(e.data);
        var buf = _ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
        buf.getChannelData(0).set(pcm);
        var src = _ctx.createBufferSource();
        src.buffer = buf;
        src.connect(_dest);
        var now = _ctx.currentTime;
        if (_nextTime < now || _nextTime > now + MAX_AHEAD) _nextTime = now + AHEAD_SEC;
        src.start(_nextTime);
        _nextTime += CHUNK_DUR;
      };

      _ws.onclose = function () {};
    });
  }

  function disconnect() {
    _ws  && _ws.close();
    _ctx && _ctx.close();
    _ws = _ctx = _dest = null;
  }

  return { connect: connect, disconnect: disconnect };
})();


angular.module('beamng.apps')
.directive('mpvc', function () {
  return {
    restrict: 'E',
    templateUrl: '/ui/modules/apps/MPVC/app.html',
    replace: true,
    controller: function ($scope) {

      var myId          = -1;
      var cfg           = null;
      var peers         = {};
      var audioCtx      = null;
      var localStream   = null;
      var volumeTargets = {};

      $scope.mode        = null;
      $scope.nearbyCount = 0;

      function muteStream()   { if (localStream) localStream.getTracks().forEach(function (t) { t.enabled = false; }); }
      function unmuteStream() { if (localStream) localStream.getTracks().forEach(function (t) { t.enabled = true;  }); }

      function calcVolume(dist) {
        if (!cfg) return 0;
        if (dist >= cfg.max_distance) return 0;
        if (dist <= cfg.fade_start)   return cfg.master_volume;
        var t = (dist - cfg.fade_start) / (cfg.max_distance - cfg.fade_start);
        return (1 - t * t) * cfg.master_volume;
      }

      function targetVol(dist) {
        return ($scope.mode !== null) ? calcVolume(dist) : 0;
      }

      function initAudio() {
        try { audioCtx = new AudioContext(); } catch (e) { return; }

        MicBridge.connect()
          .then(function (stream) {
            localStream = stream;
            muteStream();
          })
          .catch(function () {});
      }

      setInterval(function () {
        Object.keys(peers).forEach(function (pid) {
          if (!peers[pid] || !peers[pid].audioEl) return;
          var target  = volumeTargets[pid] !== undefined ? volumeTargets[pid] : 0;
          var current = peers[pid].audioEl.volume;
          var diff    = target - current;
          if (Math.abs(diff) > 0.001)
            peers[pid].audioEl.volume = Math.min(1, Math.max(0, current + diff * 0.15));
        });
      }, 50);

      function normalizeArray(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; });
        return [];
      }

      function sendSignal(pid, type, payload) {
        if (!window.bngApi || typeof window.bngApi.engineLua !== 'function') return;
        window.bngApi.engineLua('mpvcSignal([==[' + JSON.stringify({ to: pid, type: type, payload: payload }) + ']==])');
      }

      function applyMode() {
        if ($scope.mode === 'talk') { unmuteStream(); } else { muteStream(); }
        Object.keys(peers).forEach(function (pid) {
          volumeTargets[pid] = targetVol(peers[pid].distance);
        });
      }

      $scope.talkToggle = function () {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        $scope.mode = ($scope.mode === 'talk') ? null : 'talk';
        applyMode();
      };

      $scope.listenToggle = function () {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        $scope.mode = ($scope.mode === 'listen') ? null : 'listen';
        applyMode();
      };

      function createPeer(pid) {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

        pc.onicecandidate = function (e) {
          if (e.candidate) sendSignal(pid, 'ice', JSON.stringify(e.candidate));
        };

        pc.ontrack = function (e) {
          try {
            var audio       = document.createElement('audio');
            audio.srcObject = new MediaStream([e.track]);
            audio.autoplay  = true;
            audio.volume    = peers[pid] ? targetVol(peers[pid].distance) : 0;
            document.body.appendChild(audio);
            audio.play().catch(function () {});
            if (peers[pid]) peers[pid].audioEl = audio;
          } catch (err) {}
        };

        if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

        peers[pid] = { pc: pc, audioEl: null, distance: 0 };
        return peers[pid];
      }

      function closePeer(pid) {
        if (!peers[pid]) return;
        try {
          sendSignal(pid, 'bye', '');
          peers[pid].pc.close();
          if (peers[pid].audioEl) { peers[pid].audioEl.srcObject = null; peers[pid].audioEl.remove(); }
        } catch (e) {}
        delete peers[pid];
        delete volumeTargets[pid];
      }

      $scope.$on('VOICE_DistanceUpdate', function (e, data) {
        if (!data || typeof data !== 'object') return;
        if (data.myId !== undefined) myId = data.myId;
        if (myId === -1 || !audioCtx || !cfg) return;

        var players = normalizeArray(data.players);
        var inRange = {};

        players.forEach(function (p) {
          inRange[p.id] = true;
          if (peers[p.id]) {
            peers[p.id].distance = p.distance;
            volumeTargets[p.id]  = targetVol(p.distance);
          } else if (p.id > myId) {
            var peer = createPeer(p.id);
            peer.distance       = p.distance;
            volumeTargets[p.id] = targetVol(p.distance);
            peer.pc.createOffer()
              .then(function (o) { return peer.pc.setLocalDescription(o); })
              .then(function ()  { sendSignal(p.id, 'offer', JSON.stringify(peer.pc.localDescription)); })
              .catch(function () { closePeer(p.id); });
          }
        });

        Object.keys(peers).forEach(function (pid) {
          if (!inRange[parseInt(pid)]) closePeer(parseInt(pid));
        });

        $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
      });

      $scope.$on('VOICE_PlayersLeft', function (e, pids) {
        normalizeArray(pids).forEach(function (pid) { closePeer(pid); });
        $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
      });

      $scope.$on('VOICE_Signal', function (e, rawData) {
        var msg;
        try { msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; } catch (err) { return; }
        if (!msg || myId === -1) return;

        var pid  = msg.from;
        var peer;

        try {
          if (msg.type === 'offer') {
            if (!peers[pid]) createPeer(pid);
            peer = peers[pid];
            peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)))
              .then(function ()  { return peer.pc.createAnswer(); })
              .then(function (a) { return peer.pc.setLocalDescription(a); })
              .then(function ()  {
                sendSignal(pid, 'answer', JSON.stringify(peer.pc.localDescription));
                $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
              }).catch(function () {});

          } else if (msg.type === 'answer') {
            peer = peers[pid];
            if (peer) peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload))).catch(function () {});

          } else if (msg.type === 'ice') {
            peer = peers[pid];
            if (peer) peer.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(msg.payload))).catch(function () {});

          } else if (msg.type === 'bye') {
            if (peers[pid]) {
              peers[pid].pc.close();
              if (peers[pid].audioEl) { peers[pid].audioEl.srcObject = null; peers[pid].audioEl.remove(); }
              delete peers[pid];
              delete volumeTargets[pid];
            }
            $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
          }
        } catch (err) {}
      });

      $scope.$on('VOICE_Config', function (e, c) {
        if (!c || typeof c !== 'object') return;
        cfg = c;
      });

      initAudio();
    }
  };
});