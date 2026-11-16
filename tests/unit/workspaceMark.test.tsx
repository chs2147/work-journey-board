// 온라인 워크스페이스 구름 표시(docs/v2-design/95 U8): 같은 크기 모노그램 + 구름, 오프라인 전용은 지금 그대로
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceMark } from "../../src/ui/common/workspaceIcons";

describe("WorkspaceMark 구름 표시", () => {
  it("오프라인 전용 공간은 구름이 없다(정식판 그대로)", () => {
    const { container } = render(<WorkspaceMark icon="briefcase" color="c1" size={30} />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.hasAttribute("data-online")).toBe(false);
    expect(container.querySelector("[data-testid=workspace-cloud]")).toBeNull();
  });

  it("온라인 공간은 같은 크기에 구름 표시를 겹친다", () => {
    const { container } = render(<WorkspaceMark icon="briefcase" color="c1" size={30} online />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.style.width).toBe("30px");
    expect(mark.style.height).toBe("30px");
    expect(mark.hasAttribute("data-online")).toBe(true);
    const cloud = container.querySelector<HTMLElement>("[data-testid=workspace-cloud]");
    expect(cloud).not.toBeNull();
    expect(cloud!.title).toBe("온라인 워크스페이스");
  });
});
