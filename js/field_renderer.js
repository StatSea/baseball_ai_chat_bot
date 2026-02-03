
/**
 * FieldRenderer handles the visual representation of the baseball field
 * including defensive positions, runners on base, and SBO count.
 */
class FieldRenderer {
    constructor() {
        // Position mapping for fielders (mock data fallback)
        this.positions = {
            '피처': { class: 'pos-pitcher', label: '투수' },
            '캐처': { class: 'pos-catcher', label: '포수' },
            '1루수': { class: 'pos-1b', label: '1루수' },
            '2루수': { class: 'pos-2b', label: '2루수' },
            '3루수': { class: 'pos-3b', label: '3루수' },
            '유격수': { class: 'pos-ss', label: '유격수' },
            '좌익수': { class: 'pos-lf', label: '좌익수' },
            '중견수': { class: 'pos-cf', label: '중견수' },
            '우익수': { class: 'pos-rf', label: '우익수' }
        };
    }

    /**
     * Renders the field widget HTML string
     * @param {Object} gameState - The current game state object
     * @returns {string} HTML string of the field widget
     */
    render(gameState) {
        if (!gameState) return `<div class="message-content">경기 정보를 불러올 수 없습니다.</div>`;

        const teams = gameState.teams || { home: '홈', away: '원정' };
        const score = gameState.scoreboard || { homeScore: 0, awayScore: 0 };
        const inning = gameState.replay || { inning_label: '-' };
        const count = gameState.count || { ball: 0, strike: 0, out: 0 };
        const bases = gameState.bases || {};

        // Helper to check if base is occupied
        const isOccupied = (val) => val && val !== "0" && val !== 0;

        return `
            <div class="field-widget-container">
                <!-- Header (Score & Inning) -->
                <div class="field-header">
                    <div class="field-score-board">
                        <div class="field-team">
                            <span class="field-team-logo">${this.getTeamEmoji(teams.away)}</span>
                            <span class="field-team-name">${teams.away}</span>
                        </div>
                        <div class="field-score">
                            ${score.awayScore} : ${score.homeScore}
                        </div>
                        <div class="field-team">
                            <span class="field-team-logo">${this.getTeamEmoji(teams.home)}</span>
                            <span class="field-team-name">${teams.home}</span>
                        </div>
                    </div>
                    <div class="field-inning">
                        <span>${inning.inning_label}</span>
                        <span>${this.getOutDisplay(count.out)}</span>
                    </div>
                </div>

                <!-- Field Diamond -->
                <div class="field-diamond-container">
                    <!-- SBO Overlay -->
                    <div class="sbo-overlay">
                        <div class="sbo-row sbo-b">
                            <span class="sbo-label" style="color:#22c55e">B</span>
                            <div class="sbo-circles">
                                ${this.renderDots(count.ball, 3)}
                            </div>
                        </div>
                        <div class="sbo-row sbo-s">
                            <span class="sbo-label" style="color:#eab308">S</span>
                            <div class="sbo-circles">
                                ${this.renderDots(count.strike, 2)}
                            </div>
                        </div>
                        <div class="sbo-row sbo-o">
                            <span class="sbo-label" style="color:#ef4444">O</span>
                            <div class="sbo-circles">
                                ${this.renderDots(count.out, 2)}
                            </div>
                        </div>
                    </div>

                    <!-- The Diamond -->
                    <div class="diamond-shape">
                        <div class="diamond-inner-grass"></div>
                        
                        <!-- Bases -->
                        <div class="base base-1 ${isOccupied(bases.base1) ? 'active' : ''}"></div>
                        <div class="base base-2 ${isOccupied(bases.base2) ? 'active' : ''}"></div>
                        <div class="base base-3 ${isOccupied(bases.base3) ? 'active' : ''}"></div>
                        <div class="base base-home"></div>
                    </div>

                    <!-- Fielders (Static for now as API doesn't provide them yet) -->
                    ${this.renderFielders()}

                    <!-- Batter Info -->
                    <div class="batter-info">
                        <span style="font-size:10px; color:#666; margin-bottom:2px">현재 타석</span>
                        <span>김타자 (예시)</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderDots(current, max) {
        let n = parseInt(current) || 0;
        let html = '';
        for (let i = 0; i < max; i++) {
            html += `<div class="sbo-dot ${i < n ? 'active' : ''}"></div>`;
        }
        return html;
    }

    getOutDisplay(outCounts) {
        const n = parseInt(outCounts) || 0;
        return `${n} 아웃`;
    }

    getTeamEmoji(teamName) {
        if (!teamName) return '⚾';
        const map = {
            '두산': '🐻', '삼성': '🦁', 'LG': '🔥', '키움': '🦸🏻',
            'KT': '🧙', 'KIA': '🐯', '한화': '🦅', 'NC': '🦕',
            '롯데': '🕊️', 'SSG': '🛸'
        };
        for (const [k, v] of Object.entries(map)) {
            if (teamName.includes(k)) return v;
        }
        return '⚾';
    }

    renderFielders() {
        // In a real scenario, we would iterate over gameState.fielders
        // For now, we render static markers or placeholder data
        return `
            <div class="player-marker pos-pitcher">투수</div>
            <div class="player-marker pos-catcher">포수</div>
            <div class="player-marker pos-1b">1루수</div>
            <div class="player-marker pos-2b">2루수</div>
            <div class="player-marker pos-3b">3루수</div>
            <div class="player-marker pos-ss">유격수</div>
            <div class="player-marker pos-lf">좌익수</div>
            <div class="player-marker pos-cf">중견수</div>
            <div class="player-marker pos-rf">우익수</div>
        `;
    }
}

// Global instance
const fieldRenderer = new FieldRenderer();
