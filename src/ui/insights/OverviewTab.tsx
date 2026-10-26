// 활동 개요 탭(m3-s2-spec 1·3절): 차트마다 범위. S2 = 활동 히트맵 카드 하나(S3에서 기간 막대·주별 비중이 붙는다).
import { useMemo } from "react";
import { heatRange } from "../../domain/insights";
import type { Category, CategoryPeriod } from "../../domain/types";
import { useBoard } from "../board/boardStore";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { firstRecordOf, useInsights } from "./insightsStore";
import styles from "./Insights.module.css";

interface Props {
  rows: { category: Category; ended: boolean }[];
  periods: CategoryPeriod[];
}

export function OverviewTab({ rows, periods }: Props) {
  const today = useBoard((s) => s.today);
  const unit = useInsights((s) => s.heatUnit);
  const anchor = useInsights((s) => s.heatAnchor[s.heatUnit]);
  const heat = useInsights((s) => s.heat);
  const data = useInsights((s) => s.data);
  const first = firstRecordOf(data);
  const range = useMemo(() => heatRange(unit, anchor, today, first), [unit, anchor, today, first]);
  return (
    <div className={styles.overview} data-testid="insight-overview">
      <ActivityHeatmap range={range} heat={heat} rows={rows} periods={periods} today={today} />
    </div>
  );
}
