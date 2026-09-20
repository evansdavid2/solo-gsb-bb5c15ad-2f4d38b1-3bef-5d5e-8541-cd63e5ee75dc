import type { ShapleyResult } from '../../../shared/graph';

interface ShapleyWaterfallProps {
  /** 仅当 computable 为 true 时渲染（调用处保证） */
  result: ShapleyResult;
  labelById: Map<string, string>;
  /** 当前在画布上高亮的证据节点 id */
  activeNodeId: string | null;
  /** 点击某条瀑布条：切换对应证据的画布高亮 */
  onToggle: (nodeId: string) => void;
}

const WIDTH = 316;
const ROW_HEIGHT = 34;
const BAR_HEIGHT = 13;
const MARGIN = { top: 10, right: 10, bottom: 32, left: 10 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;

const formatSigned = (value: number, digits = 4) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const truncate = (label: string, max = 11) => (label.length > max ? `${label.slice(0, max)}…` : label);

/**
 * 证据贡献瀑布条：从「空联盟基准」出发，按 |贡献| 降序逐项叠加 Shapley 贡献，
 * 直到「全联盟」。绿色条为正贡献、红色条为负贡献，虚线标出累计水位。
 * 横轴恒覆盖 0–1 的可信度量纲（累计水位超出时自适应扩展），点击贡献行高亮对应证据。
 */
export function ShapleyWaterfall({ result, labelById, activeNodeId, onToggle }: ShapleyWaterfallProps) {
  if (!result.computable || result.baselineValue === null || result.fullValue === null) return null;
  const baseline = result.baselineValue;
  const full = result.fullValue;

  // 瀑布累计水位：基准 → 逐项 Shapley 贡献 → 全联盟（末项与 full 仅差浮点误差）。
  const partials: number[] = [];
  let cumulative = baseline;
  result.contributions.forEach((item) => {
    cumulative += item.contribution;
    partials.push(cumulative);
  });

  // 量纲恒含 [0,1]：可信度本身落在 0..1，累计水位偶尔越界时仅小幅扩展。
  const lo = Math.min(0, baseline, full, ...partials);
  const hi = Math.max(1, baseline, full, ...partials);
  const span = hi - lo || 1;
  const x = (value: number) => MARGIN.left + ((value - lo) / span) * PLOT_WIDTH;

  const rowCount = result.contributions.length + 2;
  const height = MARGIN.top + rowCount * ROW_HEIGHT + MARGIN.bottom;
  const axisY = MARGIN.top + rowCount * ROW_HEIGHT;
  const labelY = (rowIndex: number) => MARGIN.top + rowIndex * ROW_HEIGHT + 11;
  const barY = (rowIndex: number) => MARGIN.top + rowIndex * ROW_HEIGHT + 17;

  const ticks = [0, 1, 2, 3, 4].map((k) => lo + (span * k) / 4);
  // 相邻行之间的水位连接线：levels[k] 连接第 k 行条末端与第 k+1 行条起点。
  const levels = [baseline, ...partials];

  return (
    <div className="shapley-waterfall">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label="证据贡献瀑布条">
        {/* 网格与刻度 */}
        {ticks.map((tick, index) => (
          <g key={`tick-${index}`}>
            <line x1={x(tick)} x2={x(tick)} y1={MARGIN.top - 4} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
            <text x={x(tick)} y={axisY + 14} textAnchor="middle" fontSize={9.5} fill="#64748b">
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={MARGIN.left + PLOT_WIDTH / 2} y={axisY + 27} textAnchor="middle" fontSize={10} fill="#475569">
          目标观点最终可信度
        </text>
        {lo < 0 && (
          <line x1={x(0)} x2={x(0)} y1={MARGIN.top - 4} y2={axisY} stroke="#94a3b8" strokeWidth={1.4} />
        )}

        {/* 空联盟基准行 */}
        <g>
          <text x={MARGIN.left} y={labelY(0)} fontSize={10.5} fill="#475569" fontWeight={600}>
            空联盟基准（删除全部所选证据）
          </text>
          <text x={WIDTH - MARGIN.right} y={labelY(0)} textAnchor="end" fontSize={10.5} fill="#1e293b" fontWeight={700}>
            {baseline.toFixed(4)}
          </text>
          <rect
            x={x(Math.min(0, baseline))}
            y={barY(0)}
            width={Math.max(1.5, Math.abs(x(baseline) - x(0)))}
            height={BAR_HEIGHT}
            rx={2}
            fill="#94a3b8"
          >
            <title>{`空联盟基准：${baseline.toFixed(4)}`}</title>
          </rect>
        </g>

        {/* 逐项 Shapley 贡献（可点击高亮） */}
        {result.contributions.map((item, index) => {
          const rowIndex = index + 1;
          const from = index === 0 ? baseline : partials[index - 1];
          const to = partials[index];
          const active = item.nodeId === activeNodeId;
          const label = labelById.get(item.nodeId) ?? item.nodeId;
          return (
            <g
              key={item.nodeId}
              className={`shapley-row${active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`证据 ${label}，Shapley 贡献 ${formatSigned(item.contribution)}`}
              onClick={() => onToggle(item.nodeId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle(item.nodeId);
                }
              }}
            >
              {active && (
                <rect
                  x={2}
                  y={MARGIN.top + rowIndex * ROW_HEIGHT + 1}
                  width={WIDTH - 4}
                  height={ROW_HEIGHT - 2}
                  rx={6}
                  fill="rgba(124, 58, 237, 0.08)"
                  stroke="rgba(124, 58, 237, 0.45)"
                />
              )}
              <text
                x={MARGIN.left}
                y={labelY(rowIndex)}
                fontSize={10.5}
                fill={active ? '#6d28d9' : '#475569'}
                fontWeight={600}
              >
                #{index + 1} {truncate(label)}
              </text>
              <text
                x={WIDTH - MARGIN.right}
                y={labelY(rowIndex)}
                textAnchor="end"
                fontSize={10.5}
                fontWeight={700}
                fill={item.contribution >= 0 ? '#15803d' : '#b91c1c'}
              >
                {formatSigned(item.contribution)}
                {item.share === null ? '' : `（占 ${(item.share * 100).toFixed(1)}%）`}
              </text>
              <rect
                x={x(Math.min(from, to))}
                y={barY(rowIndex)}
                width={Math.max(1.5, Math.abs(x(to) - x(from)))}
                height={BAR_HEIGHT}
                rx={2}
                fill={item.contribution >= 0 ? '#16a34a' : '#dc2626'}
              >
                <title>{`${label}：Shapley 贡献 ${formatSigned(item.contribution)}`}</title>
              </rect>
            </g>
          );
        })}

        {/* 全联盟行 */}
        <g>
          <text x={MARGIN.left} y={labelY(rowCount - 1)} fontSize={10.5} fill="#475569" fontWeight={600}>
            全联盟（保留全部所选证据）
          </text>
          <text
            x={WIDTH - MARGIN.right}
            y={labelY(rowCount - 1)}
            textAnchor="end"
            fontSize={10.5}
            fill="#1e293b"
            fontWeight={700}
          >
            {full.toFixed(4)}
          </text>
          <rect
            x={x(Math.min(0, full))}
            y={barY(rowCount - 1)}
            width={Math.max(1.5, Math.abs(x(full) - x(0)))}
            height={BAR_HEIGHT}
            rx={2}
            fill="#2563eb"
          >
            <title>{`全联盟：${full.toFixed(4)}`}</title>
          </rect>
        </g>

        {/* 累计水位连接线 */}
        {levels.map((level, index) => {
          const yTop = barY(index) + BAR_HEIGHT;
          const yBottom = barY(index + 1);
          if (yBottom <= yTop) return null;
          return (
            <line
              key={`level-${index}`}
              x1={x(level)}
              x2={x(level)}
              y1={yTop}
              y2={yBottom}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          );
        })}
      </svg>
    </div>
  );
}
