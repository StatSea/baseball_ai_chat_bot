// ===== Live Game API Integration =====

class LiveGameManager {
  constructor() {
    this.gameId = '20250922OBSK02025';
    this.pollInterval = 3000;
    this.isPolling = false;
    this.pollTimer = null;
    this.isConnected = false;
    this.gameState = null;

    // ✅ 네트워크 흔들림 대비
    this.failCount = 0;
    this.failThreshold = 2; // 2번 연속 실패 시 offline

    // ✅ baseUrl 결정
    this.baseUrl = this.getApiBaseUrl();

    console.log('✅ LiveGameManager baseUrl:', this.baseUrl);
    this.init();
  }

  getApiBaseUrl() {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

    const configured =
      (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL)
        ? String(window.APP_CONFIG.API_BASE_URL).trim()
        : '';

    if (!isLocal) {
      const base = configured || 'https://baseballaichatbot-production.up.railway.app';
      return base.replace(/\/$/, '');
    }

    const base = configured || 'http://127.0.0.1:8000';
    return base.replace(/\/$/, '');
  }

  init() {
    this.showOfflineState();
    this.startPolling();

    // ✅ 항상 "처음부터" 보이게: reset -> start
    setTimeout(() => this.startServerReplay(), 1000);
  }

  async startServerReplay() {
    try {
      // 🔥 핵심: reset 후 start
      await fetch(`${this.baseUrl}/games/${this.gameId}/replay/reset`, { method: 'POST' });
      await fetch(`${this.baseUrl}/games/${this.gameId}/replay/start?interval=2.0`, { method: 'POST' });

      console.log('▶️ 리플레이 reset 후 자동 시작 요청');
    } catch (e) {
      console.warn('리플레이 시작 실패:', e);
    }
  }

  setBaseUrl(url) {
    const u = (url || '').trim();
    const finalUrl = u ? u : this.getApiBaseUrl();
    this.baseUrl = finalUrl.replace(/\/$/, '');
    console.log('API URL 변경:', this.baseUrl);
  }

  setGameId(gameId) {
    this.gameId = gameId;
    console.log('게임 ID 변경:', this.gameId);
  }

  showOfflineState() {
    const banner = document.getElementById('liveBanner');
    if (banner) banner.classList.add('offline');

    const liveDot = document.querySelector('.live-dot');
    const liveText = document.querySelector('.live-indicator span:last-child');
    if (liveDot) liveDot.style.display = 'none';
    if (liveText) liveText.textContent = '경기 없음';

    const homeTeamEl = document.getElementById('homeTeam');
    const awayTeamEl = document.getElementById('awayTeam');
    const scoreEl = document.getElementById('gameScore');
    const inningEl = document.getElementById('inningInfo');

    if (homeTeamEl) homeTeamEl.textContent = '-';
    if (awayTeamEl) awayTeamEl.textContent = '-';
    if (scoreEl) scoreEl.textContent = '- : -';
    if (inningEl) inningEl.textContent = '서버 연결 대기';

    this.isConnected = false;
    console.log('📴 오프라인 상태 표시');
  }

  showOnlineState() {
    const banner = document.getElementById('liveBanner');
    if (banner) banner.classList.remove('offline');

    const liveDot = document.querySelector('.live-dot');
    const liveText = document.querySelector('.live-indicator span:last-child');
    if (liveDot) liveDot.style.display = 'block';
    if (liveText) liveText.textContent = 'LIVE';

    this.isConnected = true;
    console.log('🔴 온라인 상태 표시');
  }

  startPolling() {
    if (this.isPolling) return;

    this.isPolling = true;
    console.log('🔄 LIVE 업데이트 시작 (연결 시도 중...)');

    this.fetchGameState();
    this.pollTimer = setInterval(() => this.fetchGameState(), this.pollInterval);
  }

  stopPolling() {
    if (!this.isPolling) return;

    this.isPolling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('⏹️ LIVE 업데이트 중지');
  }

  async fetchGameState() {
    try {
      const response = await fetch(`${this.baseUrl}/games/${this.gameId}/summary`);
      if (!response.ok) throw new Error(`API 오류: ${response.status}`);

      const data = await response.json();

      // ✅ 성공 시 실패 카운트 초기화
      this.failCount = 0;

      if (!this.isConnected) this.showOnlineState();

      this.gameState = { ...data.state, teams: data.teams };
      this.updateUI(this.gameState);

    } catch (error) {
      console.warn('게임 상태 조회 실패:', error.message);

      // ✅ 연속 실패일 때만 offline 전환
      this.failCount += 1;
      if (this.isConnected && this.failCount >= this.failThreshold) {
        this.showOfflineState();
      }
    }
  }

  updateUI(data) {
    if (data.teams) {
      const homeTeamEl = document.getElementById('homeTeam');
      if (homeTeamEl && data.teams.home) homeTeamEl.textContent = data.teams.home;

      const awayTeamEl = document.getElementById('awayTeam');
      if (awayTeamEl && data.teams.away) awayTeamEl.textContent = data.teams.away;
    }

    if (data.scoreboard) {
      const scoreEl = document.getElementById('gameScore');
      if (scoreEl) {
        const homeScore = data.scoreboard.homeScore || '0';
        const awayScore = data.scoreboard.awayScore || '0';
        scoreEl.textContent = `${homeScore} : ${awayScore}`;
      }
    }

    if (data.replay) {
      const inningEl = document.getElementById('inningInfo');
      if (inningEl) {
        const inningLabel = data.replay.inning_label || '';
        const outs = data.count?.out || '0';
        inningEl.textContent = `${inningLabel} ${outs}아웃`;
      }
    }
  }

  async getSummary() {
    try {
      const response = await fetch(`${this.baseUrl}/games/${this.gameId}/summary`);
      if (!response.ok) throw new Error('요약 조회 실패');
      const data = await response.json();
      return data.summary || data.text || JSON.stringify(data);
    } catch (error) {
      console.warn('요약 조회 실패:', error.message);
      return null;
    }
  }

  async getRecentEvents(n = 5) {
    try {
      const response = await fetch(`${this.baseUrl}/games/${this.gameId}/commentary?n=${n}`);
      if (!response.ok) throw new Error('이벤트 조회 실패');
      return await response.json();
    } catch (error) {
      console.warn('이벤트 조회 실패:', error.message);
      return null;
    }
  }

  isServerConnected() {
    return this.isConnected;
  }
}

let liveGame;
document.addEventListener('DOMContentLoaded', () => {
  liveGame = new LiveGameManager();
  window.liveGame = liveGame;
});
