// ===== Live Game API Integration =====

class LiveGameManager {
  constructor() {
    this.gameId = '20250922OBSK02025';
    this.pollInterval = 3000; // 3초마다 업데이트
    this.isPolling = false;
    this.pollTimer = null;
    this.isConnected = false; // 서버 연결 상태
    this.gameState = null; // Store full game state

    // ✅ baseUrl 결정 (배포=Railway 우선, 로컬=localhost 우선)
    this.baseUrl = this.getApiBaseUrl();

    console.log('✅ LiveGameManager baseUrl:', this.baseUrl);
    this.init();
  }

  // ✅ 배포/로컬 환경에 따라 API Base URL을 안정적으로 결정
  getApiBaseUrl() {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

    // 1) 배포 환경이면 Railway를 기본값으로 강제 (config가 깨져도 안전)
    if (!isLocal) {
      const configured =
        (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL)
          ? String(window.APP_CONFIG.API_BASE_URL).trim()
          : '';

      // config가 있으면 그걸 쓰고, 없으면 Railway 고정
      const base = configured || 'https://baseballaichatbot-production.up.railway.app';
      return base.replace(/\/$/, '');
    }

    // 2) 로컬 환경이면 config가 있으면 쓰고, 없으면 localhost
    const configured =
      (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL)
        ? String(window.APP_CONFIG.API_BASE_URL).trim()
        : '';

    const base = configured || 'http://127.0.0.1:8000';
    return base.replace(/\/$/, '');
  }

  init() {
    // 초기 상태: 오프라인으로 시작
    this.showOfflineState();

    // 페이지 로드 시 자동 시작
    this.startPolling();

    // 서버에 리플레이 시작 요청 (자동 재생)
    setTimeout(() => this.startServerReplay(), 1000);
  }

  async startServerReplay() {
    try {
      await fetch(`${this.baseUrl}/games/${this.gameId}/replay/start?interval=2.0`, { method: 'POST' });
      console.log('▶️ 리플레이 자동 시작 요청');
    } catch (e) {
      console.warn('리플레이 시작 실패:', e);
    }
  }

  // API 베이스 URL 수동 변경 (필요 시)
  setBaseUrl(url) {
    const u = (url || '').trim();
    const finalUrl = u ? u : this.getApiBaseUrl();
    this.baseUrl = finalUrl.replace(/\/$/, '');
    console.log('API URL 변경:', this.baseUrl);
  }

  // 게임 ID 설정
  setGameId(gameId) {
    this.gameId = gameId;
    console.log('게임 ID 변경:', this.gameId);
  }

  // 오프라인 상태 표시
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

  // 온라인 상태 표시
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

  // 폴링 시작
  startPolling() {
    if (this.isPolling) return;

    this.isPolling = true;
    console.log('🔄 LIVE 업데이트 시작 (연결 시도 중...)');

    // 즉시 한 번 호출
    this.fetchGameState();

    // 주기적으로 호출
    this.pollTimer = setInterval(() => {
      this.fetchGameState();
    }, this.pollInterval);
  }

  // 폴링 중지
  stopPolling() {
    if (!this.isPolling) return;

    this.isPolling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('⏹️ LIVE 업데이트 중지');
  }

  // 게임 상태 가져오기 (팀명 포함된 summary API 사용)
  async fetchGameState() {
    try {
      const response = await fetch(`${this.baseUrl}/games/${this.gameId}/summary`);
      if (!response.ok) throw new Error(`API 오류: ${response.status}`);

      const data = await response.json();

      // 연결 성공 - 온라인 상태로 전환
      if (!this.isConnected) this.showOnlineState();

      // summary API 응답에서 state 객체 사용
      this.gameState = { ...data.state, teams: data.teams };
      this.updateUI(this.gameState);

    } catch (error) {
      console.warn('게임 상태 조회 실패:', error.message);
      // 연결 실패 - 오프라인 상태로 전환
      if (this.isConnected) this.showOfflineState();
    }
  }

  // UI 업데이트
  updateUI(data) {
    // 팀명 업데이트
    if (data.teams) {
      const homeTeamEl = document.getElementById('homeTeam');
      if (homeTeamEl && data.teams.home) homeTeamEl.textContent = data.teams.home;

      const awayTeamEl = document.getElementById('awayTeam');
      if (awayTeamEl && data.teams.away) awayTeamEl.textContent = data.teams.away;
    }

    // 스코어 업데이트
    if (data.scoreboard) {
      const scoreEl = document.getElementById('gameScore');
      if (scoreEl) {
        const homeScore = data.scoreboard.homeScore || '0';
        const awayScore = data.scoreboard.awayScore || '0';
        scoreEl.textContent = `${homeScore} : ${awayScore}`;
      }
    }

    // 이닝 정보 업데이트
    if (data.replay) {
      const inningEl = document.getElementById('inningInfo');
      if (inningEl) {
        const inningLabel = data.replay.inning_label || '';
        const outs = data.count?.out || '0';
        inningEl.textContent = `${inningLabel} ${outs}아웃`;
      }
    }

    console.log('📊 UI 업데이트:', data);
  }

  // 현재 상황 요약 가져오기 (채팅에서 사용)
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

  // 최근 이벤트 가져오기
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

// 전역 인스턴스 생성
let liveGame;
document.addEventListener('DOMContentLoaded', () => {
  liveGame = new LiveGameManager();
  window.liveGame = liveGame;
});
