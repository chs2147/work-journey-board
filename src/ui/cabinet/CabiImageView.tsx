import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { CABI } from "../../shared/cabiStrings";
import { cabiClient } from "./cabiService";
export function CabiImageView({ node }: NodeViewProps) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    void cabiClient()
      .asset(String(node.attrs.asset))
      .then((a) => {
        if (alive && a) setUrl(`data:${a.mime};base64,${a.data}`);
      });
    return () => {
      alive = false;
    };
  }, [node.attrs.asset]);
  return (
    <NodeViewWrapper as="figure" data-drag-handle>
      {url ? <img src={url} alt={String(node.attrs.alt ?? "")} /> : <span>{CABI.assetMissing}</span>}
    </NodeViewWrapper>
  );
}
