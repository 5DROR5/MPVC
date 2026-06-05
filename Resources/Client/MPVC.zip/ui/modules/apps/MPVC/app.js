// =============================================================================
// MPVC — Proximity Voice Chat  |   UI Controller
// Version: 1.0.1               |   Author: 5DROR5
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
  var _localRms = 0;

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
          setTimeout(function () { connect(attempt + 1).then(resolve).catch(reject); }, RETRY_MS);
        } else {
          reject(new Error('MicBridge: connection failed'));
        }
      };

      _ws.onmessage = function (e) {
        var pcm = new Float32Array(e.data);
        var sum = 0;
        for (var i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
        _localRms = Math.sqrt(sum / pcm.length);

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
    _localRms = 0;
  }

  return {
    connect:     connect,
    disconnect:  disconnect,
    getLocalRms: function () { return _localRms; }
  };
})();


angular.module('beamng.apps')
.directive('mpvc', function () {
  return {
    restrict: 'E',
    templateUrl: '/ui/modules/apps/MPVC/app.html',
    replace: true,
    controller: function ($scope) {

      var DISCORD_DL_ENABLED = false;
      var BRIDGE_URL         = 'ws://localhost:7777';
      var DISMISS_KEY        = 'mpvc_no_prompt';
      var BNG_PROXY          = 'https://www.beamng.com/proxy.php?link=';
      var GITHUB_URL         = 'https://github.com/5DROR5/MPVC';
      var DISCORD_URL        = 'https://discord.gg/UvM8a5nxB4';
      var VAD_THRESHOLD      = 0.02;
      var VAD_HOLD_MS        = 300;

      var myId               = -1;
      var cfg                = null;
      var peers              = {};
      var peerNames          = {};
      var peerMicOn          = {};
      var allMpvcPlayers     = {};
      var mutedPeers         = {};
      var audioCtx           = null;
      var localStream        = null;
      var volumeTargets      = {};
      var localSpeakingUntil = 0;

      $scope.mode            = null;
      $scope.nearbyCount     = 0;
      $scope.showPrompt      = false;
      $scope.showDownloads   = false;
      $scope.dontRemind      = false;
      $scope.speakersList    = [];
      $scope.localSpeaking   = false;
      $scope.discordEnabled  = DISCORD_DL_ENABLED;

      function _openDirect(url) {
        if (window.bngApi && typeof window.bngApi.engineLua === 'function')
          window.bngApi.engineLua('MPCoreNetwork.openURL("' + url + '")');
      }

      function _openProxy(url) {
        if (window.bngApi && typeof window.bngApi.engineLua === 'function')
          window.bngApi.engineLua('openWebBrowser("' + BNG_PROXY + url + '")');
      }

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

      function broadcastMicStatus(micOn) {
        var payload = JSON.stringify({ micOn: micOn });
        Object.keys(peers).forEach(function (pid) {
          sendSignal(parseInt(pid), 'status', payload);
        });
      }

      function probebridge() {
        if (localStorage.getItem(DISMISS_KEY) === '1') { initAudio(); return; }
        var ws, done = false;
        try { ws = new WebSocket(BRIDGE_URL); }
        catch (e) { $scope.$applyAsync(function () { $scope.showPrompt = true; }); return; }

        var timer = setTimeout(function () {
          if (done) return; done = true;
          try { ws.close(); } catch (e2) {}
          $scope.$applyAsync(function () { $scope.showPrompt = true; });
        }, 1500);

        ws.onopen = function () {
          if (done) return; done = true;
          clearTimeout(timer); ws.close(); initAudio();
        };
        ws.onerror = function () {
          if (done) return; done = true;
          clearTimeout(timer);
          $scope.$applyAsync(function () { $scope.showPrompt = true; });
        };
        ws.onclose = function () {};
      }

      $scope.promptNo = function () {
        if ($scope.dontRemind) localStorage.setItem(DISMISS_KEY, '1');
        $scope.showPrompt = false;
      };

      $scope.promptYes = function () {
        if ($scope.dontRemind) localStorage.setItem(DISMISS_KEY, '1');
        $scope.showPrompt = false; $scope.showDownloads = true;
      };

      $scope.closeDownloads  = function () { $scope.showDownloads = false; };
      $scope.downloadGithub  = function () { _openProxy(GITHUB_URL);   };
      $scope.downloadDiscord = function () { _openDirect(DISCORD_URL); };

      $scope.toggleMute = function (pid) {
        mutedPeers[pid] = !mutedPeers[pid];
        if (peers[pid] && peers[pid].audioEl)
          peers[pid].audioEl.volume = mutedPeers[pid] ? 0 : targetVol(peers[pid].distance);
      };

      setInterval(function () {
        var now = Date.now();

        Object.keys(peers).forEach(function (pid) {
          var p = peers[pid];
          if (!p) return;

          if (p.audioEl) {
            var target  = mutedPeers[pid] ? 0
                        : (volumeTargets[pid] !== undefined ? volumeTargets[pid] : 0);
            var current = p.audioEl.volume;
            var diff    = target - current;
            if (Math.abs(diff) > 0.001)
              p.audioEl.volume = Math.min(1, Math.max(0, current + diff * 0.15));
          }

          if (p.analyser) {
            var buf = new Uint8Array(p.analyser.frequencyBinCount);
            p.analyser.getByteTimeDomainData(buf);
            var sum = 0;
            for (var i = 0; i < buf.length; i++) {
              var v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            if (Math.sqrt(sum / buf.length) > VAD_THRESHOLD)
              p.speakingUntil = now + VAD_HOLD_MS;
          }
        });

        if ($scope.mode === 'talk' && MicBridge.getLocalRms() > VAD_THRESHOLD)
          localSpeakingUntil = now + VAD_HOLD_MS;
      }, 50);

      var _prevJson = '';
      setInterval(function () {
        var now  = Date.now();
        var ls   = now < localSpeakingUntil;

        var list = Object.keys(allMpvcPlayers)
          .filter(function (pidStr) { return parseInt(pidStr) !== myId; })
          .map(function (pidStr) {
            var pid   = parseInt(pidStr);
            var p     = peers[pid];
            var muted = !!mutedPeers[pid];
            return {
              pid:      pid,
              name:     allMpvcPlayers[pidStr],
              speaking: p ? (now < (p.speakingUntil || 0)) : false,
              muted:    muted,
              micOn:    !!peerMicOn[pid]
            };
          });

        var json = JSON.stringify(list) + ls;
        if (json === _prevJson) return;
        _prevJson = json;

        $scope.$applyAsync(function () {
          $scope.speakersList  = list;
          $scope.localSpeaking = ls;
        });
      }, 150);

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
        broadcastMicStatus($scope.mode === 'talk');
      };

      $scope.listenToggle = function () {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        var wasInTalk = $scope.mode === 'talk';
        $scope.mode   = ($scope.mode === 'listen') ? null : 'listen';
        applyMode();
        if (wasInTalk) broadcastMicStatus(false);
      };

      function initAudio() {
        try { audioCtx = new AudioContext(); } catch (e) { return; }
        MicBridge.connect()
          .then(function (stream) {
            localStream = stream;
            muteStream();
            Object.keys(peers).forEach(function (pidStr) {
              var p = peers[parseInt(pidStr)];
              if (p && p.pc && p.pc.signalingState !== 'closed')
                localStream.getTracks().forEach(function (t) { p.pc.addTrack(t, localStream); });
            });
            if (window.bngApi && typeof window.bngApi.engineLua === 'function')
              window.bngApi.engineLua('mpvcHello()');
          })
          .catch(function () {});
      }

      function createPeer(pid) {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

        pc.onnegotiationneeded = function () {
          if (pc.signalingState !== 'stable') return;
          pc.createOffer()
            .then(function (o) { return pc.setLocalDescription(o); })
            .then(function ()  { sendSignal(pid, 'offer', JSON.stringify(pc.localDescription)); })
            .catch(function () {});
        };

        pc.onicecandidate = function (e) {
          if (e.candidate) sendSignal(pid, 'ice', JSON.stringify(e.candidate));
        };

        pc.ontrack = function (e) {
          try {
            var ms    = new MediaStream([e.track]);
            var audio = document.createElement('audio');
            audio.srcObject = ms;
            audio.autoplay  = true;
            audio.volume    = (peers[pid] && !mutedPeers[pid]) ? targetVol(peers[pid].distance) : 0;
            document.body.appendChild(audio);
            audio.play().catch(function () {});
            if (peers[pid]) peers[pid].audioEl = audio;

            if (audioCtx) {
              try {
                var src      = audioCtx.createMediaStreamSource(ms);
                var analyser = audioCtx.createAnalyser();
                analyser.fftSize = 512;
                src.connect(analyser);
                if (peers[pid]) peers[pid].analyser = analyser;
              } catch (ae) {}
            }
          } catch (err) {}
        };

        if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

        peers[pid] = { pc: pc, audioEl: null, analyser: null, speakingUntil: 0, distance: 0 };
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
        delete peerMicOn[pid];
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
            if (!mutedPeers[p.id]) volumeTargets[p.id] = targetVol(p.distance);
          } else if (p.id > myId) {
            var peer = createPeer(p.id);
            peer.distance       = p.distance;
            volumeTargets[p.id] = mutedPeers[p.id] ? 0 : targetVol(p.distance);
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

        if (msg.fromName && pid !== undefined) peerNames[pid] = msg.fromName;

        try {
          if (msg.type === 'offer') {
            if (!peers[pid]) createPeer(pid);
            peer = peers[pid];
            peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)))
              .then(function ()  { return peer.pc.createAnswer(); })
              .then(function (a) { return peer.pc.setLocalDescription(a); })
              .then(function ()  {
                sendSignal(pid, 'answer', JSON.stringify(peer.pc.localDescription));
                sendSignal(pid, 'status', JSON.stringify({ micOn: $scope.mode === 'talk' }));
                $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
              }).catch(function () {});

          } else if (msg.type === 'answer') {
            peer = peers[pid];
            if (peer) peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)))
              .then(function () {
                sendSignal(pid, 'status', JSON.stringify({ micOn: $scope.mode === 'talk' }));
              })
              .catch(function () {});

          } else if (msg.type === 'ice') {
            peer = peers[pid];
            if (peer) peer.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(msg.payload))).catch(function () {});

          } else if (msg.type === 'status') {
            try {
              var s = JSON.parse(msg.payload);
              if (s.micOn !== undefined) peerMicOn[pid] = !!s.micOn;
            } catch (se) {}

          } else if (msg.type === 'bye') {
            if (peers[pid]) {
              peers[pid].pc.close();
              if (peers[pid].audioEl) { peers[pid].audioEl.srcObject = null; peers[pid].audioEl.remove(); }
              delete peers[pid];
              delete volumeTargets[pid];
              delete peerMicOn[pid];
            }
            $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
          }
        } catch (err) {}
      });

      $scope.$on('VOICE_Config', function (e, c) {
        if (!c || typeof c !== 'object') return;
        cfg = c;
      });

      $scope.$on('VOICE_PlayerList', function (e, rawData) {
        var list;
        try { list = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; }
        catch (err) { return; }
        if (!Array.isArray(list)) return;
        allMpvcPlayers = {};
        list.forEach(function (p) {
          if (p.id !== undefined && p.name) allMpvcPlayers[p.id] = p.name;
        });
      });

      probebridge();
    }
  };
});