# Vercel Production · DEV 온라인 데이터

`work-journey-board.vercel.app`은 Vercel Production으로 배포합니다. 웹 로그인과 온라인 공간은 기존 Supabase DEV 프로젝트를 사용합니다. 따라서 DEV 데스크탑과 같은 계정·공간에서 동기화합니다.

- Supabase DEV에 `wj_web_live` 역할 마이그레이션을 적용합니다. 역할에는 기존 웹 세션 권한만 상속됩니다. 비밀번호는 관리자 연결에서 설정하고 저장소에 남기지 않습니다.
- Vercel **Production**에 기존 DEV 프로젝트 참조·공개 키·CA 인증서를 등록합니다. `WJB_WEB_ORIGIN`은 `https://work-journey-board.vercel.app`로 설정합니다.
- `WJB_WEB_DATABASE_URL`은 `wj_web_live.<DEV 프로젝트 참조>`의 Transaction pooler URI로 설정합니다. `WJB_WEB_SESSION_KEY`는 Production 전용 32바이트 Base64 키로 설정합니다. 두 값은 **Sensitive**로 등록합니다. Preview에서 시작한 웹 세션은 Production 전환 후 다시 로그인해야 합니다.
- 공개 도메인 자동 배정을 끄고 Production 배포를 먼저 준비합니다. Production 빌드는 실제 설정으로 로그인 화면, 동일 출처 검증, 기존 세션 DB의 읽기 권한을 확인합니다. 통과한 배포를 승격하고 기존 공개 주소를 Production 환경에 연결합니다.

[Vercel의 단계적 Production 배포](https://vercel.com/docs/deployments/promoting-a-deployment)
