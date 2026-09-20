import { propagateBeliefs, validateOptions } from './propagation.js';
import {
  MAX_SHAPLEY_EVIDENCE,
  type GraphDocument,
  type GraphNode,
  type PropagateOptions,
  type PropagateResult,
  type ShapleyContribution,
  type ShapleyFailure,
  type ShapleyResult
} from '../shared/graph.js';

export const MIN_SHAPLEY_EVIDENCE = 1;
/** 和式校验容差：Σφ_i 与 v(全联盟) − v(空联盟) 的允许浮点偏差 */
const SUM_CHECK_TOLERANCE = 1e-9;
/** 总差值小于该值时视为 0，占比无意义（share 置 null） */
const SHARE_EPSILON = 1e-12;

/**
 * 校验证据贡献分摊的目标观点与证据选择。
 * 图的严格校验由 validateGraphDocument 在调用处完成；这里只检查选择是否合法。
 */
export function validateShapleySelection(
  graph: GraphDocument,
  targetNodeId: unknown,
  evidenceNodeIds: unknown
): { targetNode: GraphNode; evidenceNodes: GraphNode[] } {
  if (typeof targetNodeId !== 'string' || !targetNodeId.trim()) {
    throw new Error('缺少目标观点 targetNodeId。');
  }
  const targetNode = graph.nodes.find((node) => node.id === targetNodeId);
  if (!targetNode) throw new Error(`目标观点「${targetNodeId}」不存在，无法分摊。`);
  if (targetNode.kind !== 'claim') {
    throw new Error('目标节点必须是观点（claim）节点。');
  }

  if (!Array.isArray(evidenceNodeIds)) {
    throw new Error('缺少证据节点数组 evidenceNodeIds。');
  }
  if (evidenceNodeIds.length < MIN_SHAPLEY_EVIDENCE) {
    throw new Error(`至少选择 ${MIN_SHAPLEY_EVIDENCE} 个证据节点。`);
  }
  if (evidenceNodeIds.length > MAX_SHAPLEY_EVIDENCE) {
    throw new Error(`证据节点最多选择 ${MAX_SHAPLEY_EVIDENCE} 个（当前 ${evidenceNodeIds.length} 个）。`);
  }

  const seen = new Set<string>();
  const evidenceNodes = evidenceNodeIds.map((raw) => {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error('证据节点 id 必须是非空字符串。');
    }
    const id = raw.trim();
    if (seen.has(id)) throw new Error(`证据节点「${id}」被重复选择。`);
    seen.add(id);
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`证据节点「${id}」不存在，无法分摊。`);
    if (node.kind !== 'evidence') {
      throw new Error(`节点「${node.label}」不是证据（evidence）节点。`);
    }
    return node;
  });

  return { targetNode, evidenceNodes };
}

const normalizeZero = (value: number) => (Object.is(value, -0) ? 0 : value);

/** 按节点 id 排序（位号分配、联盟枚举与并列排序共用同一口径，保证结果确定）。 */
const byNodeId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function popcount(mask: number): number {
  let count = 0;
  let rest = mask;
  while (rest > 0) {
    count += rest & 1;
    rest >>= 1;
  }
  return count;
}

function describeFailure(run: PropagateResult, maxIterations: number): string {
  if (run.detectedPeriod !== null) {
    return `第 ${run.iterations} 轮检测到周期约为 ${run.detectedPeriod} 的持续振荡`;
  }
  return `达到 ${maxIterations} 轮上限仍未收敛（末轮最大变化 ${run.maxChange.toFixed(5)}）`;
}

/**
 * 证据贡献分摊（精确 Shapley）：
 * 对所选证据的全部 2^n 个联盟，在内存中的图副本上删除未入盟的所选证据后，
 * 沿用当前传播参数重算传播，取目标观点的收敛值作为联盟目标值 v(S)；
 * 以空联盟为基准，用精确 Shapley 公式把 v(全联盟) − v(空联盟) 分摊给各证据。
 * 仅当全部联盟收敛时才给出分摊；任一联盟振荡或达到上限即整体不可计算（不混用末轮值）。
 */
export function allocateEvidenceContribution(
  graph: GraphDocument,
  targetNodeId: string,
  evidenceNodeIds: string[],
  suppliedOptions?: PropagateOptions
): ShapleyResult {
  const { evidenceNodes } = validateShapleySelection(graph, targetNodeId, evidenceNodeIds);
  const options = validateOptions(suppliedOptions);

  // 参与者按节点 id 排序：位号分配、联盟枚举与并列排序全部确定。
  const players = [...evidenceNodes].sort((a, b) => byNodeId(a.id, b.id));
  const playerIds = players.map((player) => player.id);
  const n = players.length;
  const coalitionCount = 1 << n;

  // values[mask] = 联盟 mask 下目标观点的收敛值。
  const values = new Array<number>(coalitionCount);

  // 按位掩码升序评估；首个未收敛联盟即整体失败。
  for (let mask = 0; mask < coalitionCount; mask += 1) {
    // 未加入联盟的所选证据从图副本删除（节点与相连连线一并移除），其余保持不变。
    const removed = new Set(
      players.filter((_, index) => (mask & (1 << index)) === 0).map((player) => player.id)
    );
    const coalitionGraph: GraphDocument = {
      ...graph,
      nodes: graph.nodes.filter((node) => !removed.has(node.id)),
      edges: graph.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
    };
    const run = propagateBeliefs(coalitionGraph, options);
    if (!run.converged) {
      const failure: ShapleyFailure = {
        coalition: players.filter((_, index) => mask & (1 << index)).map((player) => player.id),
        status: run.oscillating ? 'oscillating' : 'limit',
        iterations: run.iterations,
        detectedPeriod: run.detectedPeriod,
        maxChange: run.maxChange,
        reason: describeFailure(run, options.maxIterations)
      };
      const memberLabels = players
        .filter((_, index) => mask & (1 << index))
        .map((player) => `「${player.label}」`);
      const coalitionText = memberLabels.length === 0 ? '空联盟' : `联盟 ${memberLabels.join('、')}`;
      return {
        computable: false,
        targetNodeId,
        evidenceNodeIds: playerIds,
        coalitionCount,
        coalitionsEvaluated: mask + 1,
        baselineValue: null,
        fullValue: null,
        totalDelta: null,
        contributions: [],
        sumCheck: null,
        failure,
        options,
        message:
          `${coalitionText}未收敛：${failure.reason}。` +
          `证据贡献整体不可计算（已评估 ${mask + 1}/${coalitionCount} 个联盟），未使用任何末轮值。`
      };
    }
    values[mask] = run.finalBeliefs[targetNodeId];
  }

  // 精确 Shapley：φ_i = Σ_{S⊆N\{i}} |S|!(n−1−|S|)!/n! · (v(S∪{i}) − v(S))。
  const factorials = [1];
  for (let k = 1; k <= n; k += 1) factorials.push(factorials[k - 1] * k);

  const contributions: ShapleyContribution[] = players.map((player, index) => {
    const bit = 1 << index;
    let phi = 0;
    for (let mask = 0; mask < coalitionCount; mask += 1) {
      if (mask & bit) continue;
      const size = popcount(mask);
      const weight = (factorials[size] * factorials[n - 1 - size]) / factorials[n];
      phi += weight * (values[mask | bit] - values[mask]);
    }
    return { nodeId: player.id, contribution: normalizeZero(phi), share: null };
  });

  const baselineValue = values[0];
  const fullValue = values[coalitionCount - 1];
  const totalDelta = fullValue - baselineValue;
  const sum = contributions.reduce((acc, item) => acc + item.contribution, 0);
  const difference = sum - totalDelta;
  const shareable = Math.abs(totalDelta) >= SHARE_EPSILON;
  contributions.forEach((item) => {
    item.share = shareable ? item.contribution / totalDelta : null;
  });

  // 按 |贡献| 降序；并列按节点 id 升序，保证多次运行结果稳定一致。
  contributions.sort((a, b) => {
    const delta = Math.abs(b.contribution) - Math.abs(a.contribution);
    return delta !== 0 ? delta : byNodeId(a.nodeId, b.nodeId);
  });

  return {
    computable: true,
    targetNodeId,
    evidenceNodeIds: playerIds,
    coalitionCount,
    coalitionsEvaluated: coalitionCount,
    baselineValue,
    fullValue,
    totalDelta,
    contributions,
    sumCheck: {
      sum,
      expected: totalDelta,
      difference,
      ok: Math.abs(difference) <= SUM_CHECK_TOLERANCE
    },
    failure: null,
    options,
    message:
      `全部 ${coalitionCount} 个证据联盟均收敛：空联盟基准 ${baselineValue.toFixed(4)}，` +
      `全联盟 ${fullValue.toFixed(4)}，差值 ${totalDelta >= 0 ? '+' : ''}${totalDelta.toFixed(4)} ` +
      `已按精确 Shapley 公式分摊给 ${n} 个证据。`
  };
}
