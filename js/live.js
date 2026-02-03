// ===== Live Game API Integration =====

class LiveGameManager {
    constructor() {
        // API 설정 - 나중에 ngrok URL로 변경
        // API 설정 - 동일 출처(같은 포트) 사용
        this.baseUrl = 'http://127.0.0.1:8000'; // FastAPI 서버
        // 안전장치: baseUrl이 비어있으면 로컬 FastAPI로 강제
        if (!this.baseUrl) this.baseUrl = 'http://127.0.0.1:8000';
        this.gameId = '20250922OBSK02025';
        this.pollInterval = 3000; // 3초마다 업데이트
        this.isPolling = false;
        this.pollTimer = null;
        this.isConnected = false; // 서버 연결 상태
        this.gameState = null; // Store full game state

        console.log('✅ LiveGameManager baseUrl:', this.baseUrl);
        this.init();
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

    // API 베이스 URL 설정 (ngrok URL로 변경 시 사용)
    setBaseUrl(url) {
        const u = (url || '').trim();
        // ✅ 빈 값이면 로컬 FastAPI로 자동 설정
        const finalUrl = u ? u : 'http://127.0.0.1:8000';
        this.baseUrl = finalUrl.replace(/\/$/, ''); // 끝 슬래시 제거
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
        if (banner) {
            banner.classList.add('offline');
        }

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
        if (banner) {
            banner.classList.remove('offline');
        }

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

            if (!response.ok) {
                throw new Error(`API 오류: ${response.status}`);
            }

            const data = await response.json();

            // 연결 성공 - 온라인 상태로 전환
            if (!this.isConnected) {
                this.showOnlineState();
            }

            // summary API 응답에서 state 객체 사용
            this.gameState = { ...data.state, teams: data.teams };
            this.updateUI(this.gameState);

        } catch (error) {
            console.warn('게임 상태 조회 실패:', error.message);
            // 연결 실패 - 오프라인 상태로 전환
            if (this.isConnected) {
                this.showOfflineState();
            }
        }
    }

    // UI 업데이트
    updateUI(data) {
        // 팀명 업데이트 (teams 객체에서)
        if (data.teams) {
            const homeTeamEl = document.getElementById('homeTeam');
            if (homeTeamEl && data.teams.home) {
                homeTeamEl.textContent = data.teams.home;
            }

            const awayTeamEl = document.getElementById('awayTeam');
            if (awayTeamEl && data.teams.away) {
                awayTeamEl.textContent = data.teams.away;
            }
        }

        // 스코어 업데이트 (scoreboard 객체에서)
        if (data.scoreboard) {
            const scoreEl = document.getElementById('gameScore');
            if (scoreEl) {
                const homeScore = data.scoreboard.homeScore || '0';
                const awayScore = data.scoreboard.awayScore || '0';
                scoreEl.textContent = `${homeScore} : ${awayScore}`;
            }
        }

        // 이닝 정보 업데이트 (replay 객체에서)
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

    // 서버 연결 상태 확인
    isServerConnected() {
        return this.isConnected;
    }
}

// 전역 인스턴스 생성
let liveGame;
document.addEventListener('DOMContentLoaded', () => {
    liveGame = new LiveGameManager();

    // 전역에서 접근 가능하도록
    window.liveGame = liveGame;
});
