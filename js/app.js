// ===== Main App Module =====

class App {
    constructor() {
        this.currentTab = 'chat';
        this.currentTeam = null;
        this.currentChantType = 'player'; // 'player' or 'team'
        this.playersData = []; // player.json 데이터
        this.playersByTeam = {}; // 팀별 선수 그룹
        this.teamChantsData = []; // team_chants.json 데이터
        this.teamChantsByKey = {}; // 팀별 응원가 그룹

        this.init();
    }

    async init() {
        await this.loadPlayersData();
        await this.loadTeamChantsData();
        this.initTabs();
        this.initTeamSelector();
        this.initChantToggle();
        this.initPlayerSearch();
        this.initModal();
    }

    // players.json 로드
    async loadPlayersData() {
        try {
            const response = await fetch('player.json');
            this.playersData = await response.json();

            // 팀별로 그룹화
            this.playersByTeam = {};
            this.playersData.forEach(player => {
                const teamKey = player.teamKey;
                if (!this.playersByTeam[teamKey]) {
                    this.playersByTeam[teamKey] = [];
                }
                this.playersByTeam[teamKey].push(player);
            });

            console.log('선수 데이터 로드 완료:', this.playersData.length, '명');
        } catch (error) {
            console.error('선수 데이터 로드 실패:', error);
        }
    }

    // team_chants.json 로드
    async loadTeamChantsData() {
        try {
            const response = await fetch('team_chants.json');
            this.teamChantsData = await response.json();

            // 팀별로 그룹화
            this.teamChantsByKey = {};
            this.teamChantsData.forEach(team => {
                this.teamChantsByKey[team.team] = team.chants;
            });

            console.log('팀 응원가 데이터 로드 완료:', this.teamChantsData.length, '팀');
        } catch (error) {
            console.error('팀 응원가 데이터 로드 실패:', error);
        }
    }

    // ===== Tab Navigation =====
    initTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;

                // Update active button
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update active content
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    if (content.id === `${tab}Tab`) {
                        content.classList.add('active');
                    }
                });

                this.currentTab = tab;
            });
        });
    }

    // ===== Team Selector =====
    initTeamSelector() {
        const teamBtns = document.querySelectorAll('.team-btn');

        teamBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const team = btn.dataset.team;

                // Update active button
                teamBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this.currentTeam = team;
                this.renderCurrentView();
            });
        });

        // Select first team by default
        if (teamBtns.length > 0) {
            teamBtns[0].click();
        }
    }

    // ===== Chant Type Toggle =====
    initChantToggle() {
        const toggleBtns = document.querySelectorAll('.chant-toggle-btn');

        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;

                // Update active button
                toggleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                this.currentChantType = type;
                this.renderCurrentView();
            });
        });
    }

    // ===== Render Current View =====
    renderCurrentView() {
        if (!this.currentTeam) return;

        if (this.currentChantType === 'player') {
            this.renderPlayerList(this.currentTeam);
        } else {
            this.renderTeamChants(this.currentTeam);
        }
    }

    // ===== Player List =====
    renderPlayerList(teamKey) {
        const playerList = document.getElementById('playerList');
        const players = this.playersByTeam[teamKey] || [];

        if (players.length === 0) {
            playerList.innerHTML = '<p class="no-results">선수 정보를 불러올 수 없습니다.</p>';
            return;
        }

        // Player cards (players.json 데이터 사용)
        let html = players.map(player => `
            <div class="player-card" data-team="${teamKey}" data-number="${player.number}">
                <div class="player-number">${player.number}</div>
                <div class="player-info">
                    <h3>${player.name}</h3>
                    <span class="position">${player.position}</span>
                </div>
                <span class="arrow">→</span>
            </div>
        `).join('');

        playerList.innerHTML = html;

        // Add click handlers for player cards
        playerList.querySelectorAll('.player-card').forEach(card => {
            card.addEventListener('click', () => {
                const teamKey = card.dataset.team;
                const number = parseInt(card.dataset.number);
                this.showPlayerModal(teamKey, number);
            });
        });
    }

    // ===== Team Chants =====
    renderTeamChants(teamKey) {
        const playerList = document.getElementById('playerList');
        const chants = this.teamChantsByKey[teamKey] || [];

        if (chants.length === 0) {
            playerList.innerHTML = '<p class="no-results">팀 응원가 정보가 없습니다.</p>';
            return;
        }

        let html = chants.map((chant, index) => `
            <div class="chant-card" data-url="${chant.youtubeUrl}" data-title="${chant.title}">
                <div class="chant-number">${index + 1}</div>
                <div class="chant-info">
                    <h3>${chant.title}</h3>
                    <span class="youtube-badge">▶ YouTube</span>
                </div>
                <span class="arrow">▶</span>
            </div>
        `).join('');

        playerList.innerHTML = html;

        // Add click handlers for chant cards - 모달로 유튜브 표시
        playerList.querySelectorAll('.chant-card').forEach(card => {
            card.addEventListener('click', () => {
                const url = card.dataset.url;
                const title = card.dataset.title;
                this.showTeamChantModal(title, url);
            });
        });
    }

    // 팀 응원가 모달 표시
    showTeamChantModal(title, youtubeUrl) {
        // YouTube URL에서 video ID 추출
        let videoId = '';
        if (youtubeUrl.includes('youtu.be/')) {
            videoId = youtubeUrl.split('youtu.be/')[1].split('?')[0];
        } else if (youtubeUrl.includes('watch?v=')) {
            videoId = youtubeUrl.split('watch?v=')[1].split('&')[0];
        }

        // 모달 내용 업데이트 - 팀 응원가는 가사/팁 없이 유튜브만 표시
        document.getElementById('modalNumber').textContent = '🎵';
        document.getElementById('modalName').textContent = title;
        document.getElementById('modalPosition').textContent = '팀 응원가';

        // 가사/팁 영역 숨기기
        document.getElementById('modalLyrics').parentElement.querySelector('h3').style.display = 'none';
        document.getElementById('modalLyrics').style.display = 'none';
        document.getElementById('modalTip').parentElement.style.display = 'none';

        // YouTube embed + 외부 링크 버튼
        const youtubeContainer = document.getElementById('youtubeContainer');
        if (youtubeContainer && videoId) {
            youtubeContainer.innerHTML = `
                <iframe 
                    width="100%" 
                    height="280" 
                    src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1"
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
                </iframe>
                <a href="${youtubeUrl}" target="_blank" class="youtube-external-btn">
                    ▶ YouTube에서 열기
                </a>
            `;
            youtubeContainer.style.display = 'block';
        }

        // 모달 표시
        const modal = document.getElementById('playerModal');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    // ===== Player Search =====
    initPlayerSearch() {
        const searchInput = document.getElementById('playerSearch');

        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            this.filterPlayers(query);
        });
    }

    filterPlayers(query) {
        // 선수 응원가 카드 필터링
        const playerCards = document.querySelectorAll('.player-card');
        playerCards.forEach(card => {
            const name = card.querySelector('h3').textContent.toLowerCase();
            const number = card.querySelector('.player-number').textContent;

            if (name.includes(query) || number.includes(query) || query === '') {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });

        // 팀 응원가 카드 필터링
        const chantCards = document.querySelectorAll('.chant-card');
        chantCards.forEach(card => {
            const title = card.querySelector('h3').textContent.toLowerCase();

            if (title.includes(query) || query === '') {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    // ===== Player Modal =====
    initModal() {
        const modal = document.getElementById('playerModal');
        const closeBtn = document.getElementById('modalClose');

        closeBtn.addEventListener('click', () => {
            this.hidePlayerModal();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hidePlayerModal();
            }
        });
    }

    showPlayerModal(teamKey, playerNumber) {
        const players = this.playersByTeam[teamKey] || [];
        const player = players.find(p => p.number === playerNumber);

        if (!player) return;

        // Update modal content (players.json 데이터 사용)
        document.getElementById('modalNumber').textContent = player.number;
        document.getElementById('modalName').textContent = player.name;
        document.getElementById('modalPosition').textContent = `${player.team} | ${player.position}`;
        document.getElementById('modalLyrics').innerHTML = player.lyrics.replace(/\n/g, '<br>');
        document.getElementById('modalTip').textContent = player.tip || '';

        // 가사/팁 영역 다시 보이게 (팀 응원가에서 숨겼을 수 있음)
        document.getElementById('modalLyrics').parentElement.querySelector('h3').style.display = '';
        document.getElementById('modalLyrics').style.display = '';
        document.getElementById('modalTip').parentElement.style.display = '';

        // YouTube embed + 외부 링크 버튼
        const youtubeContainer = document.getElementById('youtubeContainer');
        if (youtubeContainer) {
            if (player.youtubeId) {
                const startTime = player.startTime || 0;
                const youtubeUrl = `https://www.youtube.com/watch?v=${player.youtubeId}&t=${startTime}`;
                youtubeContainer.innerHTML = `
                    <iframe 
                        width="100%" 
                        height="280" 
                        src="https://www.youtube.com/embed/${player.youtubeId}?start=${startTime}&autoplay=1&rel=0&playsinline=1"
                        frameborder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowfullscreen>
                    </iframe>
                    <a href="${youtubeUrl}" target="_blank" class="youtube-external-btn">
                        ▶ YouTube에서 열기
                    </a>
                `;
                youtubeContainer.style.display = 'block';
            } else {
                youtubeContainer.innerHTML = '';
                youtubeContainer.style.display = 'none';
            }
        }

        // Show modal
        const modal = document.getElementById('playerModal');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    hidePlayerModal() {
        const modal = document.getElementById('playerModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';

        // Stop YouTube video
        const youtubeContainer = document.getElementById('youtubeContainer');
        if (youtubeContainer) {
            youtubeContainer.innerHTML = '';
        }
    }
}

// Initialize app when DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});
