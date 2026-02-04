// ===== Chat Module =====

class ChatManager {
  constructor() {
    this.messagesContainer = document.getElementById('messages');
    this.chatInput = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.quickQuestions = document.getElementById('quickQuestions');

    // Onboarding state
    this.step = 'ask_tone'; // 'ask_tone' | 'ask_team' | 'ready'
    this.tone = null;       // '친구' | '해설위원' | '초보자' | '응원단'
    this.fanTeam = null;    // e.g., '두산' | '중립'

    // ✅ FastAPI(railway) base
    this.apiBaseUrl = this.getApiBaseUrl();

    console.log('✅ ChatManager apiBaseUrl:', this.apiBaseUrl);

    this.init();
  }

  getApiBaseUrl() {
    // 우선순위: window.APP_CONFIG.API_BASE_URL > 기본 railway
    const configured =
      (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL)
        ? String(window.APP_CONFIG.API_BASE_URL).trim()
        : '';

    const base = configured || 'https://baseballaichatbot-production.up.railway.app';
    return base.replace(/\/$/, '');
  }

  init() {
    // Send button click
    this.sendBtn.addEventListener('click', () => this.sendMessage());

    // Enter key to send
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    // Quick question buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const question = btn.dataset.question;
        this.chatInput.value = question;
        this.sendMessage();
      });
    });

    // ✅ Onboarding: quick buttons are hidden until ready
    if (this.quickQuestions) this.quickQuestions.style.display = 'none';

    // ✅ placeholder starts with tone selection prompt
    this.setPlaceholderByStep();

    // ✅ Step 0: initial greeting (no API call)
    this.addBotText(
      "안녕하세요! 저는 AI 해설위원이에요 ⚾\n\n" +
      "야구 경기 중 궁금한 점이 있으면 편하게 물어보세요!\n" +
      "규칙, 판정, 용어 등 뭐든 쉽게 설명해드릴게요.\n\n" +
      "우선 어떤 말투를 원하시는지 골라주세요!\n" +
      "친구 / 전문해설위원 / 왕초보자 맞춤 / 치어리더"
    );
  }

  setPlaceholderByStep() {
    if (!this.chatInput) return;

    if (this.step === 'ask_tone') {
      this.chatInput.placeholder = "말투를 골라주세요 (친구/해설위원/초보자/응원단)";
    } else if (this.step === 'ask_team') {
      this.chatInput.placeholder = "응원하는 팀을 입력해주세요 (예: 중립, 두산, SSG...)";
    } else {
      this.chatInput.placeholder = "궁금한 점을 물어보세요... (예: 볼넷이 뭐야?)";
    }
  }

  async sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    // Add user message
    this.addMessage(message, 'user');
    this.chatInput.value = '';

    // ✅ Onboarding flow (no API calls until ready)
    if (this.step === 'ask_tone') {
      const tone = this.normalizeTone(message);
      if (!tone) {
        this.addBotText("말투를 다시 골라주세요!\n친구 / 전문해설위원 / 왕초보자 맞춤 / 치어리더");
        return;
      }
      this.tone = tone;
      this.step = 'ask_team';
      this.setPlaceholderByStep();

      this.addBotText(
        `좋아요! 말투는 (${this.tone})로 할게요.\n\n` +
        "그럼 응원하는 팀을 알려주세요!\n" +
        "예) 중립, 두산, SSG, LG ..."
      );
      return;
    }

    if (this.step === 'ask_team') {
      const team = this.normalizeTeam(message);
      if (!team) {
        this.addBotText("응원팀을 다시 입력해주세요!\n예) 중립, 두산, SSG, LG ...");
        return;
      }
      this.fanTeam = team;
      this.step = 'ready';
      this.setPlaceholderByStep();

      // ✅ READY: show quick questions
      if (this.quickQuestions) this.quickQuestions.style.display = 'flex';

      this.addBotText(
        `✅ 설정 완료!\n\n` +
        `- 한 줄 요약: 말투=(${this.tone}), 응원팀=(${this.fanTeam}) 설정 완료.\n` +
        `- 다음 안내: 이제 경기 보면서 아래처럼 물어보면 돼요.\n` +
        `1) 지금 경기 어떤 상황이야?\n` +
        `2) 지금 타자/투수 누구야?\n` +
        `3) 이게 무슨 규칙이야? (예: 도루, 볼넷, 인필드플라이)`
      );
      return;
    }

    // ✅ READY: now call API
    this.showTypingIndicator();

    try {
      const apiResponse = await this.callProxyChat(message);

      this.hideTypingIndicator();
      if (apiResponse) {
        const formattedResponse = apiResponse.replace(/\n/g, '<br>');
        this.addMessage(formattedResponse, 'bot');
      } else {
        this.addMessage("죄송해요, 응답을 가져오지 못했어요. (API Error)", 'bot');
      }
    } catch (error) {
      console.error('API Error:', error);
      this.hideTypingIndicator();
      this.addMessage("오류가 발생했습니다. 잠시 후 다시 시도해주세요.", 'bot');
    }
  }

  async callProxyChat(userMessage) {
    // ✅ 반드시 절대 URL + 정확한 path
    const url = `${this.apiBaseUrl}/api/proxy/chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: {
          tone: this.tone,
          fan_team: this.fanTeam,
        },
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`Proxy request failed: ${response.status}`, text);
      throw new Error(`Proxy request failed: ${response.status}`);
    }

    const data = await response.json();

    // Wanted LaaS 응답 형태 대응
    const content =
      (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      data.result ||
      data.answer ||
      data.message ||
      (typeof data === 'string' ? data : JSON.stringify(data));

    return content;
  }

  // --- helpers ---

  addBotText(text) {
    const formatted = String(text).replace(/\n/g, '<br>');
    this.addMessage(formatted, 'bot');
  }

  normalizeTone(input) {
    const s = String(input || '').trim().toLowerCase();

    // allow numeric shortcuts
    if (s === '1') return '친구';
    if (s === '2') return '전문해설위원';
    if (s === '3') return '왕초보자 맞춤';
    if (s === '4') return '치어리더';

    // korean keywords
    if (s.includes('친구')) return '친구';
    if (s.includes('해설')) return '전문해설위원';
    if (s.includes('초보')) return '왕초보자 맞춤';
    if (s.includes('응원')) return '치어리더';

    return null;
  }

  normalizeTeam(input) {
    const s = String(input || '').trim();
    if (!s) return null;

    if (s === '중립' || s.toLowerCase() === 'neutral') return '중립';
    return s;
  }

addMessage(text, sender) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', sender);

  let contentHtml = '';

  if (sender === 'bot') {
    contentHtml = `
      <div class="message-content">
        <div class="avatar-icon" style="font-size: 24px; margin-right: 8px;">🤖</div>
        <div class="bubble">${text}</div>
      </div>
    `;
  } else {
    // ✅ 유저 메시지: "나" 표시 제거하고 bubble만
    contentHtml = `
      <div class="message-content">
        <div class="bubble">${text}</div>
      </div>
    `;
  }

  msgDiv.innerHTML = contentHtml;
  this.messagesContainer.appendChild(msgDiv);
  this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
}

  showTypingIndicator() {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'bot', 'typing');
    msgDiv.id = 'typingIndicator';

    msgDiv.innerHTML = `
      <div class="message-content">
        <div class="avatar-icon" style="font-size: 24px; margin-right: 8px;">🤖</div>
        <div class="bubble">
          <div class="dots"><span>.</span><span>.</span><span>.</span></div>
        </div>
      </div>
    `;

    this.messagesContainer.appendChild(msgDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
  }
}

// Global instance
let chatManager;
document.addEventListener('DOMContentLoaded', () => {
  chatManager = new ChatManager();
});
