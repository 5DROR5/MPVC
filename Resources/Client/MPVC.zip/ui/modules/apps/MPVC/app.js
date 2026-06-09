// =============================================================================
// MPVC — Proximity Voice Chat  |   UI Controller
// Version: 1.0.3               |   Author: 5DROR5
// License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
// =============================================================================

var MicBridge = (function () {
  var RELAY = '', LOCAL = 'ws://localhost:7777', TOKEN = '';
  var SR = 48000, CHUNK = 960, DUR = CHUNK / SR, AHEAD = 0.03, MAX_AHEAD = 0.05;
  var _mode, _ws, _pc, _ctx, _dest, _t, _stream, _analyser, _rms;
  _rms = 0;

  function _local(res, rej) {
    _ctx = new AudioContext({ sampleRate: SR });
    _dest = _ctx.createMediaStreamDestination();
    _t = _ctx.currentTime + AHEAD;
    _ws = new WebSocket(LOCAL);
    _ws.binaryType = 'arraybuffer';
    _ws.onopen    = function () { res(_dest.stream); };
    _ws.onerror   = function () { rej(new Error('local')); };
    _ws.onmessage = function (e) {
      var pcm = new Float32Array(e.data), sum = 0;
      for (var i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      _rms = Math.sqrt(sum / pcm.length);
      var buf = _ctx.createBuffer(1, pcm.length, SR);
      buf.getChannelData(0).set(pcm);
      var src = _ctx.createBufferSource();
      src.buffer = buf; src.connect(_dest);
      var now = _ctx.currentTime;
      if (_t < now || _t > now + MAX_AHEAD) _t = now + AHEAD;
      src.start(_t); _t += DUR;
    };
    _ws.onclose = function () {};
  }

  function _relay(sid, res, rej) {
    var url = RELAY + '?id=' + sid + '&role=game' + (TOKEN ? '&token=' + TOKEN : '');
    _pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    _pc.ontrack = function (e) { _stream = new MediaStream([e.track]); res(_stream); };
    _pc.onicecandidate = function (e) {
      if (e.candidate && _ws && _ws.readyState === WebSocket.OPEN)
        _ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
    };
    _ws = new WebSocket(url);
    _ws.onmessage = function (e) {
      var msg = JSON.parse(e.data);
      if (msg.type === 'offer')
        _pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          .then(function () { return _pc.createAnswer(); })
          .then(function (a) { return _pc.setLocalDescription(a); })
          .then(function () { _ws.send(JSON.stringify({ type: 'answer', sdp: _pc.localDescription })); })
          .catch(rej);
      else if (msg.type === 'ice')
        _pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(function () {});
    };
    _ws.onerror = function () { rej(new Error('relay')); };
    _ws.onclose = function () { rej(new Error('relay')); };
  }

  function connect(sid) {
    if (_stream && _ws && _ws.readyState === WebSocket.OPEN) return Promise.resolve(_stream);
    if (_dest  && _ws && _ws.readyState === WebSocket.OPEN) return Promise.resolve(_dest.stream);
    return new Promise(function (res, rej) {
      if      (_mode === 'local') _local(res, rej);
      else if (_mode === 'relay') _relay(sid, res, rej);
      else rej(new Error('no mode'));
    });
  }

  function disconnect() {
    if (_ws)  _ws.close();
    if (_pc)  _pc.close();
    if (_ctx) _ctx.close();
    _ws = _pc = _ctx = _dest = _stream = _analyser = null; _rms = 0;
  }

  function detect(onLocal, onRelay) {
    var probe, done = false;
    try { probe = new WebSocket(LOCAL); } catch (e) { _mode = 'relay'; onRelay(); return; }
    var t = setTimeout(function () {
      if (done) return; done = true;
      try { probe.close(); } catch (e2) {}
      _mode = 'relay'; onRelay();
    }, 1500);
    probe.onopen  = function () { if (done) return; done = true; clearTimeout(t); probe.close(); _mode = 'local'; onLocal(); };
    probe.onerror = function () { if (done) return; done = true; clearTimeout(t); _mode = 'relay'; onRelay(); };
    probe.onclose = function () {};
  }

  return {
    connect:     connect,
    disconnect:  disconnect,
    detect:      detect,
    getMode:     function () { return _mode; },
    setRelay:    function (url) { RELAY = url; },
    setToken:    function (t)   { TOKEN = t;   },
    setAnalyser: function (a)   { _analyser = a; },
    getLocalRms: function () {
      if (_rms) return _rms;
      if (!_analyser) return 0;
      var buf = new Uint8Array(_analyser.frequencyBinCount);
      _analyser.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / buf.length);
    }
  };
})();


angular.module('beamng.apps')
.directive('mpvc', function () {
  return {
    restrict: 'E',
    templateUrl: '/ui/modules/apps/MPVC/app.html',
    replace: true,
    controller: function ($scope) {

      var BNG_PROXY  = 'https://www.beamng.com/proxy.php?link=';
      var GITHUB_URL = 'https://github.com/5DROR5/MPVC';
      var DISCORD_URL = 'https://discord.gg/UvM8a5nxB4';
      var DISMISS_KEY = 'mpvc_no_prompt';
      var CHOICE_KEY  = 'mpvc_choice';
      var VAD_THRESHOLD = 0.02, VAD_HOLD_MS = 300;
      var DISCORD_DL_ENABLED = false;

      var myId = -1, bridgeOpened = false, bridgeTokenPending = false, cfg = null;
      var peers = {}, peerNames = {}, peerMicOn = {}, allMpvcPlayers = {}, mutedPeers = {};
      var audioCtx = null, localStream = null, volumeTargets = {}, localSpeakingUntil = 0;

      $scope.mode           = null;
      $scope.nearbyCount    = 0;
      $scope.showChoice     = false;
      $scope.showDownloads  = false;
      $scope.rememberChoice = false;
      $scope.dontRemind     = false;
      $scope.speakersList   = [];
      $scope.localSpeaking  = false;
      $scope.discordEnabled = DISCORD_DL_ENABLED;


      function _lua(s) { if (window.bngApi && typeof window.bngApi.engineLua === 'function') window.bngApi.engineLua(s); }
      function _openDirect(url) { _lua('MPCoreNetwork.openURL("' + url + '")'); }
      function _openProxy(url)  { _lua('openWebBrowser("' + BNG_PROXY + url + '")'); }

      function _tryOpenBridge() {
        if (MicBridge.getMode() !== 'relay' || bridgeOpened || bridgeTokenPending
            || myId === -1 || !cfg || !cfg.server_id) return;
        bridgeTokenPending = true;
        _lua('mpvcRequestBridge([==[' + cfg.server_id + '_' + myId + ']==])');
      }


      $scope.chooseApp = function () {
        if ($scope.rememberChoice) localStorage.setItem(CHOICE_KEY, 'app');
        if ($scope.dontRemind)     localStorage.setItem(DISMISS_KEY, '1');
        $scope.showChoice = false; $scope.showDownloads = true;
      };

      $scope.chooseBrowser = function () {
        if ($scope.rememberChoice) localStorage.setItem(CHOICE_KEY, 'browser');
        if ($scope.dontRemind)     localStorage.setItem(DISMISS_KEY, '1');
        $scope.showChoice = false;
        bridgeOpened = false; bridgeTokenPending = false;
        $scope.mode = 'talk'; applyMode(); _tryOpenBridge();
      };

      $scope.dismissChoice   = function () { if ($scope.dontRemind) localStorage.setItem(DISMISS_KEY, '1'); $scope.showChoice = false; };
      $scope.closeDownloads  = function () { $scope.showDownloads = false; };
      $scope.downloadGithub  = function () { _openProxy(GITHUB_URL);   };
      $scope.downloadDiscord = function () { _openDirect(DISCORD_URL); };

      $scope.toggleMute = function (pid) {
        mutedPeers[pid] = !mutedPeers[pid];
        if (peers[pid] && peers[pid].audioEl)
          peers[pid].audioEl.volume = mutedPeers[pid] ? 0 : targetVol(peers[pid].distance);
      };


      function muteStream()   { if (localStream) localStream.getTracks().forEach(function (t) { t.enabled = false; }); }
      function unmuteStream() { if (localStream) localStream.getTracks().forEach(function (t) { t.enabled = true;  }); }

      function calcVolume(dist) {
        if (!cfg || dist >= cfg.max_distance) return 0;
        if (dist <= cfg.fade_start) return cfg.master_volume;
        var t = (dist - cfg.fade_start) / (cfg.max_distance - cfg.fade_start);
        return (1 - t * t) * cfg.master_volume;
      }

      function targetVol(dist) { return $scope.mode !== null ? calcVolume(dist) : 0; }

      function broadcastMicStatus(on) {
        var payload = JSON.stringify({ micOn: on });
        Object.keys(peers).forEach(function (pid) { sendSignal(parseInt(pid), 'status', payload); });
      }

      function applyMode() {
        if ($scope.mode === 'talk') unmuteStream(); else muteStream();
        Object.keys(peers).forEach(function (pid) { volumeTargets[pid] = targetVol(peers[pid].distance); });
      }


      function initSession() {
        try { audioCtx = new AudioContext(); } catch (e) { return; }
        _lua('mpvcHello()');
      }

      function probebridge() {
        initSession();
        MicBridge.detect(function () {}, function () {});
      }


      function connectMic() {
        var sid = cfg.server_id + '_' + myId;
        var retry = setTimeout(function () { bridgeOpened = false; bridgeTokenPending = false; _tryOpenBridge(); }, 30000);
        MicBridge.connect(sid)
          .then(function (stream) {
            clearTimeout(retry);
            if ($scope.mode !== 'talk') { MicBridge.disconnect(); return; }
            localStream = stream; unmuteStream();
            if (audioCtx) {
              try {
                var src = audioCtx.createMediaStreamSource(stream), an = audioCtx.createAnalyser();
                an.fftSize = 512; src.connect(an); MicBridge.setAnalyser(an);
              } catch (e) {}
            }
            Object.keys(peers).forEach(function (pidStr) {
              var p = peers[parseInt(pidStr)];
              if (!p || !p.pc || p.pc.signalingState === 'closed') return;
              var sender = p.pc.getSenders().filter(function (s) { return s.track && s.track.kind === 'audio'; })[0];
              if (sender) {
                sender.replaceTrack(localStream.getAudioTracks()[0]).catch(function () {});
              } else {
                localStream.getTracks().forEach(function (t) { p.pc.addTrack(t, localStream); });
                if (p.pc.signalingState === 'stable')
                  p.pc.createOffer()
                    .then(function (o) { return p.pc.setLocalDescription(o); })
                    .then(function () { sendSignal(parseInt(pidStr), 'offer', JSON.stringify(p.pc.localDescription)); })
                    .catch(function () {});
              }
            });
            if ($scope.mode === 'talk') broadcastMicStatus(true);
          })
          .catch(function () { clearTimeout(retry); $scope.$applyAsync(function () { $scope.mode = null; }); });
      }

      function disconnectMic() { MicBridge.disconnect(); localStream = null; }


      $scope.talkToggle = function () {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if ($scope.mode === 'talk') {
          $scope.mode = null; applyMode(); broadcastMicStatus(false); return;
        }
        if (MicBridge.getMode() === 'relay' && !bridgeOpened) {
          var dismissed = localStorage.getItem(DISMISS_KEY) === '1';
          var saved     = localStorage.getItem(CHOICE_KEY);
          if      (saved === 'browser') { $scope.mode = 'talk'; applyMode(); _tryOpenBridge(); return; }
          else if (saved === 'app')     { $scope.showDownloads = true; return; }
          else if (!dismissed)          { $scope.showChoice    = true; return; }
          else return;
        }
        $scope.mode = 'talk'; applyMode(); connectMic();
      };

      $scope.listenToggle = function () {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        var wasInTalk = $scope.mode === 'talk';
        $scope.mode = ($scope.mode === 'listen') ? null : 'listen';
        applyMode();
        if (wasInTalk) broadcastMicStatus(false);
      };


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
            var ms = new MediaStream([e.track]), el = document.createElement('audio');
            el.srcObject = ms; el.autoplay = true;
            el.volume = (peers[pid] && !mutedPeers[pid]) ? targetVol(peers[pid].distance) : 0;
            document.body.appendChild(el); el.play().catch(function () {});
            if (peers[pid]) peers[pid].audioEl = el;
            if (audioCtx) {
              try {
                var src = audioCtx.createMediaStreamSource(ms), an = audioCtx.createAnalyser();
                an.fftSize = 512; src.connect(an);
                if (peers[pid]) peers[pid].analyser = an;
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
        try { sendSignal(pid, 'bye', ''); peers[pid].pc.close(); if (peers[pid].audioEl) { peers[pid].audioEl.srcObject = null; peers[pid].audioEl.remove(); } } catch (e) {}
        delete peers[pid]; delete volumeTargets[pid]; delete peerMicOn[pid];
      }


      setInterval(function () {
        var now = Date.now();
        Object.keys(peers).forEach(function (pid) {
          var p = peers[pid]; if (!p) return;
          if (p.audioEl) {
            var tgt = mutedPeers[pid] ? 0 : (volumeTargets[pid] || 0), cur = p.audioEl.volume, d = tgt - cur;
            if (Math.abs(d) > 0.001) p.audioEl.volume = Math.min(1, Math.max(0, cur + d * 0.15));
          }
          if (p.analyser) {
            var buf = new Uint8Array(p.analyser.frequencyBinCount); p.analyser.getByteTimeDomainData(buf);
            var sum = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
            if (Math.sqrt(sum / buf.length) > VAD_THRESHOLD) p.speakingUntil = now + VAD_HOLD_MS;
          }
        });
        if ($scope.mode === 'talk' && MicBridge.getLocalRms() > VAD_THRESHOLD) localSpeakingUntil = now + VAD_HOLD_MS;
      }, 50);

      var _prevJson = '';
      setInterval(function () {
        var now = Date.now(), ls = now < localSpeakingUntil;
        var list = Object.keys(allMpvcPlayers).filter(function (k) { return parseInt(k) !== myId; }).map(function (k) {
          var pid = parseInt(k), p = peers[pid];
          return { pid: pid, name: allMpvcPlayers[k], speaking: p ? now < (p.speakingUntil || 0) : false, muted: !!mutedPeers[pid], micOn: !!peerMicOn[pid] };
        });
        var json = JSON.stringify(list) + ls;
        if (json === _prevJson) return; _prevJson = json;
        $scope.$applyAsync(function () { $scope.speakersList = list; $scope.localSpeaking = ls; });
      }, 150);


      function normalizeArray(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; });
        return [];
      }

      function sendSignal(pid, type, payload) {
        _lua('mpvcSignal([==[' + JSON.stringify({ to: pid, type: type, payload: payload }) + ']==])');
      }


      $scope.$on('VOICE_DistanceUpdate', function (e, data) {
        if (!data || typeof data !== 'object') return;
        if (data.myId !== undefined) myId = data.myId;
        if (myId === -1 || !audioCtx || !cfg) return;

        var players = normalizeArray(data.players), inRange = {};
        players.forEach(function (p) {
          inRange[p.id] = true;
          if (peers[p.id]) {
            peers[p.id].distance = p.distance;
            if (!mutedPeers[p.id]) volumeTargets[p.id] = targetVol(p.distance);
          } else if (p.id > myId) {
            var peer = createPeer(p.id);
            peer.distance = p.distance; volumeTargets[p.id] = mutedPeers[p.id] ? 0 : targetVol(p.distance);
            peer.pc.createOffer()
              .then(function (o) { return peer.pc.setLocalDescription(o); })
              .then(function ()  { sendSignal(p.id, 'offer', JSON.stringify(peer.pc.localDescription)); })
              .catch(function () { closePeer(p.id); });
          }
        });
        Object.keys(peers).forEach(function (pid) { if (!inRange[parseInt(pid)]) closePeer(parseInt(pid)); });
        $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
      });

      $scope.$on('VOICE_PlayersLeft', function (e, pids) {
        normalizeArray(pids).forEach(function (pid) { closePeer(pid); });
        $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
      });

      $scope.$on('VOICE_Signal', function (e, rawData) {
        var msg; try { msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; } catch (err) { return; }
        if (!msg || myId === -1) return;
        var pid = msg.from, peer;
        if (msg.fromName && pid !== undefined) peerNames[pid] = msg.fromName;
        try {
          if (msg.type === 'offer') {
            if (!peers[pid]) createPeer(pid);
            peer = peers[pid];
            peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)))
              .then(function ()  { return peer.pc.createAnswer(); })
              .then(function (a) { return peer.pc.setLocalDescription(a); })
              .then(function ()  { sendSignal(pid, 'answer', JSON.stringify(peer.pc.localDescription)); sendSignal(pid, 'status', JSON.stringify({ micOn: $scope.mode === 'talk' })); $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; }); })
              .catch(function () {});
          } else if (msg.type === 'answer') {
            peer = peers[pid];
            if (peer) peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload))).then(function () { sendSignal(pid, 'status', JSON.stringify({ micOn: $scope.mode === 'talk' })); }).catch(function () {});
          } else if (msg.type === 'ice') {
            peer = peers[pid];
            if (peer) peer.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(msg.payload))).catch(function () {});
          } else if (msg.type === 'status') {
            try { var s = JSON.parse(msg.payload); if (s.micOn !== undefined) peerMicOn[pid] = !!s.micOn; } catch (se) {}
          } else if (msg.type === 'bye') {
            if (peers[pid]) { peers[pid].pc.close(); if (peers[pid].audioEl) { peers[pid].audioEl.srcObject = null; peers[pid].audioEl.remove(); } delete peers[pid]; delete volumeTargets[pid]; delete peerMicOn[pid]; }
            $scope.$applyAsync(function () { $scope.nearbyCount = Object.keys(peers).length; });
          }
        } catch (err) {}
      });

      $scope.$on('VOICE_Config', function (e, c) {
        if (!c || typeof c !== 'object') return;
        if (cfg && cfg.server_id && c.server_id && cfg.server_id !== c.server_id) {
          bridgeOpened = false; bridgeTokenPending = false;
        }
        cfg = c;
        if (cfg.relay_url) MicBridge.setRelay(cfg.relay_url);
      });

      $scope.$on('VOICE_PlayerList', function (e, rawData) {
        var list; try { list = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; } catch (err) { return; }
        if (!Array.isArray(list)) return;
        allMpvcPlayers = {};
        list.forEach(function (p) { if (p.id !== undefined && p.name) allMpvcPlayers[p.id] = p.name; });
      });

      $scope.$on('VOICE_BridgeToken', function (e, data) {
        if (!data || typeof data !== 'object') return;
        bridgeTokenPending = false;
        MicBridge.setToken(data.token);
        bridgeOpened = true;
        var url = (cfg && cfg.bridge_url ? cfg.bridge_url : '')
                  + '?id=' + data.session_id + '&token=' + data.token;
        _lua('openWebBrowser("' + BNG_PROXY + encodeURIComponent(url) + '")');
        if ($scope.mode === 'talk') connectMic();
      });

      $scope.$on('VOICE_Disconnect', function () {
        disconnectMic(); bridgeOpened = false; bridgeTokenPending = false; myId = -1; cfg = null;
      });

      probebridge();
    }
  };
});