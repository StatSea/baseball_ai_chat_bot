// ===== App Config (Front <-> Back 연결 설정) =====
//
// ✅ 배포 환경(Vercel)에서는 여기 API_BASE_URL을 Railway 백엔드 도메인으로 설정하세요.
//    예: https://baseballaichatbot-production.up.railway.app
//
// ✅ 로컬 개발에서는 비워두면 자동으로 http://127.0.0.1:8000 을 사용합니다.
//
// (주의) 끝에 / 는 붙여도/안붙여도 상관없게 처리합니다.
window.APP_CONFIG = {
  API_BASE_URL: "https://baseballaichatbot-production.up.railway.app",
};
