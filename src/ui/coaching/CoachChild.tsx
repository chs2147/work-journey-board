// Cabi.NET 별도 창(업무노트·업무 메모보드) 안에서 도는 코칭 투어(coaching-spec 13절).
// 메인 창이 예시 일지의 가상 문서로 이 창을 `coach=T9`처럼 열었을 때만 붙는다. 플래그 저장·내 일지 복귀는 메인 창이 한다.
import { useEffect } from "react";
import { CoachOverlay } from "./CoachOverlay";
import { startChildTour } from "./coachingStore";

export default function CoachChild({ spec }: { spec: string }) {
  useEffect(() => {
    // 문서가 그려질 틈을 조금 둔다(첫 단계는 가운데 말풍선이라 대상이 없어도 된다)
    const t = setTimeout(() => startChildTour(spec), 300);
    return () => clearTimeout(t);
  }, [spec]);
  return <CoachOverlay />;
}
