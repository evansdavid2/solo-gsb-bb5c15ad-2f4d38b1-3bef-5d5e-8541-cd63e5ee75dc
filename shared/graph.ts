export type NodeKind = 'claim' | 'evidence';
export type Stance = 'support' | 'rebut';

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** 初始先验可信度，范围 0..1 */
  initialBelief: number;
  /** 是否在传播中固定为先验值 */
  anchored: boolean;
  /** 一键整理布局时是否锁定坐标：锁定节点位置完全保持不变，并作为相邻层的锚点 */
  positionLocked?: boolean;
  position: Position;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  stance: Stance;
  /** 关系强度，范围 0..1 */
  weight: number;
}

export interface GraphDocument {
  version: 1;
  name?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PropagateOptions {
  /** 收敛阈值：最大信念变化低于此值即收敛 */
  threshold: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 传播/学习强度，0..1；1 表示允许强循环效应 */
  lambda: number;
}

export interface PropagationCycle {
  nodeIds: string[];
  edgeIds: string[];
  /** 反驳边数量 */
  rebutCount: number;
  /** 带符号乘积增益；奇数个反驳时为负 */
  signedGain: number;
  /** 该环节点在最近周期内的平均移动幅度 */
  activity: number;
}

export interface PropagateResult {
  converged: boolean;
  oscillating: boolean;
  iterations: number;
  finalBeliefs: Record<string, number>;
  /** 每个节点第 0 轮（先验）到停止轮的可信度轨迹，用于传播回放 */
  traces: Record<string, number[]>;
  maxChange: number;
  detectedPeriod: number | null;
  cycles: PropagationCycle[];
  /** 本次计算实际使用的参数（回放分解中的 λ 以此为准） */
  options: Required<PropagateOptions>;
  message: string;
}

export interface GraphApiResponse {
  graph: GraphDocument;
}

/** 边权敏感性扫描中单个边权取值点的计算状态 */
export type SensitivityPointStatus = 'converged' | 'oscillating' | 'limit';

export interface SensitivityPoint {
  /** 被扫描边在该点使用的权重，取值 0、0.05、…、1 */
  weight: number;
  /** 状态：收敛 / 振荡 / 达到上限未收敛 */
  status: SensitivityPointStatus;
  /** 实际迭代停止轮次 */
  iterations: number;
  /**
   * 目标节点的最终可信度：
   * 收敛点取收敛值；振荡点无稳定终值，恒为 null（无目标值时以 reason 展示原因）；
   * 达到上限未收敛时取最后一轮值，仅作参考。
   */
  targetValue: number | null;
  /** 检测到的振荡周期（仅振荡点可能非空） */
  detectedPeriod: number | null;
  /** 最后一轮的最大节点变化 */
  maxChange: number;
  /** 无目标值时的原因说明（供悬停展示） */
  reason: string;
}

export interface SensitivityThresholdBand {
  /** 首次跨越 0.5 的连续采样区间左端（权重） */
  fromWeight: number;
  /** 连续采样区间右端（权重） */
  toWeight: number;
  /** 区间左端的目标可信度 */
  fromValue: number;
  /** 区间右端的目标可信度 */
  toValue: number;
}

export interface SensitivityResult {
  edgeId: string;
  targetNodeId: string;
  samples: number;
  points: SensitivityPoint[];
  /** 首个由收敛点构成、目标值首次跨过 0.5 的连续采样区间；振荡/未收敛点不参与判断 */
  thresholdBand: SensitivityThresholdBand | null;
  /** 本次扫描实际使用的传播参数 */
  options: Required<PropagateOptions>;
  message: string;
}

export interface SensitivityRequest {
  /** 画布当前图：仅在内存中用于本次扫描，不会被保存或持久化 */
  graph: GraphDocument;
  edgeId: string;
  targetNodeId: string;
  options?: PropagateOptions;
  /** 等距采样点数量（含 0 和 1），默认 21 */
  samples?: number;
}

/** 路径净符号：路径上反驳边数量为偶数时支持（含 0 条），奇数时反驳 */
export type PathSign = 'support' | 'rebut';

export interface TraceStep {
  edgeId: string;
  sourceId: string;
  targetId: string;
  stance: Stance;
  weight: number;
  /** 截至该跳（含本跳）的带符号边权乘积 */
  runningScore: number;
}

export interface InfluencePath {
  /** 从起始证据到目标节点的有序节点 id（含两端） */
  nodeIds: string[];
  /** 与 nodeIds 对齐、长度为 hops 的有序边 id */
  edgeIds: string[];
  /** 跳数（边数） */
  hops: number;
  /** 逐边关系与累计分数，与 edgeIds 对齐 */
  steps: TraceStep[];
  /** 路径影响分数：支持边取 +weight、反驳边取 -weight 后的边权乘积 */
  score: number;
  /** 路径影响分数的绝对值 */
  absoluteScore: number;
  /** 净符号：偶数条反驳为支持，奇数条反驳为反驳 */
  sign: PathSign;
  /** 路径上的反驳边数量 */
  rebutCount: number;
}

export interface TraceResult {
  startNodeId: string;
  targetNodeId: string;
  /** 本次枚举实际使用的最大跳数（上限 8） */
  maxHops: number;
  /** 按 |分数| 降序返回的前 3 条路径 */
  paths: InfluencePath[];
  /** 枚举过程中抵达过目标节点的简单路径总数（在遍历预算内） */
  enumeratedPaths: number;
  /** 是否因枚举预算上限而提前停止（结果仍按已枚举部分排序） */
  truncated: boolean;
  message: string;
}

export interface TraceRequest {
  /** 画布当前图：仅在内存中用于本次枚举，不会被保存或持久化 */
  graph: GraphDocument;
  /** 起始证据节点 id（kind 必须为 evidence） */
  startNodeId: string;
  /** 目标节点 id（不能与起始节点相同） */
  targetNodeId: string;
  /** 最大跳数，默认 8，范围 1–8 */
  maxHops?: number;
}

/** 证据贡献分摊允许选择的最大证据节点数（联盟数 2^n 随 n 指数增长） */
export const MAX_SHAPLEY_EVIDENCE = 8;

/** 证据贡献分摊中首个未收敛联盟的状态：持续振荡 / 达到迭代上限 */
export type ShapleyFailureStatus = 'oscillating' | 'limit';

export interface ShapleyContribution {
  nodeId: string;
  /** 精确 Shapley 值：v(全联盟) − v(空联盟) 分摊到该证据的有符号贡献 */
  contribution: number;
  /** 贡献占总差值 v(全联盟) − v(空联盟) 的比例；总差值约为 0 时无意义，为 null */
  share: number | null;
}

export interface ShapleyFailure {
  /** 首个未收敛联盟的成员证据 id（按节点 id 排序；空数组表示空联盟） */
  coalition: string[];
  status: ShapleyFailureStatus;
  /** 该联盟传播停止轮次 */
  iterations: number;
  /** 检测到的振荡周期（仅振荡时可能非空） */
  detectedPeriod: number | null;
  /** 最后一轮的最大节点变化 */
  maxChange: number;
  /** 未收敛原因说明 */
  reason: string;
}

export interface ShapleySumCheck {
  /** Σφ_i：全部证据 Shapley 贡献之和 */
  sum: number;
  /** 期望等于 v(全联盟) − v(空联盟) */
  expected: number;
  /** sum − expected（浮点误差量级） */
  difference: number;
  /** |difference| 是否在 1e-9 容差内 */
  ok: boolean;
}

export interface ShapleyResult {
  /** 全部 2^n 个联盟均收敛时为 true 并给出分摊；任一联盟振荡或达到上限时为 false */
  computable: boolean;
  targetNodeId: string;
  /** 参与分摊的证据节点 id（按节点 id 排序，与联盟位号一致） */
  evidenceNodeIds: string[];
  /** 联盟总数 2^n */
  coalitionCount: number;
  /** 实际执行过传播的联盟数（不可计算时含首个失败联盟） */
  coalitionsEvaluated: number;
  /** 空联盟目标值（基准）；不可计算时为 null */
  baselineValue: number | null;
  /** 全联盟目标值；不可计算时为 null */
  fullValue: number | null;
  /** fullValue − baselineValue；不可计算时为 null */
  totalDelta: number | null;
  /** 按 |贡献| 降序、节点 id 稳定排序的分摊结果（不可计算时为空数组） */
  contributions: ShapleyContribution[];
  /** 和式校验 Σφ_i = v(全联盟) − v(空联盟)；不可计算时为 null */
  sumCheck: ShapleySumCheck | null;
  /** 首个未收敛联盟（computable 为 false 时非空） */
  failure: ShapleyFailure | null;
  /** 本次分摊实际使用的传播参数 */
  options: Required<PropagateOptions>;
  message: string;
}

export interface ShapleyRequest {
  /** 画布当前图：仅在内存中用于本次分摊，不会被保存或持久化 */
  graph: GraphDocument;
  /** 目标观点节点 id（kind 必须为 claim） */
  targetNodeId: string;
  /** 参与分摊的证据节点 id（1–8 个，kind 必须为 evidence，不得重复） */
  evidenceNodeIds: string[];
  options?: PropagateOptions;
}
