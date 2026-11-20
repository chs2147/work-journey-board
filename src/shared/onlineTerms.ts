// G-8(docs/v2-design/104) 온라인 기능 개인정보 안내 · 이용 안내 — 앱 안에서 보여 주는 글(외부 페이지 없음, 통신 없음).
// 정본 = 104문서. 이 글을 고치면 104문서도 함께 고친다(tests/unit/onlineTerms.test.ts가 문단이 같은지 본다).
// 문의 이메일 = 운영자(관리자) 주소 — 2026-11-20 사용자 결정(G-9 출시).

/** 바뀌면 다시 동의를 받는다(설정 config.json `onlineTerms.version`과 비교) */
export const TERMS_VERSION = "2026-11-20";
/** 문의 주소 — 비어 있으면 자리 표시를 그대로 보여 준다 */
export const CONTACT: string | null = "chs2147@gmail.com";
export const CONTACT_PLACEHOLDER = "[문의 이메일]";

export type TermsKind = "privacy" | "terms";
export interface TermsSection {
  title: string;
  /** 문단·목록 줄. "- "로 시작하면 목록 줄 */
  lines: string[];
}
export interface TermsDoc {
  title: string;
  intro?: string;
  sections: TermsSection[];
  footer?: string;
}

export const ONLINE_TERMS: Record<TermsKind, TermsDoc> = {
  privacy: {
    title: "개인정보 안내 — Work Journey Board 온라인 기능",
    intro:
      "Work Journey Board는 기본적으로 내 PC에만 기록을 저장합니다. 온라인 기능에 로그인한 경우에만 아래 정보가 서버에 저장됩니다. 로그인하지 않으면 어떤 정보도 서버로 보내지 않습니다.",
    sections: [
      {
        title: "1. 저장하는 정보",
        lines: [
          "- 계정: 이메일 주소, 로그인 기록(마지막 로그인 시각)",
          "- 온라인 워크스페이스에 올린 내용: 업무·기록·메모·노트와 그 안의 그림",
          "- 기기 식별 번호(무작위로 만든 값, 동기화에 씁니다)",
        ],
      },
      {
        title: "2. 쓰는 곳",
        lines: [
          "- 로그인 확인, 여러 기기 사이의 동기화, 계정별 사용량 계산에만 씁니다.",
          "- 광고·분석·다른 서비스 제공에 쓰지 않으며, 다른 사람에게 팔거나 넘기지 않습니다.",
        ],
      },
      {
        title: "3. 저장 위치와 맡기는 곳",
        lines: [
          "- 서버: Supabase(일본 도쿄 지역)에 저장합니다. 저장된 내용은 Supabase가 암호화해 보관합니다.",
          "- 로그인 인증번호 메일은 Resend를 통해 보냅니다(이메일 주소만 전달).",
        ],
      },
      {
        title: "4. 보관과 삭제",
        lines: [
          "- 온라인 워크스페이스를 [서버에서 지우기] 하면 기록은 바로, 그림은 확인을 거쳐 곧바로 서버에서 지워집니다.",
          "- 기록에서 빠진 그림은 7일 뒤 서버에서 지워집니다.",
          "- [계정 삭제] 를 하면 그 계정의 온라인 워크스페이스와 그림, 로그인 정보가 모두 지워집니다. 되돌릴 수 없습니다.",
          "- 내 PC의 일지와 이 기기 사본은 서버가 지우지 않습니다. 직접 관리합니다.",
          "- 운영자는 장애 대비를 위해 필요할 때 서버 내용을 내려받아 보관할 수 있고, 계정이나 공간을 지우면 다음 보관분부터 빠집니다. 보관분은 3개월이 지나면 지웁니다.",
        ],
      },
      {
        title: "5. 내 권리",
        lines: [
          "- 언제든 앱에서 공간 지우기·계정 삭제로 정보를 지울 수 있습니다. 그 밖의 요청은 {contact}로 보내 주세요.",
        ],
      },
    ],
  },
  terms: {
    title: "온라인 기능 이용 안내",
    sections: [
      {
        title: "1. 운영 방식",
        lines: ["개인이 운영하는 무료 기능입니다. 운영자가 초대한 이메일로만 가입할 수 있습니다."],
      },
      {
        title: "2. 사용량",
        lines: [
          "계정마다 그림 100MB · 온라인 워크스페이스 3개 · 기록 30MB까지 쓸 수 있습니다(운영자가 조정할 수 있음). 한도를 넘으면 새로 늘리는 것만 막히고, 이미 있는 내용과 이 기기 저장은 그대로입니다.",
        ],
      },
      {
        title: "3. 중단 가능성",
        lines: [
          "무료 서버 사정이나 운영 사정으로 온라인 기능이 잠시 또는 완전히 멈출 수 있습니다. 완전히 멈추기 전에는 메일로 미리 알립니다. 멈춰도 내 PC의 일지와 이 기기 사본은 그대로 쓸 수 있습니다.",
        ],
      },
      {
        title: "4. 백업",
        lines: [
          "중요한 기록은 내 PC 일지(로컬 워크스페이스)에도 남겨 두세요. 온라인 기능은 여러 기기 사이의 동기화를 위한 것이며, 유일한 보관 장소로 쓰지 않는 것을 권합니다.",
        ],
      },
      {
        title: "5. 이용 제한",
        lines: [
          "다른 사람의 정보를 허락 없이 올리거나, 서버에 무리를 주는 사용이 확인되면 그 계정을 읽기 전용으로 바꾸거나 삭제할 수 있습니다.",
        ],
      },
      { title: "6. 문의", lines: ["{contact}"] },
    ],
    footer: "시행일: 2026-11-20",
  },
};

/** 문의 자리 채우기 */
export function withContact(line: string): string {
  return line.replaceAll("{contact}", CONTACT ?? CONTACT_PLACEHOLDER);
}

/** 이 버전에 동의했나 */
export function termsAccepted(saved: { version?: unknown } | null | undefined): boolean {
  return !!saved && saved.version === TERMS_VERSION;
}
