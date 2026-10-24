/** SHA-256 16진 문자열(Web Crypto — 앱 안에서 계산, 외부 통신 없음). 주간 요약의 근거 해시에 쓴다(output-spec 2-3) */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
