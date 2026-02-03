// ===== Live Game API Integration =====

class LiveGameManager {
  constructor() {
    this.gameId = '20250922OBSK02025';
    this.pollInterval = 3000;
    this.isPolling = false;
    this.pollTimer = null;
    this.isConnected = false;
    this.gameState = null;

    // 네트워크 흔들림 대비
    this.failCount = 0;
    this.failThreshold = 2;

    // API base URL
    this.baseUrl = this.getApiBaseUrl();

    console.log('✅ LiveGameManager baseUrl:', this.baseUrl);
    this.init();
  }

  // -------------------------
  // API Base URL 결정
  // -------------------------
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

  // -------------------------
  // 초기화
  // -------------------------
  init() {
    this.showOfflineState();
    this.startPolling();

    // ✅ A안 핵심:
    // reset 제거, start만 한 번 시도
    setTimeout(() => this.startServerReplay(), 1000);
  }

  // -------------------------
  // 서버 replay 시작 (reset 없음)
  // -------------------------
  async startServerReplay() {
    try {
      await fetch(
        `${this.baseUrl}/games/${this.gameId}/replay/start?interval=2.0`,
        { method: 'POST' }
      );
      console.log('▶️ 리플레이 start 요청 (reset 없음)');
    } catch (e) {
      console.warn('리플레이 start 실패:', e);
    }
  }

  // -------------------------
  // 상태 표시
  // -------------------------
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
    console.log('📴 오프라인 상태');
  }

  showOnlineState() {
    const banner = document.getElementById('liveBanner');
    if (banner) banner.classList.remove('offline');

    const liveDot = document.querySelector('.live-dot');
    const liveText = document.querySelector('.live-indicator span:last-child');
    if (liveDot) liveDot.style.display = 'block';
    if (liveText) liveText.textContent = 'LIVE';

    this.isConnected = true;
    console.log('🔴 온라인 상태');
  }

  // -------------------------
  // Polling
  // -------------------------
  startPolling() {
    if (this.isPolling) return;

    this.isPolling = true;
    console.log('🔄 LIVE polling 시작');

    this.fetchGameState();
    this.pollTimer = setInterval(
      () => this.fetchGameState(),
      this.pollInterval
    );
  }

  stopPolling() {
    if (!this.isPolling) return;

    this.isPolling = false;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    console.log('⏹️ LIVE polling 중지');
  }

  // -------------------------
  // Game State Fetch
  // -------------------------
  async fetchGameState() {
    try {
      const response = await fetch(
        `${this.baseUrl}/games/${this.gameId}/summary`
      );
      if (!response.ok) {
        throw new Error(`API 오류: ${response.status}`);
      }

      const data = await response.json();
      this.failCount = 0;

      if (!this.isConnected) {
        this.showOnlineState();
      }

      this.gameState = { ...data.state, teams: data.teams };
      this.updateUI(this.gameState);

    } catch (err) {
      console.warn('게임 상태 조회 실패:', err.message);

      this.failCount += 1;
      if (this.isConnected && this.failCount >= this.failThreshold) {
        this.showOfflineState();
      }
    }
  }

  // -------------------------
  // UI 업데이트
  // -------------------------
  updateUI(data) {
    if (data.teams) {
      const homeTeamEl = document.getElementById('homeTeam');
      const awayTeamEl = document.getElementById('awayTeam');

      if (homeTeamEl && data.teams.home) homeTeamEl.textContent = data.teams.home;
      if (awayTeamEl && data.teams.away) awayTeamEl.textContent = data.teams.away;
    }

    if (data.scoreboard) {
      const scoreEl = document.getElementById('gameScore');
      if (scoreEl) {
        const h = data.scoreboard.homeScore ?? '0';
        const a = data.scoreboard.awayScore ?? '0';
        scoreEl.textContent = `${h} : ${a}`;
      }
    }

    if (data.replay) {
      const inningEl = document.getElementById('inningInfo');
      if (inningEl) {
        const label = data.replay.inning_label || '';
        const outs = data.count?.out ?? '0';
        inningEl.textContent = `${label} ${outs}아웃`;
      }
    }
  }

  // -------------------------
  // 외부 접근용 헬퍼
  // -------------------------
  isServerConnected() {
    return this.isConnected;
  }
}

// 전역 인스턴스
let liveGame;
document.addEventListener('DOMContentLoaded', () => {
  liveGame = new LiveGameManager();
  window.liveGame = liveGame;
});
